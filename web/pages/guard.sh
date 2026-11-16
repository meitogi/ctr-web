#!/bin/bash
# guard.sh — the last lock before a deploy : refuses to let any game data
# leave this repo through the published site. Run after assemble.sh, before
# actions/upload-pages-artifact (ROLLOUT.md "No game data is ever hosted").
#
#   web/pages/guard.sh [--debug] <site-dir>
#
# --debug : a debug site for a phone on the developer's own tunnel (web/dev.sh phone) — the debug
# tools' bundle is let through, every game-data check below stays on.
#
# Fails (prints the offending path, exits 1) on the first of :
#   - any symlink (find -type f never matches one, so a linked disc image
#     would otherwise walk straight past every other check below)
#   - any *.data file (a preloaded disc)
#   - any file >= 50 MB
#   - any *.bin / *.iso / *.cue / *.img file (case-insensitive)
#   - a snapshot of the game (*.ctrstate, upstream's *.ctrstates, anything under a .states/ or
#     __states/ folder : web/test/player/serve.py's) — the game's memory, pieces of the disc
#   - preload-flag.js saying window.__CTR_WEB_PRELOAD = true
#   - any .js/.html file literally setting window.__CTR_WEB_PRELOAD = true
#   - any .js file carrying the debug tools (« ctr-dev-tools », web/ui/src/dev/ : the
#     second window, the Bot switch — a Debug build's bundle, never published)
# On success, prints the accepted file list and the site's total size, and
# exits 0. CTR_WEB_PRELOAD_DISC is never ON in the Pages workflow — this is
# the second lock, not the only one.
set -euo pipefail

debug=0
if [ "${1:-}" = --debug ]; then debug=1; shift; fi
site=${1:?usage: guard.sh [--debug] <site-dir>}
[ -d "$site" ] || { echo "guard.sh: no such directory: $site" >&2; exit 1; }

max_bytes=$((50 * 1024 * 1024))

fail() {
  echo "guard.sh: REFUSED — $1: $2" >&2
  exit 1
}

while IFS= read -r -d '' l; do
  fail "a symlink (not allowed in a published site)" "$l"
done < <(find "$site" -type l -print0)

while IFS= read -r -d '' f; do
  name=$(basename "$f")
  lower=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')

  case "$lower" in
    *.data) fail "a .data file (preloaded disc)" "$f" ;;
    *.bin | *.iso | *.cue | *.img) fail "a disc image extension" "$f" ;;
    *.ctrstate | *.ctrstates) fail "a snapshot of the game (its memory)" "$f" ;;
    *.ctrreplay | memcard.seed | memcard.recording | memcard.playback) fail "a recorded race (upstream's replay files)" "$f" ;;
    bascus-94426*) fail "a memory card save of the game (its icon frames)" "$f" ;;
    *.mcr | *.mcd | *.mc | *.mcs | *.gme | *.psv | *.psx | *.srm | *.vmp | *.vm1 | *.ddf) fail "a memory card image" "$f" ;;
  esac
  case "/${f#"$site"}" in
    */.states/* | */__states/*) fail "a snapshot folder (the tests' game states)" "$f" ;;
    */.saves/* | */__saves/*) fail "a memory card folder (the tests' saves)" "$f" ;;
    */.replays/* | */__replays/*) fail "a replay folder (the tests' recorded races)" "$f" ;;
    */memcard.seed/* | */memcard.recording/* | */memcard.playback/*) fail "a replay's memory card" "$f" ;;
  esac

  size=$(stat -c%s "$f")
  [ "$size" -ge "$max_bytes" ] && fail "file >= 50 MB ($size bytes)" "$f"

  if [ "$name" = "preload-flag.js" ] && grep -q '__CTR_WEB_PRELOAD *= *true' "$f"; then
    fail "preload-flag.js says true" "$f"
  fi
  case "$lower" in
    *.js | *.html)
      if grep -q 'window\.__CTR_WEB_PRELOAD *= *true' "$f"; then
        fail "sets window.__CTR_WEB_PRELOAD = true" "$f"
      fi
      if [ "$debug" = 0 ] && grep -q 'ctr-dev-tools' "$f"; then
        fail "the debug tools (a Debug build's page bundle)" "$f"
      fi
      ;;
  esac
done < <(find "$site" -type f -print0)

echo "guard.sh: accepted files :"
find "$site" -type f -printf '%10s  %p\n' | sort -k2
total=$(find "$site" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')
echo "guard.sh: total size: $total bytes"
