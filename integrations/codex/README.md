# Codex Git workflow adapter

This asset is policy-only, weaker than Pi custom-tool enforcement. Agent TOML selects workspace-write sandbox only; it does not set host approval policy. User configuration can weaken this boundary.

Install with `scripts/install-adapter.sh --target codex --project <repo>`. Start Codex interactively with workspace-write sandbox and `approval_policy = "untrusted"`. Native approval dialog must appear for each fixed protocol write. Noninteractive execution and approval-skipping launch modes are unsupported.

Read shared [`../../git-write/PROTOCOL.md`](../git-write/PROTOCOL.md). Use disposable repository and GitHub test repository before production: deny and approve each operation; inspect argv, result, receipt, base/head; confirm no PR integration action. Worktree root must be writable inside configured workspace.
