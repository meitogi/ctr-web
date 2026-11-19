# CLAUDE.md — ctr-web (the bare edition)

The browser port of CTR Native (the decompiled PS1 game, built to WebAssembly with Emscripten),
**bare** : the game 1:1, with only what a browser needs, its sound, one upstream fix, the unlock
box, Share by one button and the local pads. What the project is and how to run it :
[README.md](README.md).

## The two repositories

- **This one is the base.** Second Lap (the enhanced edition : Netplay, rooms by code, screens of
  its own in the game) is built on top of it and takes its fixes **by merge, one way** : this
  repository never takes Second Lap's commits.
- A fix to what both share — the page (`web/ui`), Share (`web/share`, `web/net`), the sound
  (`web/audio`), the relay (`relay/`), the browser port (`platform/`), the test harness — is made
  **here**, then merged into Second Lap.
- Each repository has its own issues, version line, site and Pages workflow.

## The game stays the game

- `game/` differs from upstream in two places only : `game/PushBuffer.c` (the split-screen
  impostor fix, `CTR_NATIVE`) and the unlock test in `game/230/MM_Characters.c` /
  `MM_TrackSelect.c` (`WEB_UNLOCKED`, `include/platform/native_web_ui.h`, browser builds only).
  Anything else in `game/` is a change of the game : it goes to Second Lap, not here.
- Native builds are unchanged by every browser-only change : check with a native preprocess of
  `main.c` against the previous commit (token for token).

## Versions

- **Every delivery gets the next version, never a re-tag.** The page shows `git describe`
  (boot screen, bottom right, and Settings), so it is how the user tells whether a build has the
  change. Pre-release while in beta : `v1.0.0-b.15` → `v1.0.0-b.16` → …
- The tag sits on the delivered commit itself : a lightweight local tag, so the version reads
  clean (no `-N-g<sha>` suffix). Rebuild the debug game afterwards (`web/dev.sh build debug`) so
  the running page shows it.

## Git

- `web/main` is the branch (upstream's is `master`) ; `upstream` is CTR-tools/ctr-native.
- Commits are authored as `meitogi` (the repo's local identity). Commit and tag locally ; pushing
  `web/main` and the tags is the maintainer's step.

## Build and run

- `web/dev.sh dev` : Vite on 8090 (hot reload for the page), the game from `build-web-debug`, a
  relay on 8787. `web/dev.sh build [debug|release]` rebuilds the game ; reload the page after.
- Ports are listed once in [web/dev-ports.tsv](web/dev-ports.tsv) (`web/dev.sh ports --check`) ;
  Second Lap uses the same ones : run one edition's servers at a time.
- Native builds : `build.sh` / `CMakePresets.json`.

## Tests

- `node --test` in `web/` : the page's unit tests.
- [web/test/player/](web/test/player/) : the player suites (`*.suite.mjs`), driving real
  browsers over CDP against a build served by `web/test/player/serve.py` (8091–8093) and a relay
  on 8788. `bare.suite.mjs` holds what makes this edition (no room UI, unlock, the card clean,
  Share's button, the fifth player). A bug gets a scenario that reproduces it, run before and
  after the fix.
- **Three levels**, picked by `node web/test/player/select.mjs [change|tag|full] [--run]`
  (`CTR_PLAY` : the command that runs one suite, `{suite}` its name) :
  - **each change** (the default) : `node --test` and the scenarios the diff since the last tag
    touches — [coverage.mjs](web/test/player/coverage.mjs) maps paths to areas, each suite's
    `export const tags` maps its scenarios to areas ; a suite's own file runs the scenarios it
    changed ; a path no rule claims runs the smoke ; words only run nothing ;
  - **each tag** : the smoke (`coverage.mjs` SMOKE, one scenario per area) ;
  - **a release or an upstream merge** : `full`, every scenario of `coverage.mjs` SUITES.
- **Every scenario starts on its own** (any can run alone, `--only`) : `ctr.mjs startAt(ctx,
  'menu' | { race, char, mode, players })` loads that start point's snapshot or makes it (a boot in
  turbo, the direct start) and saves it ; `bootFast` is a real boot in turbo, for the card and the
  unlocks (a snapshot carries the card it was made with) ; `open(ctx, query)` loads the page. A new
  scenario gets its tags (`web/test/select.test.js` fails without them).
- The fast start (debug builds only, `web/ui/src/dev/fast.js`, `platform/web_debug_bridge.c`,
  `platform/native_platform.c`) : snapshots are upstream's quick state (F5 / F8) taken and loaded
  through `__ctrState`, kept per build in `web/test/player/.states/<build>/` (gitignored, served by
  serve.py, refused by `web/pages/guard.sh`) ; `?race=<track>&char=<name>[,…]&mode=tt|arcade|vs
  &players=<n>` starts a race from the main menu as the menus would ; `?turbo=1` /
  `ctrDev.turbo(on)` runs frames back to back — never for the sound or Share (off by itself while
  sharing) ; the page's Bot (`ctrDev.bot(true)`) drives in step with it.
- The precise start (debug builds only, `web/ui/src/dev/precise.js`, `dev/presets.js`,
  `platform/web_debug_bridge.c`, [precise.suite.mjs](web/test/player/precise.suite.mjs)) :
  - **a seed** : `?seed=<n>` sets the game's generators and its frame counters on each race's first
    frame (`__ctr.raceFrame` 0) — the same race twice, however the menus were walked ;
  - **replay** : upstream's recorder (`native_replay_scheduler.c`, started with its command line's
    arguments) : `ctr.mjs recordRace(ctx, name, { race, char, mode, laps, seed })` records a seeded
    race the Bot drives, `playRace(ctx, name)` plays it and compares (upstream's per-frame check and
    the karts every 300 frames) ; `{ rebase: true }` makes the start again on the running build — the
    way to replay across an upstream merge (a checkpoint is bound to the memory layout). Kept in
    `web/test/player/.replays/<name>/` ; `cc-arcade-seed1` (setup's RECORDINGS) is the merges' race ;
  - **saves** : [saves.mjs](web/test/player/saves.mjs) names the cards (new, full-100, partial, the
    Adventure points, ghost, N. Tropy, old version, damaged) and what each holds ; each is written
    by the game's own save (`ctrDev.card.write(spec)`, `.ghost()`), kept in `.saves/<name>/`, put in
    place before the boot by `?card=<name>` ; `importSave(path, name)` takes the user's own (a
    folder of save files, or a `.mcr` / `.mcd`), `exportSave` gives one to an emulator ;
  - `?preset=<name>` (the settings, in memory : the player's own untouched), `players(ctx, { pads,
    want })` (the seats), `ctrDev.pause() / pauseAt(raceFrame) / step(n) / resume()`, `?fault=` /
    `ctrDev.fault(name, on)` (disc-read, storage-full, card-full, relay-silent), `phone(ctx)` +
    `tap(ctx, x, y)` (a phone's viewport and touch, over CDP) ;
  - `select.mjs setup --run` makes the snapshots, the saves and the recordings ahead. Saves and
    replays hold pieces of the game : gitignored, refused by `web/pages/guard.sh`.
- Turbo emits no catch-up VBlank (debug) : a turbo run is deterministic, a slow frame no longer adds
  game time. A replay counts the XA track by VBlanks (debug, `native_audio.c`).
- The release build stays identical in code : check with `main.c` preprocessed (native) and the
  web release preprocess against the previous tag.

## Code map and gotchas

- `game/` : the decompile. `game/230/` is the main-menu overlay (D230).
- **D230 is never reloaded on native/web** (it is on the PS1) : menu cursors, menu `state` flags,
  the character select's locks and backups outlive every visit.
- C ↔ page : `EM_JS` hooks in `platform/` read `Module.ctrInput.*` and `Module.ctrShare.*`, set
  by the page (`web/ui/`, `web/share/panel.js`) ; the page never calls into the wasm (ASYNCIFY).
- Share's seats are the page's (`web/share/slots.js`) : the host's local players count among
  the four ; `platform/native_input.c` keeps a pad plugged later off a guest's seat.
- `relay/` : the WebSocket relay for Share rooms ([relay/README.md](relay/README.md)). Its image
  (`ghcr.io/meitogi/ctr-relay`, `.github/workflows/relay-image.yml`) is published from here only,
  for both editions : Second Lap has no relay-image workflow.
- Match the surrounding style : tabs in C, the existing comment density and tone.
