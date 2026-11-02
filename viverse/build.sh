#!/usr/bin/env bash
# Builds the VIVERSE upload zips (index.html at the zip root):
#   dist/openfront-viverse-prod.zip -> frames https://openfront.io
#   dist/openfront-viverse-test.zip -> frames https://viverse.openfront.dev
set -euo pipefail

cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist

build() {
  local name=$1 origin=$2 dir="dist/$1"
  mkdir -p "$dir"
  sed "s#^\(\s*const GAME_ORIGIN = \)\".*\";#\1\"$origin\";#" index.html >"$dir/index.html"
  grep -q "const GAME_ORIGIN = \"$origin\";" "$dir/index.html" || {
    echo "failed to set GAME_ORIGIN in $dir/index.html" >&2
    exit 1
  }
  if command -v zip >/dev/null; then
    (cd "$dir" && zip -q -X "../openfront-viverse-$name.zip" index.html)
  else
    python3 -c 'import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[2], "index.html")' "dist/openfront-viverse-$name.zip" "$dir/index.html"
  fi
  rm -rf "$dir"
  echo "dist/openfront-viverse-$name.zip -> $origin"
}

build prod https://openfront.io
build test https://viverse.openfront.dev
