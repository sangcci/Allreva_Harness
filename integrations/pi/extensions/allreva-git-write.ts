import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 64 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const TOOL_VERSION = "1";
const operations = new Set(["worktree-create", "pr-create", "cleanup"]);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "allreva_git_write",
    label: "Allreva Git write",
    description: "Run one validated Git workflow write through Pi native confirmation.",
    parameters: Type.Object({ request: Type.String({ description: "Git write protocol v1 JSON request" }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runWrite(params.request, {
        cwd: process.cwd(),
        hasUI: ctx.hasUI,
        confirm: (title, detail) => ctx.ui.confirm(title, detail),
        run: runCommand,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}

export async function runWrite(requestText, dependencies) {
  const response = (status, operation, extra = {}) => ({ version: 1, status, operation, ...extra });
  let request;
  try {
    request = validateRequest(requestText);
  } catch (error) {
    return response("blocked", safeOperation(requestText), { error: safeError(error) });
  }
  if (dependencies.hasUI !== true || typeof dependencies.confirm !== "function") {
    return response("blocked", request.operation, { error: "Interactive native approval is unavailable." });
  }

  let before;
  let approvalTime;
  let attempted = false;
  try {
    before = await prepare(request, dependencies);
    approvalTime = new Date().toISOString();
    for (let index = 0; index < before.argvs.length; index += 1) {
      const approvedArgv = before.argvs[index];
      const approved = await dependencies.confirm("Approve Allreva Git write", confirmationDetail(before, approvedArgv));
      if (!approved) return response("cancelled", request.operation);

      if (request.operation === "cleanup" && index === 1) {
        await revalidateCleanupBranch(before, dependencies);
      } else {
        const fresh = await prepare(request, dependencies);
        if (!sameScope(before, fresh) || !sameArgv(before.argvs, fresh.argvs)) {
          return response("blocked", request.operation, { error: "Preflight scope changed after approval." });
        }
      }
      attempted = true;
      await dependencies.run(approvedArgv[0], approvedArgv.slice(1), request.operation === "cleanup" ? before.root : dependencies.cwd);

      // Push changes remote state. Check again before asking for PR creation.
      if (request.operation === "pr-create" && index === 0) await prepare(request, dependencies);
    }
    const receiptPath = await writeReceipt(before, receiptCwd(before, request, dependencies), approvalTime, "succeeded");
    return response("executed", request.operation, { receiptPath });
  } catch (error) {
    let receiptPath;
    if (attempted && before && approvalTime) {
      try { receiptPath = await writeReceipt(before, receiptCwd(before, request, dependencies), approvalTime, "failed"); } catch { /* Preserve primary write failure. */ }
    }
    return response("failed", request.operation, { ...(receiptPath ? { receiptPath } : {}), error: safeError(error) });
  }
}

export function validateRequest(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 16 * 1024) throw new Error("Request must be UTF-8 JSON under 16 KiB.");
  rejectDuplicateKeys(text);
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request must be an object.");
  const allowed = new Set(["version", "operation", "configPath", "branch", "path", "title", "bodyFile", "remote"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown request key: ${key}.`);
  if (value.version !== 1 || !operations.has(value.operation)) throw new Error("Unsupported protocol version or operation.");
  const operationKeys = {
    "worktree-create": new Set(["version", "operation", "configPath", "branch"]),
    "pr-create": new Set(["version", "operation", "configPath", "title", "bodyFile", "remote"]),
    cleanup: new Set(["version", "operation", "configPath", "path"]),
  }[value.operation];
  for (const key of Object.keys(value)) if (!operationKeys.has(key)) throw new Error(`Key is not allowed for ${value.operation}: ${key}.`);
  requireRelative(value.configPath, "configPath");
  if (value.operation === "worktree-create") requireText(value.branch, "branch", 512);
  if (value.operation === "cleanup") requireRelative(value.path, "path");
  if (value.operation === "pr-create") {
    requireText(value.title, "title", 256);
    if (value.bodyFile !== undefined) requireRelative(value.bodyFile, "bodyFile");
    if (value.remote !== undefined && value.remote !== "origin") throw new Error("Only origin remote is supported.");
  }
  return value;
}

async function prepare(request, dependencies) {
  const { cwd, run } = dependencies;
  if (request.operation === "worktree-create") {
    const result = await cli(run, cwd, ["worktree", "preflight", "--config", request.configPath, "--branch", request.branch]);
    const plan = requirePlan(result, "worktree-create");
    const argv = ["git", "worktree", "add", plan.target, "-b", request.branch, plan.base];
    return scope(plan, [argv], request.operation, request.configPath);
  }
  if (request.operation === "cleanup") {
    const result = await cli(run, cwd, ["cleanup", "preflight", "--config", request.configPath, "--path", request.path]);
    const plan = requirePlan(result, "cleanup");
    const expected = [["git", "worktree", "remove", plan.target], ["git", "branch", "-d", plan.branch]];
    if (!sameArgv(expected, plan.commands) || !plan.commands.every((argv) => argv.every((part) => !String(part).startsWith("--force")))) {
      throw new Error("Cleanup preflight returned unsafe argv.");
    }
    return scope(plan, expected, request.operation, request.configPath);
  }

  await cli(run, cwd, ["validate", "pr", "--config", request.configPath, "--title", request.title]);
  const result = await cli(run, cwd, ["pr", "preflight", "--config", request.configPath]);
  const plan = requirePlan(result, "pull-request");
  const status = await run("git", ["status", "--porcelain=v1"], cwd);
  if (status.stdout.trim()) throw new Error("PR worktree is not clean.");
  const pushDestination = await getPushDestination(run, cwd, "origin");
  try {
    await run("gh", ["auth", "status"], cwd);
  } catch {
    throw new Error("GitHub authentication unavailable.");
  }
  const listed = await run("gh", ["pr", "list", "--head", plan.branch, "--json", "number"], cwd);
  if (!Array.isArray(parseJson(listed.stdout)) || parseJson(listed.stdout).length !== 0) throw new Error("Existing or ambiguous pull request for branch.");
  const create = ["gh", "pr", "create", "--base", plan.base, "--head", plan.branch, "--title", request.title];
  const body = request.bodyFile ? await readBoundedBody(cwd, request.bodyFile) : undefined;
  const bodyHash = body === undefined ? undefined : sha256(body);
  if (body !== undefined) create.push("--body", body);
  return scope(plan, [["git", "push", "-u", "origin", plan.branch], create], request.operation, request.configPath, { pushDestination, bodyHash });
}

function requirePlan(result, operation) {
  if (!result?.ok || result?.value?.operation !== operation || !result.value.plan) throw new Error("Read-only preflight blocked write.");
  const plan = result.value.plan;
  for (const key of ["branch", "base", "diffHash"]) if (typeof plan[key] !== "string" || !plan[key]) throw new Error("Preflight scope is incomplete.");
  return plan;
}

function scope(plan, argvs, operation, configPath, extra = {}) {
  if (!Array.isArray(argvs) || argvs.length === 0 || argvs.some((argv) => !Array.isArray(argv) || argv.some((part) => typeof part !== "string" || !part))) {
    throw new Error("Derived argv is invalid.");
  }
  return { operation, root: plan.root, branch: plan.branch, worktree: plan.worktree ?? plan.target, base: plan.base, diffHash: plan.diffHash, argvs, configPath, ...extra };
}

async function cli(run, cwd, args) {
  const result = await run("allreva-git", args, cwd);
  const parsed = parseJson(result.stdout);
  if (!parsed || parsed.ok !== true) throw new Error("Read-only CLI preflight failed.");
  return parsed;
}

function receiptCwd(prepared, request, dependencies) {
  return request.operation === "cleanup" ? prepared.root : dependencies.cwd;
}

async function writeReceipt(prepared, cwd, approvedAt, outcome) {
  const config = JSON.parse(await readFile(resolve(cwd, prepared.configPath), "utf8"));
  const workflowId = config?.workflow?.id;
  if (typeof workflowId !== "string" || !workflowId) throw new Error("Workflow identity unavailable for audit receipt.");
  const receipt = {
    receiptId: randomUUID(), platform: "pi", operation: prepared.operation, workflowId,
    branch: prepared.branch, worktree: prepared.worktree, base: prepared.base, diffHash: prepared.diffHash,
    argvSha256: `sha256:${createHash("sha256").update(JSON.stringify(prepared.argvs)).digest("hex")}`,
    approvedAt, executedAt: new Date().toISOString(), outcome, toolVersion: TOOL_VERSION,
  };
  const directory = resolve(cwd, ".allreva", "audit");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${receipt.receiptId}.json`);
  await writeFile(path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return `.allreva/audit/${receipt.receiptId}.json`;
}

async function runCommand(executable, args, cwd) {
  const result = await execFile(executable, args, { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT, windowsHide: true });
  return { stdout: String(result.stdout ?? "").slice(0, MAX_OUTPUT), stderr: String(result.stderr ?? "").slice(0, MAX_OUTPUT) };
}

function requireText(value, name, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum || /[\u0000\r\n]/.test(value)) throw new Error(`Invalid ${name}.`);
}
function requireRelative(value, name) {
  requireText(value, name, 1024);
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split(/[\\/]+/).includes("..") || value === "." || value.startsWith(sep)) throw new Error(`Invalid relative ${name}.`);
}
function parseJson(text) { try { return JSON.parse(text); } catch { throw new Error("Command returned invalid JSON."); } }
async function getPushDestination(run, cwd, remote) {
  const output = String((await run("git", ["remote", "get-url", "--push", "--all", remote], cwd)).stdout);
  const destinations = output.endsWith("\n") ? output.slice(0, -1).split("\n") : output.split("\n");
  if (destinations.length !== 1) throw new Error("Expected exactly one effective push destination.");
  return normalizeGitHubDestination(destinations[0]);
}

function normalizeGitHubDestination(value) {
  if (typeof value !== "string" || !value || /[\u0000\r\n\s]/.test(value)) throw new Error("Push destination is invalid.");
  const scp = /^git@github\.com:([^/\s][^\s]*)$/i.exec(value);
  if (scp) return `ssh://git@github.com/${scp[1]}`;
  let url;
  try { url = new URL(value); } catch { throw new Error("Push destination is not an approved GitHub HTTPS/SSH URL."); }
  const https = url.protocol === "https:" && !url.username && !url.password;
  const ssh = url.protocol === "ssh:" && url.username === "git" && !url.password;
  if ((!https && !ssh) || url.hostname.toLowerCase() !== "github.com" || url.port || url.search || url.hash || !url.pathname || url.pathname === "/") {
    throw new Error("Push destination is not an approved GitHub HTTPS/SSH URL.");
  }
  return `${url.protocol}//${ssh ? "git@" : ""}github.com${url.pathname}`;
}

async function readBoundedBody(cwd, bodyFile) {
  const handle = await open(resolve(cwd, bodyFile), "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_BODY_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BODY_BYTES) throw new Error("PR body exceeds 64 KiB.");
    const content = buffer.subarray(0, bytesRead);
    const text = content.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(content)) throw new Error("PR body must be UTF-8.");
    return text;
  } finally {
    await handle.close();
  }
}

async function revalidateCleanupBranch(prepared, dependencies) {
  const { run } = dependencies;
  try {
    await run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${prepared.branch}`], prepared.root);
    await run("git", ["merge-base", "--is-ancestor", prepared.branch, prepared.base], prepared.root);
    const worktrees = await run("git", ["worktree", "list", "--porcelain"], prepared.root);
    if (worktrees.stdout.split("\n").includes(`branch refs/heads/${prepared.branch}`)) throw new Error("Cleanup branch remains checked out.");
  } catch (error) {
    if (error instanceof Error && error.message === "Cleanup branch remains checked out.") throw error;
    throw new Error("Cleanup branch deletion precondition changed.");
  }
}

function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function sameScope(left, right) { return ["operation", "root", "branch", "worktree", "base", "diffHash", "pushDestination", "bodyHash"].every((key) => left[key] === right[key]); }
function sameArgv(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function confirmationDetail(prepared, argv) {
  const displayArgv = argv[0] === "gh" && argv[1] === "pr" && argv[2] === "create" && argv.includes("--body")
    ? argv.map((part, index) => argv[index - 1] === "--body" ? `[captured ${prepared.bodyHash}]` : part)
    : argv;
  return [`Operation: ${prepared.operation}`, `Branch: ${prepared.branch}`, `Worktree: ${prepared.worktree}`, `Base: ${prepared.base}`, `Diff: ${prepared.diffHash}`, ...(prepared.pushDestination ? [`Push destination: ${prepared.pushDestination}`] : []), ...(prepared.bodyHash ? [`PR body: ${prepared.bodyHash}`] : []), `Destructive: ${prepared.operation === "cleanup" ? "yes" : "no"}`, `Argv: ${JSON.stringify(displayArgv)}`].join("\n");
}
function safeError(error) { return error instanceof Error ? error.message.replace(/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g, "[redacted]").slice(0, 240) : "Write adapter failed."; }
function safeOperation(text) { try { return JSON.parse(text)?.operation ?? "unknown"; } catch { return "unknown"; } }

function rejectDuplicateKeys(text) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? "")) index += 1; };
  const string = () => { const start = index++; let escaped = false; while (index < text.length) { const char = text[index++]; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') return JSON.parse(text.slice(start, index)); } throw new Error("Invalid JSON string."); };
  const value = () => { whitespace(); if (text[index] === "{") { object(); return; } if (text[index] === "[") { index += 1; whitespace(); if (text[index] === "]") { index += 1; return; } while (true) { value(); whitespace(); if (text[index] === "]") { index += 1; return; } if (text[index++] !== ",") throw new Error("Invalid JSON array."); } } if (text[index] === '"') { string(); return; } while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1; };
  const object = () => { const keys = new Set(); index += 1; whitespace(); if (text[index] === "}") { index += 1; return; } while (true) { whitespace(); if (text[index] !== '"') throw new Error("Invalid JSON object."); const key = string(); if (keys.has(key)) throw new Error(`Duplicate request key: ${key}.`); keys.add(key); whitespace(); if (text[index++] !== ":") throw new Error("Invalid JSON object."); value(); whitespace(); if (text[index] === "}") { index += 1; return; } if (text[index++] !== ",") throw new Error("Invalid JSON object."); } };
  value(); whitespace(); if (index !== text.length) throw new Error("Invalid JSON request.");
}
