#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-adapter.sh --target pi|claude|codex|all --project <repository-path> [--force]

Copies read explain-diff and bounded git-workflow adapters into project-scoped locations.
Git workflow writes remain platform-owned and require interactive native approval.
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

install_files() {
  local -a pairs=("$@") sources=() destinations=() staged=() backups=() installed=()
  local index source destination stage backup
  if (( ${#pairs[@]} == 0 || ${#pairs[@]} % 2 != 0 )); then
    echo "Internal install mapping error." >&2
    return 2
  fi
  for ((index = 0; index < ${#pairs[@]}; index += 2)); do
    source="${pairs[index]}"
    destination="${pairs[index + 1]}"
    [[ -f "$source" ]] || { echo "Adapter asset is missing: $source" >&2; return 1; }
    if [[ -e "$destination" && "$FORCE" != true ]]; then
      echo "Refusing to overwrite: $destination (use --force)" >&2
      return 1
    fi
    sources+=("$source")
    destinations+=("$destination")
  done

  local staging
  staging=$(mktemp -d "$PROJECT/.allreva-adapter.XXXXXX")
  trap 'rm -rf "$staging"' RETURN
  for ((index = 0; index < ${#sources[@]}; index += 1)); do
    stage="$staging/$index"
    cp "${sources[index]}" "$stage"
    staged+=("$stage")
    mkdir -p "$(dirname "${destinations[index]}")"
  done

  for ((index = 0; index < ${#destinations[@]}; index += 1)); do
    destination="${destinations[index]}"
    if [[ -e "$destination" ]]; then
      backup="$staging/backup-$index"
      mv "$destination" "$backup"
      backups+=("$backup")
    else
      backups+=("")
    fi
  done

  for ((index = 0; index < ${#destinations[@]}; index += 1)); do
    if ! mv "${staged[index]}" "${destinations[index]}"; then
      for destination in "${installed[@]}"; do rm -f "$destination"; done
      for ((index = 0; index < ${#destinations[@]}; index += 1)); do
        [[ -n "${backups[index]}" && -e "${backups[index]}" ]] && mv "${backups[index]}" "${destinations[index]}"
      done
      echo "Install failed; restored previous adapter files." >&2
      return 1
    fi
    installed+=("${destinations[index]}")
  done
  for destination in "${destinations[@]}"; do echo "Installed: $destination"; done
}

pi_pairs=(
  "$ROOT/integrations/pi/agents/explain-diff.md" "$PROJECT/.pi/agents/explain-diff.md"
  "$ROOT/integrations/pi/agents/git-workflow.md" "$PROJECT/.pi/agents/git-workflow.md"
  "$ROOT/integrations/pi/extensions/allreva-git-write.ts" "$PROJECT/.pi/extensions/allreva-git-write.ts"
)
claude_pairs=(
  "$ROOT/integrations/claude/agents/explain-diff.md" "$PROJECT/.claude/agents/explain-diff.md"
  "$ROOT/integrations/claude/agents/git-workflow.md" "$PROJECT/.claude/agents/git-workflow.md"
)
codex_pairs=(
  "$ROOT/integrations/codex/agents/explain-diff.toml" "$PROJECT/.codex/agents/explain-diff.toml"
  "$ROOT/integrations/codex/agents/git-workflow.toml" "$PROJECT/.codex/agents/git-workflow.toml"
)

case "$TARGET" in
  pi) install_files "${pi_pairs[@]}" ;;
  claude) install_files "${claude_pairs[@]}" ;;
  codex) install_files "${codex_pairs[@]}" ;;
  all) install_files "${pi_pairs[@]}" "${claude_pairs[@]}" "${codex_pairs[@]}" ;;
  *) echo "Unknown target: $TARGET" >&2; usage >&2; exit 2 ;;
esac
