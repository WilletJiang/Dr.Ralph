#!/bin/bash

set -euo pipefail

resolve_script_dir() {
  local source_path="${BASH_SOURCE[0]}"
  while [ -L "$source_path" ]; do
    local source_dir
    source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    [[ "$source_path" != /* ]] && source_path="$source_dir/$source_path"
  done
  cd -P "$(dirname "$source_path")" && pwd
}

SCRIPT_DIR="$(resolve_script_dir)"
PACKAGE_ROOT="$SCRIPT_DIR"

if [ ! -f "$PACKAGE_ROOT/dist/cli-bin.js" ]; then
  echo "Dr.Ralph CLI is not built yet. Run 'npm install' and 'npm run build' first."
  exit 1
fi

exec node "$PACKAGE_ROOT/dist/cli-bin.js" init "$@"
