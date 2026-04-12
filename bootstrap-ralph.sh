#!/bin/bash
# Bootstrap Ralph into a target project directory.
# Usage: bootstrap-ralph.sh /path/to/project [--force]

set -euo pipefail

resolve_script_path() {
  local source_path="${BASH_SOURCE[0]}"
  while [ -L "$source_path" ]; do
    local source_dir
    source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    [[ "$source_path" != /* ]] && source_path="$source_dir/$source_path"
  done
  cd -P "$(dirname "$source_path")" && pwd
}

FORCE=false
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./bootstrap-ralph.sh /path/to/project [--force]

Installs the Ralph research harness into the target project directory.

By default the script refuses to overwrite existing files or directories.
Use --force to replace existing Ralph-managed paths.
EOF
      exit 0
      ;;
    *)
      if [[ -z "$TARGET_DIR" ]]; then
        TARGET_DIR="$1"
        shift
      else
        echo "Error: unexpected argument '$1'."
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  echo "Error: target project directory is required."
  echo "Usage: ./bootstrap-ralph.sh /path/to/project [--force]"
  exit 1
fi

SCRIPT_DIR="$(resolve_script_path)"

if [[ -e "$TARGET_DIR" && ! -d "$TARGET_DIR" ]]; then
  echo "Error: target path exists but is not a directory."
  exit 1
fi

mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

mkdir -p "$TARGET_DIR/scripts/ralph"

declare -a TARGETS=(
  "$TARGET_DIR/scripts/ralph/ralph.sh"
  "$TARGET_DIR/scripts/ralph/CODEX.md"
  "$TARGET_DIR/scripts/ralph/prompt.md"
  "$TARGET_DIR/scripts/ralph/CLAUDE.md"
  "$TARGET_DIR/scripts/ralph/research_program.json"
  "$TARGET_DIR/idea.md"
  "$TARGET_DIR/research"
  "$TARGET_DIR/experiments"
)

if [[ "$FORCE" != "true" ]]; then
  COLLISIONS=()
  for path in "${TARGETS[@]}"; do
    if [[ -e "$path" ]]; then
      COLLISIONS+=("$path")
    fi
  done

  if [[ ${#COLLISIONS[@]} -gt 0 ]]; then
    echo "Error: bootstrap would overwrite existing paths:"
    for path in "${COLLISIONS[@]}"; do
      echo "  $path"
    done
    echo "Re-run with --force if you want to replace them."
    exit 1
  fi
fi

cp "$SCRIPT_DIR/ralph.sh" "$TARGET_DIR/scripts/ralph/ralph.sh"
chmod 755 "$TARGET_DIR/scripts/ralph/ralph.sh"
cp "$SCRIPT_DIR/CODEX.md" "$TARGET_DIR/scripts/ralph/CODEX.md"
cp "$SCRIPT_DIR/prompt.md" "$TARGET_DIR/scripts/ralph/prompt.md"
cp "$SCRIPT_DIR/CLAUDE.md" "$TARGET_DIR/scripts/ralph/CLAUDE.md"
cp "$SCRIPT_DIR/research_program.json.example" "$TARGET_DIR/scripts/ralph/research_program.json"
cp "$SCRIPT_DIR/idea.md" "$TARGET_DIR/idea.md"
rm -rf "$TARGET_DIR/research" "$TARGET_DIR/experiments"
cp -R "$SCRIPT_DIR/research" "$TARGET_DIR/research"
cp -R "$SCRIPT_DIR/experiments" "$TARGET_DIR/experiments"

echo "Ralph bootstrapped into: $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  ./scripts/ralph/ralph.sh --init-intake"
echo "  ./scripts/ralph/ralph.sh"
