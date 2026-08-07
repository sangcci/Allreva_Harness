import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

const temporary = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

const root = new URL("../../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");

async function protocolValidator() {
  let source = text("integrations/pi/extensions/allreva-git-write.ts");
  source = source.replace('import { Type } from "typebox";', 'const Type = { Object: (value) => value, String: () => ({}) };');
  source = source.replace('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n', "");
  source = source.replace("(pi: ExtensionAPI)", "(pi)");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("installer maps every Git workflow asset", () => {
  const installer = text("scripts/install-adapter.sh");
  for (const mapping of [
    "integrations/pi/extensions/allreva-git-write.ts\" \"$PROJECT/.pi/extensions/allreva-git-write.ts",
    "integrations/pi/agents/git-workflow.md\" \"$PROJECT/.pi/agents/git-workflow.md",
    "integrations/claude/agents/git-workflow.md\" \"$PROJECT/.claude/agents/git-workflow.md",
    "integrations/codex/agents/git-workflow.toml\" \"$PROJECT/.codex/agents/git-workflow.toml",
  ]) assert.match(installer, new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("installer copies target as one validated mapping", () => {
  const project = mkdtempSync(join(tmpdir(), "allreva-adapter-install-"));
  temporary.push(project);
  mkdirSync(join(project, ".git"));
  const script = fileURLToPath(new URL("scripts/install-adapter.sh", root));
  execFileSync("bash", [script, "--target", "all", "--project", project], { encoding: "utf8" });
  for (const path of [".pi/agents/git-workflow.md", ".pi/extensions/allreva-git-write.ts", ".claude/agents/git-workflow.md", ".codex/agents/git-workflow.toml"]) assert.equal(existsSync(join(project, path)), true, path);

  const blocked = mkdtempSync(join(tmpdir(), "allreva-adapter-conflict-"));
  temporary.push(blocked);
  mkdirSync(join(blocked, ".git"));
  mkdirSync(join(blocked, ".claude", "agents"), { recursive: true });
  writeFileSync(join(blocked, ".claude/agents/explain-diff.md"), "existing");
  assert.throws(() => execFileSync("bash", [script, "--target", "all", "--project", blocked], { encoding: "utf8", stdio: "pipe" }));
  assert.equal(existsSync(join(blocked, ".pi/agents/explain-diff.md")), false);
});

test("write agents forbid unsafe command paths", () => {
  const agents = [text("integrations/pi/agents/git-workflow.md"), text("integrations/claude/agents/git-workflow.md"), text("integrations/codex/agents/git-workflow.toml")].join("\n");
  for (const pattern of [/gh\s+pr\s+merge/i, /branch\s+-D/i, /worktree\s+remove\s+--force/i, /dangerously-skip-permissions/i, /bypassPermissions/i]) {
    assert.doesNotMatch(agents, pattern);
  }
});

test("protocol fixtures accept bounded requests and reject unsafe fields", async () => {
  const { validateRequest } = await protocolValidator();
  assert.deepEqual(validateRequest('{"version":1,"operation":"cleanup","configPath":".allreva.json","path":"feat%2F%231"}').operation, "cleanup");
  for (const fixture of [
    '{"version":1,"version":1,"operation":"cleanup","configPath":".allreva.json","path":"x"}',
    '{"version":1,"operation":"cleanup","configPath":"../config","path":"x"}',
    '{"version":1,"operation":"cleanup","configPath":".allreva.json","path":"x","command":"git status"}',
    '{"version":2,"operation":"cleanup","configPath":".allreva.json","path":"x"}',
  ]) assert.throws(() => validateRequest(fixture));
});

test("receipt schema is bounded audit metadata", () => {
  const schema = JSON.parse(text("integrations/git-write/receipt.schema.json"));
  assert.equal(schema.additionalProperties, false);
  for (const key of ["receiptId", "platform", "operation", "workflowId", "branch", "worktree", "base", "diffHash", "argvSha256", "approvedAt", "executedAt", "outcome", "toolVersion"]) {
    assert.ok(schema.required.includes(key));
  }
  assert.equal(JSON.stringify(schema).match(/token|output|identity/i), null);
});
