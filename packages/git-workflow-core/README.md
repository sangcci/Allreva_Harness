# Git Workflow Core

`@allreva/git-workflow-core` provides read-only Git workflow validation and plans.

Features:

- config, Issue, PR, branch, and commit validation
- current Git root, branch, and porcelain status lookup
- worktree, PR, and cleanup preflight plans
- scoped audit-receipt validation

Core and CLI never create worktrees, branches, commits, remotes, Issues, or PRs. Platform adapter owns Git/GitHub writes only after native human UI confirmation. Preflight result and audit receipt never authorize a write.

## Workflow config

```json
{
  "workflow": {
    "id": "allreva-be",
    "worktreeRoot": ".worktrees"
  }
}
```

`worktreeRoot` must be non-empty repository-relative path. Absolute, Windows-rooted, UNC, parent-traversal, and symbolic-link paths fail. Worktree directory names use URI encoding.

## Audit receipts

Adapter may store human-confirmation record and validate its shape/scope with `validateAuditReceipt`. Receipt is audit evidence only; no preflight consumes it or treats it as authorization.

```json
{
  "receiptId": "adapter-record-123",
  "workflowId": "allreva-be",
  "stage": "pr-creation",
  "branch": "feat/#42-safe-plan",
  "worktree": ".worktrees/feat%2F%2342-safe-plan",
  "diffHash": "sha256:<calculateDiffHash output>",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## CLI

```sh
allreva-git worktree preflight --config .allreva.json --branch 'feat/#42-safe-plan'
allreva-git pr preflight --config .allreva.json --expected-path docs/guide.md --expected-path docs/checklist.md
allreva-git pr preflight --config .allreva.json --coverage staged
allreva-git cleanup preflight --config .allreva.json --path 'feat%2F%2342-safe-plan'
```

`preflightWorktreeCreate` only returns non-writing `git worktree add` plan. `preflightPullRequest` validates current configured worktree and local base, then reports `plan.changes.staged`, `unstaged`, `untracked`, and `ignored` paths. No coverage input allows no local changes. Repeated `--expected-path` selects exact paths that must all be staged; any unlisted staged path or any unstaged, untracked, or ignored path blocks readiness. `--coverage staged` permits current staged paths but still blocks unstaged, untracked, and ignored paths. These inputs are mutually exclusive. This catches selected-stage omissions before commit; renamed/copied entries include both paths. `preflightCleanup` rejects unregistered, locked, primary, dirty, untracked, or ignored worktrees; requires local branch merged into configured base; plans non-force `git worktree remove` and `git branch -d` only. Core does not inspect remote merge state or perform writes.
