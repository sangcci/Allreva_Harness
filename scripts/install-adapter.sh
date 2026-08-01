#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-adapter.sh --target pi|claude|codex|all --project <repository-path> [--force]

Copies the explain-diff adapter into a project-scoped location.
The adapter reads the shared role contract from ALLREVA_HARNESS_ROOT or from a
sibling Allreva_Harness directory. It does not copy the role contract itself.
EOF
}

TARGET=""
PROJECT=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" || -z "$PROJECT" ]]; then
  usage >&2
  exit 2
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJECT=$(cd "$PROJECT" && pwd)

if [[ ! -e "$PROJECT/.git" ]]; then
  echo "Project must be a Git worktree: $PROJECT" >&2
  exit 2
fi

install_one() {
  local source="$1"
  local destination="$2"
  mkdir -p "$(dirname "$destination")"
  if [[ -e "$destination" && "$FORCE" != true ]]; then
    echo "Refusing to overwrite: $destination (use --force)" >&2
    return 1
  fi
  cp "$source" "$destination"
  echo "Installed: $destination"
}

case "$TARGET" in
  pi)
    install_one "$ROOT/integrations/pi/agents/explain-diff.md" "$PROJECT/.pi/agents/explain-diff.md"
    ;;
  claude)
    install_one "$ROOT/integrations/claude/agents/explain-diff.md" "$PROJECT/.claude/agents/explain-diff.md"
    ;;
  codex)
    install_one "$ROOT/integrations/codex/agents/explain-diff.toml" "$PROJECT/.codex/agents/explain-diff.toml"
    ;;
  all)
    install_one "$ROOT/integrations/pi/agents/explain-diff.md" "$PROJECT/.pi/agents/explain-diff.md"
    install_one "$ROOT/integrations/claude/agents/explain-diff.md" "$PROJECT/.claude/agents/explain-diff.md"
    install_one "$ROOT/integrations/codex/agents/explain-diff.toml" "$PROJECT/.codex/agents/explain-diff.toml"
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    usage >&2
    exit 2
    ;;
esac
