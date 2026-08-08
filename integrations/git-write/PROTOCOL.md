# Git write adapter protocol v1

Core and CLI stay read-only. This protocol is adapter input only. One native interactive approval is required for every write command. A receipt is audit evidence, never authorization.

## Request

Tool input has one UTF-8 JSON string. Duplicate keys, unknown keys, non-v1 requests, NUL or newline fields, absolute/traversal paths, and oversized text fail closed.

```json
{"version":1,"operation":"worktree-create","configPath":".allreva.json","branch":"feat/#42-safe-plan"}
```

Allowed keys and required fields:

| Operation | Keys | Preconditions and fixed writes |
| --- | --- | --- |
| `worktree-create` | `version`, `operation`, `configPath`, `branch` | Run `allreva-git worktree preflight`. Derive only `git worktree add <target> -b <branch> <base>`. |
| `pr-create` | `version`, `operation`, `configPath`, `title`, optional `bodyFile`, optional `remote` | `remote`, when present, is only `origin`. Derive effective push URL with `git remote get-url --push --all origin`, which applies Git URL rewrite rules. Require exactly one GitHub HTTPS/SSH destination and bind normalized destination into approval scope. Validate PR title, current configured worktree, clean status, `gh` auth, and no existing head PR. Read bounded `bodyFile` content before approval and bind its hash into scope. Approve and run `git push -u origin <branch>`, then recheck and separately approve/run `gh pr create --base <base> --head <branch> --title <title> [--body <captured content>]`. |
| `cleanup` | `version`, `operation`, `configPath`, `path` | Run cleanup preflight. Derive and run, in order only, `git worktree remove <target>` then `git branch -d <branch>`. |

`configPath`, `path`, and `bodyFile` are nonempty repository-relative paths. `bodyFile` is read as bounded UTF-8 content before approval; captured content, not mutable source path, is passed to `gh` and is not stored in receipt. `branch` and `title` are bounded strings. No command field exists.

Before commit, caller may run read-only change-completeness preflight: `allreva-git pr preflight --config .allreva.json --expected-path <path> ...` requires exact expected paths staged, while `--coverage staged` permits all staged paths. Both block unstaged, untracked, and ignored paths, catching selected-stage omissions. These CLI inputs are not `pr-create` protocol fields and never authorize a write; adapter still requires clean status immediately before push.

Adapter reruns all relevant preflight and scope checks after approval. Any changed normalized scope, diff hash, or argv blocks write. Adapter uses executable-plus-argv APIs only. No shell, command substitution, arbitrary remote, stage, commit, remote deletion, recursive deletion, forced deletion, or PR integration operation exists in v1.

## Response

```json
{"version":1,"status":"cancelled","operation":"cleanup","error":"optional safe diagnostic"}
```

`status` is `cancelled`, `blocked`, `executed`, or `failed`. `receiptPath` appears only when adapter wrote an audit receipt after attempted execution. Decline executes nothing for unstarted command.

## Platform boundary

Pi provides custom-tool enforcement in interactive UI. Its write agent exposes read tools and `allreva_git_write`, not general shell tool. Claude Code and Codex assets are policy-only: user configuration can weaken them. Use their interactive native permission dialogs; noninteractive runs are unsupported for writes.
