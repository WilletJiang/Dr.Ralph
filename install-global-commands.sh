#!/bin/bash
# Build the TypeScript CLI and install global wrappers.

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

BIN_DIR="${HOME}/.local/bin"
SCRIPT_DIR="$(resolve_script_path)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    --bin-dir=*)
      BIN_DIR="${1#*=}"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./install-global-commands.sh [--bin-dir /path/to/bin]

Builds the TypeScript Dr.Ralph CLI and installs two global commands:
  ralph
  ralph-bootstrap
EOF
      exit 0
      ;;
    *)
      echo "Error: unexpected argument '$1'."
      exit 1
      ;;
  esac
done

cd "$SCRIPT_DIR"
npm install
npm run build

mkdir -p "$BIN_DIR"

ln -sf "$SCRIPT_DIR/bin/ralph" "$BIN_DIR/ralph"
ln -sf "$SCRIPT_DIR/bin/ralph-bootstrap" "$BIN_DIR/ralph-bootstrap"

chmod 755 "$SCRIPT_DIR/bin/ralph" "$SCRIPT_DIR/bin/ralph-bootstrap" "$SCRIPT_DIR/bootstrap-ralph.sh"

echo "Installed Ralph commands into: $BIN_DIR"
echo ""
echo "Commands:"
echo "  ralph"
echo "  ralph-bootstrap"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo ""
    echo "Your PATH already includes $BIN_DIR."
    ;;
  *)
    echo ""
    echo "Add this directory to your PATH to use the commands globally:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
