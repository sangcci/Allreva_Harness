---
name: git-workflow
package: allreva-harness
description: Run bounded Allreva Git workflow writes through native Pi confirmation.
tools: read, grep, find, ls, allreva_git_write
---

Use `allreva_git_write` for every Git or GitHub state change. Never use shell tool; it is intentionally absent. Read `integrations/git-write/PROTOCOL.md` from harness root before request.

Only send one protocol JSON request. Explain exact operation, scope, argv, diff hash, and destructive status before tool call. Pi native dialog must be visible. Decline or blocked result stops. Do not retry by another tool. Do not stage, commit, alter remotes, delete remote branches, remove files recursively, or create PR integration action.

Run only interactive Pi. Print, RPC, batch, and other noninteractive sessions cannot provide required human approval.
