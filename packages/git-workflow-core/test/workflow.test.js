import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  calculateDiffHash,
  loadConfig,
  preflightCleanup,
  preflightPullRequest,
  preflightWorktreeCreate,
  validateAuditReceipt,
  validateConfig,
} from "../src/index.js";

const temporaryPaths = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function config(overrides = {}) {
  return {
    version: 1,
    branch: { base: "develop", pattern: "{type}/#{issue}-{slug}" },
    workflow: { id: "allreva-test", worktreeRoot: ".worktrees" },
    ...overrides,
  };
}

function repository() {
  const path = mkdtempSync(join(tmpdir(), "allreva-workflow-"));
  temporaryPaths.push(path);
  run(path, "init", "-b", "develop");
  run(path, "config", "user.email", "test@example.com");
  run(path, "config", "user.name", "Allreva Test");
  writeFileSync(join(path, "README.md"), "base\n");
  run(path, "add", "README.md");
  run(path, "commit", "-m", "chore(test): base");
  return path;
}

function run(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function runCli(cwd, ...args) {
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "packages/git-workflow-cli/bin/allreva-git.js"),
    ...args,
  ], { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined);
  return { status: result.status, body: JSON.parse(result.stdout) };
}

function receipt({ stage, branch, worktree, diffHash, ...overrides }) {
  return {
    receiptId: `adapter-${stage}-${branch}`,
    workflowId: "allreva-test",
    stage,
    branch,
    worktree,
    diffHash,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

test("loadConfig requires workflow identity and rejects POSIX, Windows, and UNC roots", () => {
  const path = mkdtempSync(join(tmpdir(), "allreva-config-"));
  temporaryPaths.push(path);
  const file = join(path, ".allreva.json");
  writeFileSync(file, JSON.stringify({ version: 1, branch: { base: "develop" } }));
  assert.throws(() => loadConfig(file), /workflow is required/);

  for (const worktreeRoot of ["/tmp/worktrees", "C:\\worktrees", "\\worktrees", "\\\\server\\share\\worktrees"]) {
    assert.equal(validateConfig(config({ workflow: { id: "allreva-test", worktreeRoot } })).ok, false, worktreeRoot);
  }
  writeFileSync(file, JSON.stringify(config()));
  assert.equal(loadConfig(file).workflow.id, "allreva-test");
});

test("worktree preflight is read-only and receipts cannot authorize it", () => {
  const cwd = repository();
  const branch = "feat/#7-safe-plan";
  const normal = preflightWorktreeCreate(config(), { cwd, branch });
  const forgedReceipt = preflightWorktreeCreate(config(), {
    cwd,
    branch,
    approvalReceipt: { approved: true, receiptId: "forged" },
  });

  assert.equal(normal.ok, true);
  assert.equal(forgedReceipt.ok, true);
  assert.deepEqual(forgedReceipt.value.checks, normal.value.checks);
  assert.equal("workflowEntryApproval" in normal.value.checks, false);
  assert.equal(run(cwd, "branch", "--list", branch).trim(), "");
  assert.equal(existsSync(normal.value.plan.target), false);
});

test("audit receipt validation checks scope but never authorizes a preflight", () => {
  const cwd = repository();
  const branch = "feat/#8-audit";
  const target = ".worktrees/feat%2F%238-audit";
  const audit = receipt({ stage: "workflow-entry", branch, worktree: target, diffHash: calculateDiffHash(cwd, "develop") });

  assert.equal(validateAuditReceipt(audit, { workflowId: "allreva-test", branch }).ok, true);
  assert.equal(validateAuditReceipt(audit, { stage: "cleanup" }).ok, false);
  assert.equal(preflightWorktreeCreate(config(), { cwd, branch, approvalReceipt: audit }).ok, true);
});

test("worktree mapping is injective and symbolic worktree root is blocked", () => {
  const cwd = repository();
  const first = preflightWorktreeCreate(config(), { cwd, branch: "feat/#1-2-a" });
  const second = preflightWorktreeCreate(config(), { cwd, branch: "feat-1/#2-a" });
  assert.notEqual(first.value.plan.target, second.value.plan.target);

  const outside = mkdtempSync(join(tmpdir(), "allreva-outside-"));
  temporaryPaths.push(outside);
  symlinkSync(outside, join(cwd, ".worktrees"));
  const result = preflightWorktreeCreate(config(), { cwd, branch: "feat/#9-symlink" });
  assert.equal(result.value.checks.worktreeRootNoSymlink.ok, false);
});

test("PR preflight is read-only and has no receipt gate", () => {
  const cwd = repository();
  const branch = "feat/#10-pr";
  const name = "feat%2F%2310-pr";
  const worktree = join(cwd, ".worktrees", name);
  run(cwd, "worktree", "add", worktree, "-b", branch);
  writeFileSync(join(worktree, "feature.txt"), "feature\n");
  run(worktree, "add", "feature.txt");
  run(worktree, "commit", "-m", "feat(test): change");

  const result = preflightPullRequest(config(), {
    cwd: worktree,
    prCreationReceipt: { approved: true },
  });
  assert.equal(result.ok, true);
  assert.equal("prCreationApproval" in result.value.checks, false);
  assert.match(result.value.plan.action, /native human UI confirmation/);
});

test("cleanup plans only merged branch non-force deletion", () => {
  const cwd = repository();
  const branch = "feat/#11-cleanup";
  const name = "feat%2F%2311-cleanup";
  const worktree = join(cwd, ".worktrees", name);
  run(cwd, "worktree", "add", worktree, "-b", branch);
  const result = preflightCleanup(config(), { cwd, path: name });

  assert.equal(result.ok, true);
  assert.equal(result.value.checks.mergedIntoBase.ok, true);
  assert.deepEqual(result.value.plan.commands.at(-1), ["git", "branch", "-d", branch]);
  assert.equal(result.value.plan.commands.flat().includes("--force"), false);
  assert.equal(result.value.plan.commands.flat().includes("-D"), false);
});

test("cleanup rejects unmerged branch and emits no deletion commands", () => {
  const cwd = repository();
  const branch = "feat/#12-unmerged";
  const name = "feat%2F%2312-unmerged";
  const worktree = join(cwd, ".worktrees", name);
  run(cwd, "worktree", "add", worktree, "-b", branch);
  writeFileSync(join(worktree, "unmerged.txt"), "unmerged\n");
  run(worktree, "add", "unmerged.txt");
  run(worktree, "commit", "-m", "feat(test): unmerged");
  const result = preflightCleanup(config(), { cwd, path: name });

  assert.equal(result.ok, false);
  assert.equal(result.value.checks.mergedIntoBase.ok, false);
  assert.deepEqual(result.value.plan.commands, []);
});

test("cleanup rejects ignored files worktree removal could destroy", () => {
  const cwd = repository();
  const branch = "feat/#13-ignored";
  const name = "feat%2F%2313-ignored";
  const worktree = join(cwd, ".worktrees", name);
  writeFileSync(join(cwd, ".gitignore"), ".cache/\n");
  run(cwd, "add", ".gitignore");
  run(cwd, "commit", "-m", "chore(test): ignore cache");
  run(cwd, "worktree", "add", worktree, "-b", branch);
  mkdirSync(join(worktree, ".cache"));
  writeFileSync(join(worktree, ".cache", "state"), "ignored\n");

  const result = preflightCleanup(config(), { cwd, path: name });
  assert.equal(result.ok, false);
  assert.equal(result.value.checks.noUntrackedOrIgnoredFiles.ok, false);
  assert.deepEqual(result.value.plan.commands, []);
});

test("CLI plans worktree without receipt input and never writes", () => {
  const cwd = repository();
  const branch = "feat/#14-cli-plan";
  const configFile = join(cwd, ".allreva.json");
  writeFileSync(configFile, JSON.stringify(config()));

  const result = runCli(cwd, "worktree", "preflight", "--config", configFile, "--branch", branch);
  assert.equal(result.status, 0);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.value.operation, "worktree-create");
  assert.equal(existsSync(join(cwd, ".worktrees", "feat%2F%2314-cli-plan")), false);
});
