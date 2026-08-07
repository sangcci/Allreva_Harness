#!/usr/bin/env node
import { basename, dirname, resolve } from "node:path";
import {
  inspectGit,
  loadConfig,
  preflightCleanup,
  preflightPullRequest,
  preflightWorktreeCreate,
  validateBranch,
  validateCommitMessage,
  validateIssueTitle,
  validatePullRequestTitle,
} from "../../git-workflow-core/src/index.js";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "inspect") {
    print({ ok: true, value: inspectGit(process.cwd()), errors: [] });
  } else if (command === "validate") {
    runValidate(args);
  } else if (command === "worktree") {
    runWorktree(args);
  } else if (command === "pr") {
    runPullRequestPreflight(args);
  } else if (command === "cleanup") {
    runCleanup(args);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  print({ ok: false, value: null, errors: [error.message] });
  process.exitCode = 1;
}

function runValidate(args) {
  const [target, ...rest] = args;
  const options = parseOptions(rest);
  const config = loadConfig(required(options, "config"));
  let result;

  if (target === "issue") result = validateIssueTitle(config, required(options, "title"));
  else if (target === "pr") result = validatePullRequestTitle(config, required(options, "title"));
  else if (target === "commit") result = validateCommitMessage(config, required(options, "message"));
  else if (target === "branch") {
    result = validateBranch(config, {
      type: required(options, "type"),
      issue: Number(required(options, "issue")),
      slug: required(options, "slug"),
    });
  } else throw new Error("Validation target must be issue, pr, commit, or branch.");

  print(result);
  if (!result.ok) process.exitCode = 1;
}

function runWorktree(args) {
  const [target, ...rest] = args;
  if (target !== "preflight") throw new Error("Worktree target must be preflight.");
  const options = parseOptions(rest);
  const result = preflightWorktreeCreate(loadConfig(required(options, "config")), {
    cwd: process.cwd(),
    branch: required(options, "branch"),
  });
  print(result);
  if (!result.ok) process.exitCode = 1;
}

function runPullRequestPreflight(args) {
  const [target, ...rest] = args;
  if (target !== "preflight") throw new Error("PR target must be preflight.");
  const options = parseOptions(rest);
  const result = preflightPullRequest(loadConfig(required(options, "config")), { cwd: process.cwd() });
  print(result);
  if (!result.ok) process.exitCode = 1;
}

function runCleanup(args) {
  const [target, ...rest] = args;
  if (target !== "preflight") throw new Error("Cleanup target must be preflight.");
  const options = parseOptions(rest);
  const result = preflightCleanup(loadConfig(required(options, "config")), {
    cwd: process.cwd(),
    path: required(options, "path"),
  });
  print(result);
  if (!result.ok) process.exitCode = 1;
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid option near '${key ?? ""}'.`);
    options[key.slice(2)] = value;
  }
  return options;
}

function required(options, key) {
  if (!options[key]) throw new Error(`Missing --${key}.`);
  return options[key];
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function usage() {
  const executable = basename(process.argv[1]);
  const root = dirname(dirname(dirname(resolve(process.argv[1]))));
  process.stderr.write(`Usage:
  ${executable} inspect
  ${executable} validate issue --config <file> --title <title>
  ${executable} validate pr --config <file> --title <title>
  ${executable} validate commit --config <file> --message <message>
  ${executable} validate branch --config <file> --type <type> --issue <number> --slug <slug>
  ${executable} worktree preflight --config <file> --branch <branch>
  ${executable} pr preflight --config <file>
  ${executable} cleanup preflight --config <file> --path <relative-worktree-path>
Harness root: ${root}
`);
}
