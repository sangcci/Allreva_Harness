import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, afterEach } from "node:test";

const temporary = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

async function loadAdapter() {
  let source = readFileSync(new URL("../extensions/allreva-git-write.ts", import.meta.url), "utf8");
  source = source.replace('import { Type } from "typebox";', 'const Type = { Object: (value) => value, String: () => ({}) };');
  source = source.replace('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n', "");
  source = source.replace("(pi: ExtensionAPI)", "(pi)");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function directory() {
  const cwd = mkdtempSync(join(tmpdir(), "allreva-pi-write-"));
  temporary.push(cwd);
  writeFileSync(join(cwd, ".allreva.json"), JSON.stringify({ workflow: { id: "safe-flow" }, token: "ghp_never-store-me" }));
  return cwd;
}

function preflight(operation, plan) {
  return JSON.stringify({ ok: true, value: { operation, plan } });
}

function runner({ plan, changed = false, pushDestination = "git@github.com:allreva/test.git", useGitRemote = false } = {}) {
  const calls = [];
  let preflights = 0;
  return {
    calls,
    async run(executable, args, cwd) {
      calls.push([executable, ...args]);
      if (executable === "allreva-git") {
        preflights += 1;
        const usePlan = changed && preflights > 1 ? { ...plan, diffHash: "sha256:changed" } : plan;
        if (args[0] === "validate") return { stdout: JSON.stringify({ ok: true }) };
        return { stdout: preflight(args[0] === "pr" ? "pull-request" : args[0] === "worktree" ? "worktree-create" : "cleanup", usePlan) };
      }
      if (executable === "git" && args[0] === "status") return { stdout: "" };
      if (executable === "git" && args[0] === "remote" && args[1] === "get-url") {
        return { stdout: useGitRemote ? execFileSync("git", args, { cwd, encoding: "utf8" }) : `${pushDestination}\n` };
      }
      if (executable === "gh" && args[0] === "pr" && args[1] === "list") return { stdout: "[]" };
      return { stdout: "" };
    },
  };
}

function writes(calls) {
  return calls.filter(([name, action, subaction]) => {
    if (name === "git") return !["status", "remote", "config", "show-ref", "merge-base"].includes(action) && !(action === "worktree" && subaction === "list");
    return name === "gh" && !(action === "auth" || (action === "pr" && subaction === "list"));
  });
}

test("decline runs no write", async () => {
  const { runWrite } = await loadAdapter();
  const mock = runner({ plan: { root: "/repo", target: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "worktree-create", configPath: ".allreva.json", branch: "feat/#1-safe" }), { cwd: directory(), hasUI: true, confirm: async () => false, run: mock.run });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(writes(mock.calls), []);
});

test("malformed and unknown protocol never starts command", async () => {
  const { runWrite } = await loadAdapter();
  for (const request of ["{\"version\":1,\"version\":1}", JSON.stringify({ version: 1, operation: "cleanup", configPath: ".allreva.json", path: "x", command: "rm" })]) {
    const mock = runner();
    const result = await runWrite(request, { cwd: directory(), hasUI: true, confirm: async () => true, run: mock.run });
    assert.equal(result.status, "blocked");
    assert.equal(mock.calls.length, 0);
  }
});

test("worktree derives exact argv and receipt excludes config secret", async () => {
  const { runWrite } = await loadAdapter();
  const cwd = directory();
  const mock = runner({ plan: { root: "/repo", target: "/repo/.worktrees/feat%2F%231-safe", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "worktree-create", configPath: ".allreva.json", branch: "feat/#1-safe" }), { cwd, hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "executed");
  assert.deepEqual(writes(mock.calls), [["git", "worktree", "add", "/repo/.worktrees/feat%2F%231-safe", "-b", "feat/#1-safe", "develop"]]);
  const receipt = readFileSync(join(cwd, result.receiptPath), "utf8");
  assert.equal(receipt.includes("ghp_never-store-me"), false);
  assert.equal(JSON.parse(receipt).platform, "pi");
});

test("changed preflight after approval blocks write", async () => {
  const { runWrite } = await loadAdapter();
  const mock = runner({ changed: true, plan: { root: "/repo", target: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "worktree-create", configPath: ".allreva.json", branch: "feat/#1-safe" }), { cwd: directory(), hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "blocked");
  assert.deepEqual(writes(mock.calls), []);
});

test("cleanup keeps approved safe argv order", async () => {
  const { runWrite } = await loadAdapter();
  const cwd = directory();
  const mock = runner({ plan: { root: cwd, target: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc", commands: [["git", "worktree", "remove", "/repo/.worktrees/feat"], ["git", "branch", "-d", "feat/#1-safe"]] } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "cleanup", configPath: ".allreva.json", path: "feat" }), { cwd, hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "executed");
  assert.deepEqual(writes(mock.calls), [["git", "worktree", "remove", "/repo/.worktrees/feat"], ["git", "branch", "-d", "feat/#1-safe"]]);
  assert.equal(mock.calls.filter(([name, action]) => name === "allreva-git" && action === "cleanup").length, 2);
  assert.ok(mock.calls.some(([name, action]) => name === "git" && action === "show-ref"));
});

test("PR pushes captured body then creates; integration action is absent", async () => {
  const { runWrite } = await loadAdapter();
  const cwd = directory();
  mkdirSync(join(cwd, ".allreva"));
  writeFileSync(join(cwd, ".allreva", "body.md"), "Approved body");
  const mock = runner({ plan: { root: "/repo", worktree: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "pr-create", configPath: ".allreva.json", title: "[#1] Safe plan", bodyFile: ".allreva/body.md", remote: "origin" }), { cwd, hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "executed");
  const actual = writes(mock.calls);
  assert.deepEqual(actual, [["git", "push", "-u", "origin", "feat/#1-safe"], ["gh", "pr", "create", "--base", "develop", "--head", "feat/#1-safe", "--title", "[#1] Safe plan", "--body", "Approved body"]]);
  assert.equal(actual.flat().includes("merge"), false);
});

test("non-GitHub effective push destination blocks write", async () => {
  const { runWrite } = await loadAdapter();
  const mock = runner({ pushDestination: "https://example.invalid/allreva/test.git", plan: { root: "/repo", worktree: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "pr-create", configPath: ".allreva.json", title: "[#1] Safe plan" }), { cwd: directory(), hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "failed");
  assert.match(result.error, /Push destination/);
  assert.deepEqual(writes(mock.calls), []);
});

test("PR binds Git-rewritten effective push destination into confirmation scope", async () => {
  const { runWrite } = await loadAdapter();
  const cwd = directory();
  execFileSync("git", ["init"], { cwd, encoding: "utf8" });
  execFileSync("git", ["remote", "add", "origin", "https://code-host.invalid/allreva/test.git"], { cwd, encoding: "utf8" });
  execFileSync("git", ["config", "url.git@github.com:allreva/.pushInsteadOf", "https://code-host.invalid/allreva/"], { cwd, encoding: "utf8" });
  const mock = runner({ useGitRemote: true, plan: { root: "/repo", worktree: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  let confirmation = "";
  const result = await runWrite(JSON.stringify({ version: 1, operation: "pr-create", configPath: ".allreva.json", title: "[#1] Safe plan" }), {
    cwd, hasUI: true, confirm: async (_title, detail) => { confirmation = detail; return true; }, run: mock.run,
  });

  assert.equal(result.status, "executed");
  assert.ok(mock.calls.some(([name, ...args]) => name === "git" && JSON.stringify(args) === JSON.stringify(["remote", "get-url", "--push", "--all", "origin"])));
  assert.match(confirmation, /Push destination: ssh:\/\/git@github\.com\/allreva\/test\.git/);
});

test("multiple effective push destinations block write", async () => {
  const { runWrite } = await loadAdapter();
  const mock = runner({ pushDestination: "git@github.com:allreva/test.git\ngit@github.com:allreva/mirror.git", plan: { root: "/repo", worktree: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "pr-create", configPath: ".allreva.json", title: "[#1] Safe plan" }), { cwd: directory(), hasUI: true, confirm: async () => true, run: mock.run });
  assert.equal(result.status, "failed");
  assert.match(result.error, /exactly one effective push destination/);
  assert.deepEqual(writes(mock.calls), []);
});

test("PR body mutation after approval blocks both writes", async () => {
  const { runWrite } = await loadAdapter();
  const cwd = directory();
  const bodyPath = join(cwd, ".allreva", "body.md");
  mkdirSync(join(cwd, ".allreva"));
  writeFileSync(bodyPath, "Approved body");
  const mock = runner({ plan: { root: "/repo", worktree: "/repo/.worktrees/feat", branch: "feat/#1-safe", base: "develop", diffHash: "sha256:abc" } });
  const result = await runWrite(JSON.stringify({ version: 1, operation: "pr-create", configPath: ".allreva.json", title: "[#1] Safe plan", bodyFile: ".allreva/body.md" }), {
    cwd, hasUI: true,
    confirm: async () => { writeFileSync(bodyPath, "Mutated body"); return true; },
    run: mock.run,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(writes(mock.calls), []);
});
