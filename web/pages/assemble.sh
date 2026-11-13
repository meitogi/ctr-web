#!/bin/bash
# assemble.sh — copies one build output into a Pages-ready site tree, at its
# root. An explicit allowlist, never a wildcard copy of a build dir (which
# also holds CMake cache files, tests/, .o). Every path in the page is
# relative : the site works under a sub-path too (a project page's
# /ctr-web/, an installed app).
#
#   web/pages/assemble.sh <build-dir> <site-dir>
#
# <build-dir> : a web/build-web.sh release build
# <site-dir>  : recreated from scratch
#
# Run web/pages/guard.sh on the result before publishing it anywhere.
set -euo pipefail

build=${1:?usage: assemble.sh <build-dir> <site-dir>}
site=${2:?usage: assemble.sh <build-dir> <site-dir>}

# Every build (web/emscripten.cmake, web/share/share.cmake, web/audio/audio.cmake).
COMMON_FILES=(index.html disc.js preload-flag.js ctr_native.js ctr_native.wasm)
COMMON_DIRS=(ui share net audio)

copy_build() {
  local src=$1 dst=$2
  mkdir -p "$dst"
  for f in "${COMMON_FILES[@]}"; do
    [ -f "$src/$f" ] || { echo "assemble.sh: missing $src/$f" >&2; exit 1; }
    cp "$src/$f" "$dst/$f"
  done
  for d in "${COMMON_DIRS[@]}"; do
    [ -d "$src/$d" ] || { echo "assemble.sh: missing $src/$d/" >&2; exit 1; }
    cp -r "$src/$d" "$dst/$d"
  done
}

rm -rf "$site"
mkdir -p "$site"

copy_build "$build" "$site"

# Confirmed against GitHub's own docs this session : a CNAME file is not
# read under the Actions-deploy flow (the custom domain lives in Settings >
# Pages only, TEST-PLAN-13.md), and .nojekyll is a "Deploy from a branch"
# concern. Both are harmless, so both are kept.
: > "$site/.nojekyll"
echo "ctr.suuuper.app" > "$site/CNAME"

echo "assemble.sh: assembled $site :"
find "$site" -type f | sort
