# Harness integration templates

Platform adapters connect harness contracts to coding environments. Common role contracts stay in this repository.

## Install

Harness and target project must share parent directory, or set `ALLREVA_HARNESS_ROOT`.

```bash
./scripts/install-adapter.sh --target all --project ../Allreva_BE
```

Installer copies each target's explain-diff and git-workflow assets. Existing files need explicit `--force`. It validates full target mapping before replacing adapter files and rolls back replaced files if a later move fails.

| Environment | Installed assets |
| --- | --- |
| Pi | `.pi/agents/explain-diff.md`, `.pi/agents/git-workflow.md`, `.pi/extensions/allreva-git-write.ts` |
| Claude Code | `.claude/agents/explain-diff.md`, `.claude/agents/git-workflow.md` |
| Codex | `.codex/agents/explain-diff.toml`, `.codex/agents/git-workflow.toml` |

## Git write boundary

[`git-write/PROTOCOL.md`](git-write/PROTOCOL.md) defines three bounded operations: worktree creation, push plus PR creation, and safe cleanup. Core and CLI remain read-only. Receipts are audit evidence, not authority.

Pi has strong adapter-only MVP enforcement: write agent exposes custom native-confirmed tool, not general shell tool. Use interactive Pi only.

Claude Code and Codex adapters are policy-only. Their general shell capability and user configuration can weaken restrictions. Follow platform README: interactive native approval for every exact write; never use noninteractive or permission-skipping modes. Manual disposable-repository checks remain required before production use.

## Pi package use

Pi can load this package without install for current run:

```bash
pi -e /absolute/path/to/Allreva_Harness
```

Project install copies platform assets only; it does not alter shared contracts.
