#!/bin/bash
# test-guard.sh — negative tests for guard.sh : a clean site passes, each
# seeded bad case fails it. Local only, not part of the workflow.
#
#   web/pages/test-guard.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
guard="$here/guard.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

clean="$tmp/clean"
mkdir -p "$clean/ui"
echo '<!doctype html><title>ok</title>' >"$clean/index.html"
echo 'window.__CTR_WEB_PRELOAD = false;' >"$clean/preload-flag.js"
echo 'console.log(1)' >"$clean/ui/ui.js"

pass=0
fail=0
check() {
  local desc=$1 dir=$2 want=$3 # want: pass | fail
  local out got
  if out=$("$guard" "$dir" 2>&1); then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    echo "PASS: $desc (guard $got, expected $want)"
    pass=$((pass + 1))
  else
    echo "FAIL: $desc (guard $got, expected $want)"
    echo "$out"
    fail=$((fail + 1))
  fi
}

check "clean site" "$clean" pass

bad="$tmp/fake-bin"
cp -r "$clean/." "$bad/"
printf 'fake' >"$bad/ctr-u.bin"
check "a fake ctr-u.bin" "$bad" fail

bad="$tmp/data-file"
cp -r "$clean/." "$bad/"
printf 'fake' >"$bad/ctr_native.data"
check "a .data file" "$bad" fail

bad="$tmp/big-file"
cp -r "$clean/." "$bad/"
head -c $((51 * 1024 * 1024)) /dev/zero >"$bad/huge.js"
check "a 51 MB file" "$bad" fail

bad="$tmp/upper-iso"
cp -r "$clean/." "$bad/"
printf 'fake' >"$bad/CTR-U.ISO"
check "an uppercase .ISO" "$bad" fail

bad="$tmp/preload-true"
cp -r "$clean/." "$bad/"
echo 'window.__CTR_WEB_PRELOAD = true;' >"$bad/preload-flag.js"
check "preload flag set to true" "$bad" fail

bad="$tmp/symlinked-disc"
cp -r "$clean/." "$bad/"
outside="$tmp/outside-disc.bin"
printf 'fake' >"$outside"
ln -s "$outside" "$bad/linked.bin"
check "a symlink to a file outside the site dir" "$bad" fail

bad="$tmp/snapshot"
cp -r "$clean/." "$bad/"
printf 'fake' >"$bad/menu.ctrstate"
check "a snapshot of the game (.ctrstate)" "$bad" fail

bad="$tmp/quick-state"
cp -r "$clean/." "$bad/"
printf 'fake' >"$bad/QUICK.CTRSTATES"
check "upstream's quick state (.ctrstates, uppercase)" "$bad" fail

bad="$tmp/states-folder"
cp -r "$clean/." "$bad/"
mkdir -p "$bad/.states/0123456789abcdef"
printf '{}' >"$bad/.states/0123456789abcdef/menu.json"
check "a snapshot folder (.states/, its metadata)" "$bad" fail

# session 45b : saves, card images and recorded races
refused() { # <name> <relative path> <description>
  bad="$tmp/$1"
  cp -r "$clean/." "$bad/"
  mkdir -p "$(dirname "$bad/$2")"
  printf 'fake' >"$bad/$2"
  check "$3" "$bad" fail
}
refused replay input.ctrreplay "a recorded race (.ctrreplay)"
refused replay-seed debug/memcard.seed "a replay's card seed"
refused replay-card memcard.seed/slot0/BASCUS-94426-SLOTS "a replay's card folder (memcard.seed/)"
refused replays-folder .replays/cc/samples.json "a replay folder (.replays/, its samples)"
refused replays-served __replays/cc/what.json "the replays' served path (__replays/)"
refused profile BASCUS-94426-SLOTS "the game's profile save"
refused ghost bascus-94426gAAAAAA "a ghost save (lowercase)"
refused mcr card.mcr "a memory card image (.mcr)"
refused mcd card.MCD "a memory card image (.MCD)"
refused gme card.gme "a memory card image (.gme)"
refused saves-folder .saves/full-100/what.json "a save folder (.saves/, its notes)"
refused saves-served __saves/new/index.json "the saves' served path (__saves/)"

echo "test-guard.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
