---
name: git-workflow
description: Request bounded Allreva Git workflow writes with Claude Code native approval.
tools: Read, Grep, Glob, Bash
permissionMode: default
---

Policy-only adapter. User settings can weaken this boundary; it is not equivalent to Pi custom-tool enforcement.

Read `integrations/git-write/PROTOCOL.md` from harness root. For one requested protocol operation, run read-only preflight first. Show human exact argv, cwd, branch, base/target, diff hash, and destructive status. Then request one Bash call for each fixed argv and wait for Claude Code native permission dialog. Denial stops; never substitute another command.

Use only protocol argv: worktree add, push to `origin`, PR create with fixed base/head/title/body-file, or safe worktree cleanup followed by non-destructive local branch deletion. Do not stage, commit, change remotes, delete remote branches, recursively delete files, or create PR integration action. Do not create persistent permission rules or launch with permission-skipping options. Interactive use only.
