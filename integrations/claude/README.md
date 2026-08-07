# Claude Code Git workflow adapter

This asset is policy-only, weaker than Pi custom-tool enforcement. Claude Code keeps general Bash available and user settings can override agent instructions.

Install with `scripts/install-adapter.sh --target claude --project <repo>`. Run Claude Code interactively in default permission mode. Native permission dialog must appear for each fixed protocol write. Do not use noninteractive execution, persistent allow rules for Git/GitHub clients, or permission-skipping launch options.

Read shared [`../../git-write/PROTOCOL.md`](../git-write/PROTOCOL.md). Use disposable repository and GitHub test repository before production: deny and approve each operation; inspect argv, result, receipt, base/head; confirm no PR integration action.
