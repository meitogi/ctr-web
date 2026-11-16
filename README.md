# CTR Web

**ctr. in your browser. as it was.** bring your own disc, grab a pad, ruin a few
friendships. gg.

a [Meitogi](https://github.com/meitogi) thing. **beta** : it works, it has bugs, tell us
([report a problem](#report-a-problem)).

> **[Play at ctr.suuuper.app](https://ctr.suuuper.app/)**

no install. no emulator. no plugin. no sketchy .exe from a forum post in 2009. it's the
decompiled PS1 game rebuilt for the web, forked from
[CTR Native](https://github.com/CTR-tools/ctr-native), the native PC port.

**the bare edition** : the game 1:1, as near as a browser allows. nothing changed in it but
what a browser needs to run it and play its sound, one upstream fix (split screen, below), and
a box to unlock everything. the deep changes — Netplay, rooms by code, screens of our own in the
game — live in **Second Lap**, the enhanced edition, built on top of this one.

## bring your own disc

we don't host the game. don't ask. you know why (lawyers).

you need your own **NTSC-U** copy as a raw disc image : `ctr-u.bin`, `MODE2/2352`, what a
CD ripper spits out. a cooked 2048-byte `.iso` won't do — no voices, no videos, sad Aku
Aku. loose or in a `.zip`, drop it anywhere on the page **once**. it lives in your
browser now. nothing gets uploaded. next time you just press the button and send it.

## what works

- **the whole game, in a tab** — menus, races, music, voices, saves kept in your
  browser. clear your site data and that's on you.
- **everything unlocked** — a box on the home page (and Settings › System), ticked by default :
  every character, track and arena, everywhere but Adventure. your save keeps its own
  progress : untick it and you're back to what you earned (mid-game it asks to restart).
- **controls** — keyboard or any gamepad, remap every button in Settings (Triangle to
  accelerate ? bold. respect.), the right button icons for your pad. pads start in analog
  (ANA), Select + Start flips to digital (DIG), just like the PlayStation's Analog button.
- **couch party** — 2 to 4 players, 1 screen, 0 friendships left. one pad each, or two
  on one keyboard (left half WASD, right half arrows, elbows included). each pad you plug in
  is the next player ; swap them in Settings › Players.
- **Share** — the couch, minus the couch. press **Share** over the game : the link is copied
  and shown. your friends open it and play as the next players **with no disc** — four in
  all, yours included. they get your whole game as live video + sound, from the main menu to
  the podium — so a bit of delay — you get their pads, peer to peer. they lose, it's lag.
  they win, it's skill. classic. press it again to stop.

## on a phone

it runs : measured on an iPhone mini (Safari), a whole race at the game's own 30 fps. Android : not
measured yet.

- **put it on your Home Screen.** the bar at the bottom of the home page says how : on iPhone, the
  Share button then « Add to Home Screen » ; on Android, Install (or the browser's ⋮ menu). it opens
  full screen, no browser bars, and keeps the screen awake while you play.
- **the disc, on the phone.** get `ctr-u.bin` (or its `.zip`) into the phone's Files (AirDrop, iCloud
  Drive, a cable), then pick it on the home page. ~600 MB on the phone, a few seconds to store.
- **the app has its own storage.** a disc stored in Safari is not in the Home Screen app : pick it once
  more there. in the app it stays (closed, reopened : kept). in a Safari tab, Safari deletes a site's
  storage after 7 days without a visit — the home page says which one you're in.
- **touch controls.** three ways to play, Settings › Controls › Touch :
  - **Enhanced** (the default on a touch screen) : made for the game. left thumb anywhere on the
    left = a stick, right where it lands. GO, the slide (R), the item, the brake under the right
    thumb, three layouts to try (A : buttons, roll from R onto BOOST for the slide's boosts ;
    B : one thumb glides GO → GO + R → + BOOST ; C : left / right buttons, no stick).
    **GO holds itself** once you've kept it pressed 0.8 s in a race (a plain press first : the start
    boost is yours) — the brake, a tap on GO, the pause or the finish let go. switch it off, or
    change the delay, in Settings.
  - **Minimal** : the pad's own buttons on the screen, one for one.
  - **Pad** : nothing on the screen. a connected pad hides the touch controls anyway ; touch the
    screen and they're back.
  in the menus the screen keeps a small pad : D-pad, OK, and BACK (red, always there).
- **a Bluetooth pad** : iPhone pairs DualSense / DualShock 4, Xbox and Switch Pro pads, and Safari
  hands them to the page like any pad (Apple's docs ; on a real iPhone : being checked). press a
  button once for the page to see it. the PS / Xbox / Home button belongs to iOS (it opens Games).
- **starts by itself.** with the disc stored, the page goes straight into the game (the sound
  waits for your first touch). want the home page back ? Settings › System › « Start the game by
  itself ».
- **no offline yet** : the app needs the network to open (the disc and saves are on the phone).

## the limits (read this before you report them)

- **your own NTSC-U disc.** PAL and Japanese discs are refused, for now.
- **Share : four players in all**, the host's own pads included. a fifth friend's window says
  « Too many players ». the guests watch a video of the host's game : expect a little delay.
- **Share needs a direct connection** between the host and each guest. some networks
  (offices, schools, some mobile data) don't allow one : the guest is told so.
- **the default relay is public, and capped.** no key to ask for : rooms meet on our relay
  out of the box. it holds a limited number of players and rooms, closes a room nobody
  joined after ten minutes, and any room after six hours. « relay full » ? try later, or
  [run your own relay](#run-your-own-relay) and set it in Settings › Multiplayer › Share.
- **browsers** : played in Chrome (and the other Chromium browsers) every session ; Safari
  by hand ; Firefox not checked yet. phones : [on a phone](#on-a-phone).
- **not there yet** : the list right below.

## soon™

no dates. no versions. trust the process.

| | what | why you care |
|---|---|---|
| next | **touch, tuned** | the touch layouts tuned in the hand, on real phones ; Android checked |
| next | **your save, out and back** | export the card from Settings, import it on another browser |
| trust me bro | **PAL discs** | French version first. 50 Hz and all |

## how it's built

- **the game** — [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) decompiled it to C,
  [CTR Native](https://github.com/CTR-tools/ctr-native) made it a PC game, this fork builds
  it to **WebAssembly** with Emscripten (SDL3 underneath).
- **the picture** — **WebGL2** (CTR Native's renderer, ported to GLSL ES 3.0).
- **the sound** — the PS1's sound chip emulated in an **AudioWorklet** (Web Audio), off the
  main thread, so the music keeps time when the page is busy.
- **the disc** — your image, checked (NTSC-U, raw sectors), streamed into the browser's
  private storage (**OPFS**) once ; saves in IndexedDB.
- **Share** — the host's canvas and sound sent as a WebRTC video + audio stream, peer to peer
  (public STUN only) ; the guests' pads sent back.
- **the relay** ([relay/](relay/)) — one small Node file, WebSocket. it introduces the host
  and its guests, that's all : the video never goes through it. **it sees** : connection IP
  addresses, a random room id, random peer ids, who hosts, message sizes and timing. **it
  does not see** : player names, the WebRTC offers — sealed with the room's secret (AES-GCM),
  which never leaves the link — nor the secret itself.
- **what changed in the game** — the browser port lives in `platform/` ; in `game/`, two
  things only : the split-screen fix (`game/PushBuffer.c` : distant karts and the HUD fruit
  vanished in 2P–4P, one line, also on native) and the unlock box's test in the character and
  track selects (`game/230/`, browser builds only).
- **the page** — Svelte 5 + Vite, published on GitHub Pages by
  [a workflow](.github/workflows/pages.yml) that refuses to ship any game data
  ([web/pages/guard.sh](web/pages/guard.sh)).

## report a problem

[open an issue](https://github.com/meitogi/ctr-web/issues/new/choose) — a bug or an
idea, the form asks the right questions. faster : on the page, **Settings › System ›
Report a problem** opens it with the version, the browser and the mode already filled in.

**never attach the disc, or any piece of it** — not the `.bin`, not a `.zip`, not a file
from inside it. screenshots and short videos are great.

## run your own relay

our relay down or full, or you'd rather have one of your own ? one line on any box with
Docker (the key printed first, keep it) :

```
key=$(openssl rand -base64 24); echo "relay key : $key"
docker run -d -p 8787:8787 -e RELAY_KEY="$key" ghcr.io/meitogi/ctr-relay
```

then put it behind HTTPS — or skip the box : a hosted service in a few clicks, a
throwaway cloud VM with auto HTTPS, or behind your Traefik / HAProxy / Caddy.
everything's in [relay/README.md](relay/README.md). the host types its `wss://` address and
key in Settings › Multiplayer › Share ; the guests get them in the link.

**your fork, your page, your relay.** fork it, set the repository variable
`CTR_RELAY_URL` (Settings › Secrets and variables › Actions › Variables), turn on Pages,
push : your page points at your relay. [relay/README.md](relay/README.md#your-own-page-on-your-own-relay)
says what an optional built-in key protects, and what it doesn't.

## run it yourself (devs)

one game build, the page on one port. from the repo, with emsdk and cmake around :

```
web/dev.sh dev
```

opens the dev page on http://localhost:8090 — the page's sources with hot reload, the debug game
built the first time. rebuild the game with `web/dev.sh build`, then reload the page.
`web/dev.sh prod` serves the site exactly as GitHub Pages gets it (`web/dev.sh prod release`
checks it with the guard too).

on a real phone : a phone needs https (the browser's storage, the sound worklet, install), so the
debug site goes out through your own tunnel. `web/dev.sh phone` serves it on 8090 (nothing of the
game in it : the tests' snapshots, saves and replays answer 404) ; on the Mac, `web/phone-tunnel.sh`
opens an frp tunnel to it (it checks what it needs and says what is missing — the frp client files in
the gitignored `web/.phone-tunnel/`, the DNS record, the Traefik route) ; on the phone,
`https://<your host>/?measure` : a panel leads one race the Bot drives and sends its report (frame
rate, memory, storage, sound, what happens on a lock) to `web/test/player/.reports/`.

testing alone ? on the debug page, from the main menu, Settings › Dev has a **second window** :
one click, a window opens beside the first, joins Share by itself and plays as Bot ; the first
window walks its menus to the race. Settings › Players has the
Bot switch, Settings › Dev the log and the game state too. none of it ships on the site.

the tests : `node --test` in `web/` for the page ; the player suites
([web/test/player/](web/test/player/)) drive a real browser over CDP against the debug game served
by `python3 web/test/player/serve.py build-web-debug 8091` (and a relay on 8788 for Share's). three
levels, picked by [select.mjs](web/test/player/select.mjs) :

- `node web/test/player/select.mjs` — **each change** : `node --test`, then only the scenarios the
  files changed since the last tag touch ([coverage.mjs](web/test/player/coverage.mjs) says which
  areas a path touches, every suite tags its scenarios) ; a suite's own file runs the scenarios it
  changed ; words only (README, docs) run nothing. a change to Share : 9 scenarios, ~2 min.
- `node web/test/player/select.mjs tag` — **each tag** : the smoke, one scenario per area (the boot,
  a race, the page, the unlock, Share), ~2.5 min.
- `node web/test/player/select.mjs full` — **a release or an upstream merge** : every scenario,
  ~14 min.

it prints what it picked ; `--run` runs it, one suite after the other, timed — `CTR_PLAY` is the
command that runs one suite (`{suite}` its name, `--only A,B` appended), e.g.
`CTR_PLAY='node <the player harness>/e2e.mjs --suite web/test/player/{suite}.suite.mjs --url http://localhost:8091/index.html'`.

the scenarios start where they need to be, not from the boot and the menus : a **snapshot** of the
game (the main menu, a race's countdown — upstream's savestates) made once per build
(`select.mjs setup`, or on first use), a race **started straight from the URL**
(`?race=crash-cove&char=pinstripe&mode=tt`, `mode=arcade`, `mode=vs&players=2`, the characters by
name or id, the unlocked ones too) and **turbo** (`?turbo=1` : frames back to back, ×5 on a race)
for the races the Bot drives. debug builds only. a snapshot holds the game's memory, pieces of the
disc : they stay in `web/test/player/.states/`, never committed, and the site's guard refuses them.

and they start *exactly* where they need to be ([precise.suite.mjs](web/test/player/precise.suite.mjs)
shows each) :

- **a seed** — `?seed=7` : the same race twice, items and AI included.
- **a recorded race** — upstream's replay recorder : `recordRace` in
  [ctr.mjs](web/test/player/ctr.mjs) records a seeded race the Bot drives, `playRace` plays it back
  and stops at the first frame where anything differs (the karts, the laps, the random numbers).
  `playRace(…, { rebase: true })` replays it on another build — that's how an upstream merge is
  checked.
- **a memory card** — `?card=full-100` (or `new`, `partial`, `adv-2-keys`, `ghost-crash-cove`,
  `damaged`…, listed with what each holds in [saves.mjs](web/test/player/saves.mjs)), every one
  written by the game's own save. your own saves too : `importSave('<your card>.mcr', 'mine')`
  (a PS1 / emulator card image, or a folder of save files), then `?card=mine`.
- **settings** `?preset=duo` (or `unlock-off`, `pad-only`, `remapped`…, in memory : yours stay as
  they are), **players** `players(ctx, { pads: 3, want: ['pad', 'kb', 'pad', 'pad'] })`, **frames**
  `ctrDev.pause()` / `ctrDev.step(1)`, **faults** `?fault=disc-read` (or `storage-full`,
  `card-full`, `relay-silent`), **a phone** `phone(ctx)` (its screen, touch).

`node web/test/player/select.mjs setup --run` makes the snapshots, the cards and the recorded races
once. cards and recordings hold pieces of the game too : `web/test/player/.saves/` and `.replays/`,
never committed, refused by the site's guard.

the ports (one list : [web/dev-ports.tsv](web/dev-ports.tsv), checked by `web/dev.sh ports --check`) :

<!-- ports -->
| Port | Use | Forward in VS Code |
|---|---|---|
| 8090 | the dev page : wtf ctr dev (hot reload) or wtf ctr prod (the site as published) | yes |
| 8091 | player suites' page server (one per parallel session) | yes |
| 8092 | player suites' page server (one per parallel session) | yes |
| 8093 | player suites' page server (one per parallel session) | yes |
| 8787 | local relay, started by wtf ctr dev and prod | yes |
| 8788 | player suites' relay | yes |
| 8790 | the web/net and web/share demo pages | yes |
| 9001 | MQTT stand-in (signaling suite) | yes |
| 8099 | the LAN disc server (wtf disc), on the LAN host, not in the container | no |
<!-- /ports -->

## credits (the real MVPs)

- [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) — decompiled the whole game.
  absolute legends
- [CTR Native](https://github.com/CTR-tools/ctr-native) — the native PC port this is a
  fork of
- [PsyCross](https://github.com/OpenDriver2/PsyCross) — the original PS1 compatibility
  code that parts of CTR Native's platform layer and PsyQ facade headers come from
- [SDL3](https://github.com/libsdl-org/SDL) — audio, input, windows : the boring
  essentials nobody thanks
- the browser port — WebAssembly, Share, the whole web thing :
  [Meitogi](https://github.com/meitogi)
- Crash Team Racing is a trademark of Sony Computer Entertainment / Naughty Dog. we're
  just fans with a compiler.
