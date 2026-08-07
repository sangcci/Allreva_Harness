import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const DEFAULT_COMMIT_TYPES = ["feat", "fix", "docs", "test", "refactor", "chore"];

export function loadConfig(configPath) {
  const resolved = resolve(configPath);
  const config = JSON.parse(readFileSync(resolved, "utf8"));
  const validation = validateConfig(config);
  if (!validation.ok) throw new Error(`Invalid git workflow config: ${validation.errors.join(" ")}`);
  return config;
}

export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) errors.push("Config must be an object.");
  else {
    if (config.version !== 1) errors.push("Unsupported git workflow config version.");
    if (!config.branch || typeof config.branch.base !== "string" || !config.branch.base) errors.push("branch.base is required.");
    if (!config.branch || typeof config.branch.pattern !== "string" || !config.branch.pattern) errors.push("branch.pattern is required.");
    if (!config.workflow || typeof config.workflow !== "object" || Array.isArray(config.workflow)) {
      errors.push("workflow is required.");
    } else {
      if (typeof config.workflow.id !== "string" || !config.workflow.id) errors.push("workflow.id is required.");
      if (!isSafeRelativePath(config.workflow.worktreeRoot)) {
        errors.push("workflow.worktreeRoot must be a non-empty relative path inside repository.");
      }
    }
  }
  return errors.length ? invalid(errors) : valid(config);
}

export function validateIssueTitle(config, title) {
  const types = config.issue?.types ?? [];
  const match = /^\[([A-Z]+)] ([^ ].*)$/.exec(title);
  if (!match) return invalid("Issue title must match '[TYPE] description'.");
  if (!types.includes(match[1])) return invalid(`Unsupported issue type: ${match[1]}.`);
  return valid({ type: match[1], subject: match[2] });
}

export function validatePullRequestTitle(_config, title) {
  const match = /^\[#([1-9][0-9]*)] ([^ ].*)$/.exec(title);
  if (!match) return invalid("PR title must match '[#issue] description'.");
  return valid({ issue: Number(match[1]), subject: match[2] });
}

export function validateBranch(config, { type, issue, slug }) {
  if (!/^[a-z][a-z0-9-]*$/.test(type)) return invalid("Branch type must use lowercase letters, digits, and hyphens.");
  if (!Number.isSafeInteger(issue) || issue < 1) return invalid("Issue number must be a positive integer.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return invalid("Branch slug must use lowercase kebab-case.");
  const pattern = config.branch?.pattern;
  if (typeof pattern !== "string") return invalid("Branch pattern is missing.");
  return valid({ branch: pattern.replaceAll("{type}", type).replaceAll("{issue}", String(issue)).replaceAll("{slug}", slug) });
}

export function validateCommitMessage(config, message) {
  const commit = config.commit ?? {};
  if (!commit.conventional) return valid({ message });
  const types = commit.types ?? DEFAULT_COMMIT_TYPES;
  const match = /^([a-z]+)(?:\(([a-z0-9][a-z0-9-]*)\))?!?: ([^ ].*)$/.exec(message);
  if (!match) return invalid("Commit message must match 'type(scope): subject'.");
  if (!types.includes(match[1])) return invalid(`Unsupported commit type: ${match[1]}.`);
  if (commit.requireScope && !match[2]) return invalid("Commit scope is required.");
  if (commit.maxHeaderLength && message.length > commit.maxHeaderLength) return invalid("Commit header is too long.");
  return valid({ type: match[1], scope: match[2] ?? null, subject: match[3] });
}

export function inspectGit(cwd) {
  return {
    root: git(cwd, ["rev-parse", "--show-toplevel"]),
    branch: git(cwd, ["branch", "--show-current"]),
    status: git(cwd, ["status", "--porcelain=v1"]),
  };
}

export function calculateDiffHash(cwd, base) {
  return `sha256:${createHash("sha256").update(gitRaw(cwd, ["diff", "--binary", `${base}...HEAD`])).digest("hex")}`;
}

export function preflightWorktreeCreate(config, { cwd, branch } = {}) {
  const root = primaryWorktreeRoot(cwd);
  const worktreeRoot = resolve(root, config.workflow.worktreeRoot);
  const target = resolve(worktreeRoot, worktreeName(branch));
  const worktreeRootHasSymlink = hasSymlinkInPath(root, worktreeRoot);
  const branchCheck = gitResult(root, ["check-ref-format", "--branch", branch]);
  const baseCheck = gitResult(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${config.branch.base}`]);
  const branchExists = gitResult(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
  const diffHash = baseCheck.ok ? calculateDiffHash(root, config.branch.base) : null;
  const checks = {
    dryRun: check(true, "No git worktree command executed."),
    validBranch: check(branchCheck.ok, branchCheck.ok ? "Branch name is valid." : "Branch name is invalid."),
    workflowBranch: check(matchesBranchPattern(config.branch.pattern, branch), `Branch must match configured pattern '${config.branch.pattern}'.`),
    baseBranch: check(baseCheck.ok, baseCheck.ok ? `Base branch '${config.branch.base}' exists locally.` : `Base branch '${config.branch.base}' is missing locally.`),
    targetInsideWorktreeRoot: check(isInside(worktreeRoot, target), "Target stays inside configured worktree root."),
    worktreeRootNoSymlink: check(!worktreeRootHasSymlink, worktreeRootHasSymlink ? "Configured worktree root contains a symbolic link." : "Configured worktree root contains no symbolic links."),
    targetAbsent: check(!existsSync(target), existsSync(target) ? "Target path already exists." : "Target path is absent."),
    branchAbsent: check(!branchExists, branchExists ? `Branch '${branch}' already exists.` : `Branch '${branch}' is absent.`),
  };
  return preflightResult("worktree-create", checks, {
    root, worktreeRoot, target, branch, base: config.branch.base, diffHash,
    command: ["git", "worktree", "add", target, "-b", branch, config.branch.base],
  });
}

export function preflightPullRequest(config, { cwd } = {}) {
  const worktree = git(cwd, ["rev-parse", "--show-toplevel"]);
  const root = primaryWorktreeRoot(cwd);
  const branch = git(worktree, ["branch", "--show-current"]);
  const baseCheck = gitResult(worktree, ["rev-parse", "--verify", "--quiet", `refs/heads/${config.branch.base}`]);
  const diffHash = baseCheck.ok ? calculateDiffHash(worktree, config.branch.base) : null;
  const checks = {
    dryRun: check(true, "No pull request created. Platform adapter owns PR creation after native human UI confirmation."),
    configuredWorktree: check(isInside(resolve(root, config.workflow.worktreeRoot), worktree), "PR preflight runs from a configured worktree."),
    currentBranch: check(Boolean(branch), "PR preflight requires a checked-out branch."),
    baseBranch: check(baseCheck.ok, baseCheck.ok ? `Base branch '${config.branch.base}' exists locally.` : `Base branch '${config.branch.base}' is missing locally.`),
  };
  return preflightResult("pull-request", checks, {
    action: "Platform adapter owns PR creation after its native human UI confirmation; this result is read-only validation.",
    root, worktree, branch, base: config.branch.base, diffHash,
  });
}

export function preflightCleanup(config, { cwd, path } = {}) {
  const root = primaryWorktreeRoot(cwd);
  const worktreeRoot = resolve(root, config.workflow.worktreeRoot);
  const target = path && isSafeRelativePath(path) ? resolve(worktreeRoot, path) : null;
  const targetHasSymlink = target && hasSymlinkInPath(root, target);
  const entries = worktreeEntries(root);
  const entry = target ? entries.find((item) => item.path === target) : null;
  const trackedStatus = entry ? gitResult(target, ["status", "--porcelain=v1", "--untracked-files=no"]) : { ok: false, output: "" };
  const destroyableFiles = entry ? gitResult(target, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"]) : { ok: false, output: "" };
  const untrackedOrIgnored = destroyableFiles.ok
    ? destroyableFiles.output.split("\n").filter((line) => line.startsWith("??") || line.startsWith("!!"))
    : [];
  const branch = entry?.branch?.replace("refs/heads/", "") ?? null;
  const baseCheck = gitResult(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${config.branch.base}`]);
  const mergedIntoBase = baseCheck.ok && branch ? gitResult(root, ["merge-base", "--is-ancestor", branch, config.branch.base]).ok : false;
  const diffHash = entry && baseCheck.ok ? calculateDiffHash(target, config.branch.base) : null;
  const checks = {
    dryRun: check(true, "No worktree, branch, or remote state changed."),
    safePath: check(Boolean(target) && isInside(worktreeRoot, target) && !targetHasSymlink, targetHasSymlink ? "Cleanup target path contains a symbolic link." : "Cleanup target is inside configured worktree root without symbolic links."),
    registeredWorktree: check(Boolean(entry), entry ? "Target is a registered Git worktree." : "Target is not a registered Git worktree."),
    cleanWorktree: check(trackedStatus.ok && !trackedStatus.output, trackedStatus.ok && !trackedStatus.output ? "Worktree has no tracked uncommitted changes." : "Worktree has tracked changes or is unreadable."),
    noUntrackedOrIgnoredFiles: check(destroyableFiles.ok && untrackedOrIgnored.length === 0, destroyableFiles.ok && untrackedOrIgnored.length === 0 ? "Worktree has no untracked or ignored files." : `Worktree has untracked or ignored files that removal could destroy: ${untrackedOrIgnored.join(", ") || "unreadable"}.`),
    unlockedWorktree: check(Boolean(entry) && !entry.locked, entry?.locked ? "Worktree is locked." : "Worktree is not locked."),
    nonPrimaryWorktree: check(Boolean(entry) && entry.path !== root, "Primary worktree cannot be cleaned by this plan."),
    baseBranch: check(baseCheck.ok, baseCheck.ok ? `Base branch '${config.branch.base}' exists locally.` : `Base branch '${config.branch.base}' is missing locally.`),
    mergedIntoBase: check(mergedIntoBase, branch ? `Branch '${branch}' is merged into configured base '${config.branch.base}'.` : "Cleanup target has no local branch."),
  };
  const mayDelete = Object.values(checks).every((item) => item.ok) && entry && branch;
  return preflightResult("cleanup", checks, {
    root, worktreeRoot, target, branch, base: config.branch.base, diffHash,
    commands: mayDelete ? [["git", "worktree", "remove", target], ["git", "branch", "-d", branch]] : [],
    note: "Cleanup plan requires local branch merged into configured base. Remote merge state remains platform-adapter owned.",
  });
}

function preflightResult(operation, checks, plan) {
  const errors = Object.values(checks).filter((item) => !item.ok).map((item) => item.detail);
  return { ok: errors.length === 0, value: { operation, dryRun: true, checks, plan }, errors };
}

export function validateAuditReceipt(receipt, expected = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return invalid("Audit receipt must be an object.");
  const errors = [];
  if (typeof receipt.receiptId !== "string" || !receipt.receiptId) errors.push("receiptId is required.");
  for (const key of ["workflowId", "stage", "branch", "worktree", "diffHash"]) {
    if (typeof receipt[key] !== "string" || !receipt[key]) errors.push(`${key} is required.`);
    else if (expected[key] !== undefined && receipt[key] !== expected[key]) errors.push(`${key} does not match expected audit scope.`);
  }
  if (!isPastIsoTimestamp(receipt.timestamp)) errors.push("timestamp must be a non-future ISO timestamp.");
  return errors.length ? invalid(errors) : valid(receipt);
}

function isPastIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value && time <= Date.now();
}

function check(ok, detail) {
  return { ok, detail };
}

function worktreeName(branch) {
  return encodeURIComponent(branch);
}

function relativeWorktree(root, path) {
  return relative(root, path).split("\\").join("/");
}

function matchesBranchPattern(pattern, branch) {
  const tokenPatterns = {
    "{type}": "[a-z][a-z0-9-]*",
    "{issue}": "[1-9][0-9]*",
    "{slug}": "[a-z0-9]+(?:-[a-z0-9]+)*",
  };
  const expression = pattern.split(/(\{(?:type|issue|slug)\})/).map((part) => tokenPatterns[part] ?? escapeRegex(part)).join("");
  return new RegExp(`^${expression}$`).test(branch);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value !== "." && !isAbsolute(value) && !/^(?:[A-Za-z]:|\\)/.test(value) && !value.split(/[\\/]+/).includes("..");
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith("../") && !path.startsWith("..\\"));
}

function hasSymlinkInPath(root, path) {
  const parts = relative(root, path).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function primaryWorktreeRoot(cwd) {
  const entries = worktreeEntries(cwd);
  return entries[0]?.path ?? git(cwd, ["rev-parse", "--show-toplevel"]);
}

function worktreeEntries(cwd) {
  const output = git(cwd, ["worktree", "list", "--porcelain"]);
  return output.split("\n\n").filter(Boolean).map((block) => {
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const [key, ...value] = line.split(" ");
      return [key, value.join(" ")];
    }));
    return { path: fields.worktree, branch: fields.branch ?? null, locked: Object.hasOwn(fields, "locked") };
  });
}

function gitResult(cwd, args) {
  try {
    return { ok: true, output: git(cwd, args) };
  } catch (error) {
    return { ok: false, output: "", error: error.message };
  }
}

function gitRaw(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}

function git(cwd, args) {
  return gitRaw(cwd, args).trim();
}

function valid(value) {
  return { ok: true, value, errors: [] };
}

function invalid(error) {
  return { ok: false, value: null, errors: Array.isArray(error) ? error : [error] };
}
