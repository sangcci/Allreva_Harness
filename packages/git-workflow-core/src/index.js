import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_COMMIT_TYPES = ["feat", "fix", "docs", "test", "refactor", "chore"];

export function loadConfig(configPath) {
  const resolved = resolve(configPath);
  const config = JSON.parse(readFileSync(resolved, "utf8"));
  if (config.version !== 1) throw new Error("Unsupported git workflow config version.");
  return config;
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

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}

function valid(value) {
  return { ok: true, value, errors: [] };
}

function invalid(error) {
  return { ok: false, value: null, errors: [error] };
}
