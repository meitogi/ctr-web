// window.__ctr : game state for the browser test suites (web/test/player/).
//
// Debug web builds only (__EMSCRIPTEN__ && !NDEBUG, the gate of the
// `[CTR Web] pad0` log lines) ; release builds compile none of it.
//
// C pushes, JS never calls in (ASYNCIFY) : WebDebugBridge_Publish() runs once
// per presented frame, at the end of Platform_EndScene, after that frame's
// game logic, and one EM_JS call rewrites window.__ctr as a plain object.
//
// Fields and their sources :
//   frame        presents since boot (counted here)
//   vblank       VSync(-1) = s_nativeVBlankCount, the 59.82 Hz game clock
//   fps          presents per second over the last second (performance.now)
//   gameMode1    gGT->gameMode1 (namespace_Main.h flags) ; `mode` = its set
//                flag names, `screen` = derived from it (see below)
//   gameMode2    gGT->gameMode2
//   levelID      gGT->levelID (enum LevelID, namespace_Level.h :
//                MAIN_MENU_LEVEL = 39, CRASH_COVE = 3 …)
//   numLaps      gGT->numLaps
//   lights       gGT->trafficLightsTimer : > 0 while the countdown runs,
//                decremented by elapsedTimeMS in MainMain.c, floored at -960
//   raceTime     gGT->elapsedEventTime (ms)
//   menu         sdata->ptrActiveMenu (RECTMENU_Show, NULL when none) :
//                title = lngStrings[stringIndexTitle], row = rowSelected,
//                label = lngStrings[rows[rowSelected].stringIndex & 0x7fff]
//                (bit 0x8000 = MENU_ROW_LOCKED), state = the menu's flags,
//                input = !(state & DISABLE_INPUT_ALLOW_FUNCPTRS) : the main
//                menu is active during the title intro with input disabled,
//                MM_Title.c clears the flag at TITLE_INTRO_MENU_READY_FRAME
//   kart         gGT->drivers[0] (player 1), null when no driver :
//                lap      lapIndex, 0 on the first lap, ++ in PlayLevel.c
//                speed    speedApprox, signed, > 0 forward (VehFrame.c :
//                         < 1 = stationary animation)
//                rank     driverRank, 0 = first place (PlayLevel.c)
//                finished actionsFlagSet & ACTION_RACE_FINISHED
//                pos      posCurr >> 8, world units (VehLap.c's shift)
//                angle    angle, the kart's yaw, 0..4095 = one turn
//                         (written in VehPhysGeneral.c / VehPhysProc.c) ;
//                         the kart moves along (sin, cos)(angle) in (x, z),
//                         Right lowers it (measured on Crash Cove)
//                checkpoint checkpoint.currentIndex (VehLap.c)
//                target   level1->ptr_restart_points, two nodes ahead of
//                         `checkpoint` along nextIndex_forward : a point on
//                         the track to steer toward
//                toFinish distanceToFinish_curr
//   sub          the deepest open submenu under `menu` (ptrNextBox_InHierarchy while
//                DRAW_NEXT_MENU_IN_HIERARCHY is set : Arcade › Single / Cup, VS ›
//                2P / 3P / 4P…), same fields as `menu`, null when none
//   players      gGT->numPlyrCurrGame, the screens of the split screen
//   karts        gGT->drivers[0 .. players-1], each with the same fields as `kart`
//                (karts[1] = P2 : Share's bot steers it), null entries for missing
//                drivers
//                wumpa numWumpas · item heldItemID (DriverHeldItem, 0xf none) · roll itemRollTimer
//                (> 0 while the ? roulette runs) · crates numTimesHitWeaponBox — the item
//                path, for the online tests (RB_Crate.c, VehPickupItem.c)
//                invisible invisibleTimer · invincible invincibleTimer · drawn bit v set when
//                the kart's instance was drawn in view v this frame (DRAW_SUCCESSFUL) · lods
//                byte v = the LOD index (idpp[v].lodIndex) it was queued with in view v ·
//                impostor bit v set when view v shows it as the split-screen impostor sprite
//                (HIDE_MODEL in its idpp[v], set by DecalMP_02)
//                reserves the turbo's reserves (> 0 while a boost lasts : the start boost, a
//                slide's) · cross the pad's Cross held this frame (its slot's snapshot) ;
//                state kartState (KS_* : 1 crashing, 2 drifting) · slideFrames a slide's frame
//                counter (signed) · actions actionsFlagSet — why a slide ended (session 42b)
//                `kart` gets wumpa … cross from karts[0]
//   pools        { thread, small } : free entries of gGT->JitPools.thread / .smallStack, -1 while a level loads (a
//                crate's thread is born on first contact, RB_CrateAny_LInC_Birth ; an empty
//                pool leaves it intact)
//   charSelect   while the character select is the active menu (D230.menuCharacterSelect) :
//                { locked } = sdata->characterSelectFlags, bit n set once player n
//                locked a character (MM_Characters.c), { players } = gGT->numPlyrNextGame, the
//                cursors shown, { characters } = data.characterIDs[0..players-1] (session 32e) ;
//                null otherwise
//   net          ON builds, in an online race : the remote karts as this screen draws them
//                (per-present position, SG_RACEDATA applied, corrections) — the block above
//                WebDebugBridge_Publish, `__ctr.net.summary()` / `.reset()`
//   unlocks      { save : GAME_PROGRESS.unlocks[0..1], what the memory card stores, as u32 ;
//                open : the page's « Unlock everything » applies now (WEB_UNLOCK_ALL_OPEN,
//                include/platform/native_web_ui.h) } — the box must never reach `save`
//   characters   data.characterIDs[0..7], each driver's character as the game loads it (P1… then
//                the AI ; namespace_Vehicle.h's enum Characters)
//   drivers      the drivers in the race now (gGT->drivers[0..7] set), 0 in the menus
//   track        level1->LevNavTable[0], the racing line the AI drives
//                (BOTS.c ; magic 0xECFD, NAVHEADER_GETFRAME) : { levelID,
//                path: [{x, y, z}] } in world units, published once per level
//
// Two requests from the page (web/ui/src/dev/, the tests' fast start), pulled here once per frame :
//   __ctrState   { op: 'save' | 'load' } : a snapshot, upstream's quick state (F5 / F8,
//                platform/native_savestate.c) ; a load's bytes are written to its MEMFS file
//                first. Taken at the next frame's NativeSaveState_BeginFrame, then `done` is set
//                on the object with that frame's __ctr.
//   __ctrStart   { mode, players, level, laps, difficulty, characters } : a race started from the
//                main menu as the menus would start it (WebDebugBridge_Start).
//
// The precise start (web/ui/src/dev/precise.js), pulled here once per frame too :
//   __ctrSeed    a number : on the first frame of each race (the level loaded, its drivers in),
//                the game's random generators set from it (WebDebugBridge_Seed) — the same race
//                twice. Nothing in the game seeds from a clock : what varies is the menus' time.
//   __ctrReplay  upstream's input replay (platform/native_replay_scheduler.c, F9 / F10 natively),
//                started with the arguments its command line takes :
//                { op: 'record' } starts on the next race's first frame, after the seed ;
//                { op: 'stop' } ends it after the frame ; { op: 'play', path, frames, bypass } plays
//                the files the page wrote in MEMFS, from their first checkpoint, and ends it at its
//                last frame (upstream's end stops the game). Every 300 replay frames (upstream's
//                checkpoint interval) the karts and the generators go in `samples`.
//   __ctrCard    { op: 'write', unlocks, tt, adv, version } : the game's progress set, then saved
//                by the game's own profile save (SelectProfile_SaveAdvProfile's steps) from the main
//                menu ; { op: 'ghost' } : the race just run saved as a ghost by the game's own ghost
//                save (SelectProfile_StartGhostSave's steps) at the end of a Time Trial.
//   __ctr.card   { screen: sdata->mcScreenText (enum MC_SCREEN), start: sdata->mcStart, stage:
//                sdata->memcard_stage, version: the card buffer's profile version (header[0], -18),
//                outdated: sdata->boolMemcardDataOutdated, ghosts: the ghosts on the card,
//                tropyBeaten: GAME_PROGRESS's tracks with N. Tropy beaten, profiles: the card buffer's
//                four Adventure profiles ({ character, hub, rewards }, null when empty), adv: the
//                Adventure profile being played (GAME_ADV_PROGRESS) } : the card as the game holds it ;
//                __ctr.frameCounter : sdata->frameCounter, + 1 per game frame (MainMain.c) ;
//                __ctr.raceFrame : the frames since this race's first (the seed's frame : 0), -1
//                outside a race ;
//                __ctr.positions : gGT->drivers[0..7]'s posCurr >> 8 in a race (the AI's too), null
//                for no driver.
//   __ctr.disc   { region: 'us' | 'pal', language (web_disc_view.c), xa: the last XA file opened
//                as the disc read it (XA/<language>/... for a PAL language), lng: { id: text } of
//                the loaded LNG for ids 3 and 560 (560 : past PAL's inserted strings) }.

#include <emscripten.h>
#include <platform/native_web_ui.h>

EM_JS(void, WebDebugBridge_PushJS,
      (int vblank, int gameMode1, int gameMode2, int levelID, int numLaps, int lights, int raceTime,
       int hasMenu, const char *menuTitle, int menuRow, const char *menuLabel, int menuState,
       int hasKart, int lap, int speed, int rank, int finished, int posX, int posY, int posZ, int angle,
       int checkpoint, int targetX, int targetZ, int toFinish),
{
	const prev = globalThis.__ctr;
	const now = performance.now();
	const frame = prev ? prev.frame + 1 : 1;
	let fpsFrom = prev ? prev.fpsFrom : now;
	let fpsFrame = prev ? prev.fpsFrame : frame;
	let fps = prev ? prev.fps : 0;
	if (now - fpsFrom >= 1000) {
		fps = Math.round(((frame - fpsFrame) * 10000) / (now - fpsFrom)) / 10;
		fpsFrom = now;
		fpsFrame = frame;
	}
	// Game strings are 8-bit, not UTF-8 : read them byte by byte.
	const str = p => {
		let s = "";
		if (!p) return s;
		for (let b = HEAPU8[p]; b !== 0; b = HEAPU8[++p]) s += String.fromCharCode(b);
		return s;
	};
	const FLAGS1 = [
		[0x1, "PAUSE_1"], [0x2, "PAUSE_2"], [0x4, "PAUSE_3"], [0x8, "PAUSE_4"],
		[0x10, "DEBUG_MENU"], [0x20, "BATTLE_MODE"], [0x40, "START_OF_RACE"],
		[0x1000, "WARPBALL_HELD"], [0x2000, "MAIN_MENU"], [0x4000, "POINT_LIMIT"],
		[0x8000, "LIFE_LIMIT"], [0x10000, "TIME_LIMIT"], [0x20000, "TIME_TRIAL"],
		[0x80000, "ADVENTURE_MODE"], [0x100000, "ADVENTURE_ARENA"], [0x200000, "END_OF_RACE"],
		[0x400000, "ARCADE_MODE"], [0x4000000, "RELIC_RACE"], [0x8000000, "CRYSTAL_CHALLENGE"],
		[0x10000000, "ADVENTURE_CUP"], [0x20000000, "GAME_CUTSCENE"], [0x40000000, "LOADING"],
		[0x80000000, "ADVENTURE_BOSS"],
	];
	const m1 = gameMode1 >>> 0;
	const mode = [];
	for (const [bit, name] of FLAGS1) if ((m1 & bit) >>> 0) mode.push(name);
	let screen = "race";
	if (m1 & 0x40000000) screen = "loading";
	else if (m1 & 0x2000) screen = "menu";
	else if (m1 & 0x20000000) screen = "cutscene";
	else if (m1 & 0x200000) screen = "finished";
	else if (m1 & 0xf) screen = "paused";
	else if (m1 & 0x40) screen = "intro";
	else if (lights > 0) screen = "countdown";
	globalThis.__ctr = {
		frame, vblank, fps, fpsFrom, fpsFrame,
		screen, mode, gameMode1: m1, gameMode2: gameMode2 >>> 0,
		levelID, numLaps, lights, raceTime,
		track: globalThis.__ctrTrack ?? null,
		menu: hasMenu ? { title: str(menuTitle), row: menuRow, label: str(menuLabel), state: menuState >>> 0, input: !(menuState & 0x20) } : null,
		kart: hasKart ? {
			lap, speed, rank, finished: !!finished,
			pos: { x: posX, y: posY, z: posZ }, angle,
			checkpoint, target: checkpoint < 0 ? null : { x: targetX, z: targetZ }, toFinish: toFinish >>> 0,
		} : null,
	};
});

EM_JS(void, WebDebugBridge_PushPathJS, (int levelID, const s16 *frames, int count, int stride),
{
	const path = [];
	for (let i = 0; i < count; i++) {
		const at = (frames >> 1) + i * (stride >> 1);
		path.push({ x: HEAP16[at], y: HEAP16[at + 1], z: HEAP16[at + 2] });
	}
	globalThis.__ctrTrack = { levelID, path };
});


EM_JS(void, WebDebugBridge_DiscJS, (int pal, int language, const char *xa, const char *s3, const char *s560), {
	const c = globalThis.__ctr;
	const str = p => (p ? UTF8ToString(p) : null);
	if (c) c.disc = { region: pal ? 'pal' : 'us', language: ['en', 'fr', 'de', 'it', 'es', 'nl'][language], xa: str(xa), lng: { 3: str(s3), 560: str(s560) } };
});

EM_JS(void, WebDebugBridge_UnlocksJS, (u32 w0, u32 w1, int open), {
	const c = globalThis.__ctr;
	if (c) c.unlocks = { save: [w0 >>> 0, w1 >>> 0], open: !!open };
});

// Runs right after WebDebugBridge_PushJS, on the object it just wrote.
EM_JS(void, WebDebugBridge_PushMoreJS,
      (int hasSub, const char *subTitle, int subRow, const char *subLabel, int subState, int players, const s32 *karts, int charSelect,
       int poolThread, int poolSmall),
{
	const c = globalThis.__ctr;
	if (!c) return;
	c.pools = { thread: poolThread, small: poolSmall };
	const str = p => (p ? UTF8ToString(p) : null);
	c.sub = hasSub ? { title: str(subTitle), row: subRow, label: str(subLabel), state: subState >>> 0, input: !(subState & 0x20) } : null;
	c.players = players;
	c.charSelect = charSelect < 0 ? null : { locked: charSelect & 0xf, players: (charSelect >> 4) & 7,
		characters: Array.from({ length: (charSelect >> 4) & 7 }, (_, p) => (charSelect >> (8 + p * 4)) & 0xf) };
	c.karts = [];
	for (let i = 0; i < players; i++) {
		const k = HEAP32.subarray((karts >> 2) + i * 27, (karts >> 2) + (i + 1) * 27);
		c.karts.push(k[0] ? {
			lap: k[1], speed: k[2], rank: k[3], finished: !!k[4],
			pos: { x: k[5], y: k[6], z: k[7] }, angle: k[8],
			checkpoint: k[9], target: k[9] < 0 ? null : { x: k[10], z: k[11] }, toFinish: k[12] >>> 0,
			wumpa: k[13], item: k[14], roll: k[15], crates: k[16],
			invisible: k[17], invincible: k[18], drawn: k[19], lods: k[20], impostor: k[21],
			reserves: k[22], cross: !!k[23],
			state: k[24], slideFrames: k[25], actions: k[26] >>> 0,
		} : null);
	}
	// The kart counter (session 22), with the flicker counter on : per present, for each view
	// and each other kart, was it drawn there (DRAW_SUCCESSFUL of its instance in that view) ?
	// Hidden by the game's own rules = its invisibleTimer runs (the Invisibility item, hidden
	// in the other views, RB_Player_ToggleInvisible) or the odd-frame flicker of invincibleTimer
	// > 0x2a0 (RB_Player_ToggleFlicker). `ahead` : the kart within `near` world units and 35°
	// of the view's own kart heading, where the camera looks. lod[n] : drawn at LOD n ; impostor :
	// drawn as the split-screen impostor sprite (its 3D model hidden in that view, DecalMP_02).
	const f = globalThis.__ctrFlicker;
	if (f && players >= 2) {
		const k = f.karts = f.karts ?? { frames: 0, ahead: 0, seen: 0, ruled: 0, hidden: 0, lod: [0, 0, 0, 0], impostor: 0, log: [] };
		const near = f.near ?? 2000;
		k.frames++;
		for (let v = 0; v < players; v++) {
			for (let j = 0; j < players; j++) {
				const a = c.karts[v];
				const b = c.karts[j];
				if (j === v || !a || !b) continue;
				const drawn = (b.drawn >> v) & 1;
				const ruled = b.invisible > 0 || b.invincible > 0x2a0;
				const dx = b.pos.x - a.pos.x;
				const dz = b.pos.z - a.pos.z;
				const dist = Math.hypot(dx, dz);
				const t = (a.angle * 2 * Math.PI) / 4096;
				const ahead = dist > 0 && dist < near && (dx * Math.sin(t) + dz * Math.cos(t)) / dist > Math.cos(Math.PI * 35 / 180);
				if (!ahead) continue;
				k.ahead++;
				if (drawn) {
					k.seen++;
					// the LOD the kart was queued with in that view
					const lod = (b.lods >> (v * 8)) & 3;
					k.lod[lod]++;
					if ((b.impostor >> v) & 1) k.impostor++;
					// kept : 2 per LOD, the kart within 10° of the heading and 300–1500 units away (not
					// behind the view's own kart)
					const centred = (dx * Math.sin(t) + dz * Math.cos(t)) / dist > Math.cos(Math.PI / 18) && dist > 300 && dist < 1500;
					const shot = k.shot ?? (k.shot = [0, 0, 0, 0]);
					if (f.keepLods && centred && shot[lod] < 2 && k.frames - (k.lastShot ?? -99) > 30) { shot[lod]++; k.lastShot = k.frames; f.grab = `lod${lod}-view${v}-kart${j}-d${Math.round(dist)}`; }
				}
				else if (ruled) k.ruled++;
				else {
					k.hidden++;
					if (k.log.length < 200) k.log.push({ frame: c.frame, view: v, kart: j, dist: Math.round(dist) });
				}
			}
		}
	}
	if (c.kart && c.karts[0]) Object.assign(c.kart, { wumpa: c.karts[0].wumpa, item: c.karts[0].item, roll: c.karts[0].roll, crates: c.karts[0].crates, reserves: c.karts[0].reserves, cross: c.karts[0].cross });
});

// prim  { used, guard, cap } : gGT->backBuffer->primMem for the frame just presented —
//       cursor - start, guardEnd - start, end - start, in bytes. The game's allocators refuse
//       a primitive that would cross guardEnd, so used close to guard = something not drawn.
EM_JS(void, WebDebugBridge_PushPrimJS, (int used, int guard, int cap),
{
	const c = globalThis.__ctr;
	if (c) {
		c.prim = { used, guard, cap };
	}
});

// The flicker counter (session 22), off until a page sets globalThis.__ctrFlicker = {} (a
// suite) : then, per present, the displayed VRAM rectangle cut in 32 × 16 tiles, one hash per
// tile ; a tile whose hash goes A B A over three presents blinked (the middle frame). Counts
// accumulate on the object : frames, bad (frames with a blink), events (tiles × blinks),
// tiles[] (blinks per tile, row-major, cols × rows), log (the first 400 bad frames), primMax /
// primGuard (the highest `prim.used` of the counted frames, the guard). With
// keep: n, the first n blinked frames are kept as RGBA (kept[], { frame, w, h, rgba }).
EM_JS(int, WebDebugBridge_FlickerOnJS, (void), { return globalThis.__ctrFlicker ? 1 : 0; });

EM_JS(void, WebDebugBridge_FlickerJS,
      (int w, int h, int cols, int rows, const u8 *blink, int count, const u16 *pixels, int vblank, int used, int guard, int tile0, int tile1, int fruitPx),
{
	const f = globalThis.__ctrFlicker;
	const c = globalThis.__ctr;
	if (!f) return;
	const frame = c ? c.frame : 0;
	if (f.cols !== cols || f.rows !== rows) Object.assign(f, { cols, rows, tiles: new Array(cols * rows).fill(0) });
	f.w = w;
	f.h = h;
	f.frames = (f.frames ?? 0) + 1;
	f.primMax = Math.max(f.primMax ?? 0, used);
	// split screen : a kart shown as an impostor in view v (DecalMP, its 3D model hidden there)
	// samples atlas tile v, the HUD fruit samples its own VRAM area — empty = nothing on screen
	if (tile0 >= 0) {
		const imp = f.impostor = f.impostor ?? { frames: 0, empty: 0, fruitFrames: 0, fruitEmpty: 0 };
		[tile0, tile1].forEach((lit, v) => {
			if (!(c?.karts ?? []).some(k => k && ((k.impostor >> v) & 1))) return;
			imp.frames++;
			if (lit === 0) imp.empty++;
		});
		if (fruitPx >= 0) {
			imp.fruitFrames++;
			if (fruitPx === 0) imp.fruitEmpty++;
		}
	}
	f.primGuard = guard;
	f.bad = f.bad ?? 0;
	f.events = f.events ?? 0;
	f.log = f.log ?? [];
	f.kept = f.kept ?? [];
	const rgba = p => {
		const out = new Uint8ClampedArray(w * h * 4);
		const px = HEAPU16.subarray(p >> 1, (p >> 1) + w * h);
		for (let i = 0; i < w * h; i++) {
			const v = px[i];
			out[i * 4] = (v & 31) << 3;
			out[i * 4 + 1] = ((v >> 5) & 31) << 3;
			out[i * 4 + 2] = ((v >> 10) & 31) << 3;
			out[i * 4 + 3] = 255;
		}
		return out;
	};
	if (count > 0) {
		const at = [];
		for (let t = 0; t < cols * rows; t++) if (HEAPU8[blink + t]) { f.tiles[t]++; at.push(t); }
		f.bad++;
		f.events += count;
		if (f.log.length < 400) f.log.push({ frame: frame - 1, vblank, tiles: at, used, guard });
		// the blinked frame is the previous one : kept from the last call
		if (f.kept.length < (f.keep ?? 0) && f.prev) f.kept.push({ frame: frame - 1, w, h, rgba: f.prev, next: rgba(pixels) });
	}
	f.prev = (f.keep ?? 0) > f.kept.length ? rgba(pixels) : null;
	if (f.grab) { f.kept.push({ frame, w, h, rgba: rgba(pixels), tag: f.grab }); f.grab = null; }
});

// With vram: n on the flicker object, the whole 1024 × 512 VRAM is kept n times (kept[],
// tag « vram »), a second apart, from vramAfter counted presents : the off-screen areas (the 2P
// impostor atlas, the HUD fruit).
EM_JS(int, WebDebugBridge_VramWantedJS, (void),
{
	const f = globalThis.__ctrFlicker;
	if (!f || !f.vram || (f.frames ?? 0) < (f.vramAfter ?? 0)) return 0;
	const now = performance.now();
	if (f.vramAt && now - f.vramAt < 1000) return 0;
	return 1;
});

EM_JS(void, WebDebugBridge_VramJS, (const u16 *pixels, int w, int h),
{
	const f = globalThis.__ctrFlicker;
	if (!f) return;
	const out = new Uint8ClampedArray(w * h * 4);
	const px = HEAPU16.subarray(pixels >> 1, (pixels >> 1) + w * h);
	for (let i = 0; i < w * h; i++) {
		const v = px[i];
		out[i * 4] = (v & 31) << 3;
		out[i * 4 + 1] = ((v >> 5) & 31) << 3;
		out[i * 4 + 2] = ((v >> 10) & 31) << 3;
		out[i * 4 + 3] = 255;
	}
	f.kept = f.kept ?? [];
	f.kept.push({ frame: globalThis.__ctr ? globalThis.__ctr.frame : 0, w, h, rgba: out, tag: 'vram' });
	f.vram--;
	f.vramAt = performance.now();
});

#define WEB_FLICKER_TILE_W 32
#define WEB_FLICKER_TILE_H 16
#define WEB_FLICKER_TILES ((VRAM_WIDTH / WEB_FLICKER_TILE_W) * (VRAM_HEIGHT / WEB_FLICKER_TILE_H))

internal void WebDebugBridge_Flicker(struct GameTracker *gGT)
{
	local_persist u32 s_hash[3][WEB_FLICKER_TILES];
	local_persist RECT16 s_rect;
	local_persist int s_filled = 0;
	local_persist int s_slot = 0;
	u8 blink[WEB_FLICKER_TILES];
	const RECT16 r = { activeDispEnv.disp.x, activeDispEnv.disp.y, activeDispEnv.disp.w, activeDispEnv.disp.h };
	const int cols = (r.w + WEB_FLICKER_TILE_W - 1) / WEB_FLICKER_TILE_W;
	const int rows = (r.h + WEB_FLICKER_TILE_H - 1) / WEB_FLICKER_TILE_H;
	const u16 *px;
	struct PrimMem *pm = &gGT->backBuffer->primMem;
	int count = 0;

	if (!WebDebugBridge_FlickerOnJS())
	{
		s_filled = 0;
		return;
	}
	if (WebDebugBridge_VramWantedJS())
	{
		WebDebugBridge_VramJS(NativeRenderer_DebugReadDisplay(0, 0, VRAM_WIDTH, VRAM_HEIGHT), VRAM_WIDTH, VRAM_HEIGHT);
	}
	px = NativeRenderer_DebugReadDisplay(r.x, r.y, r.w, r.h);
	if (px == NULL)
	{
		return;
	}
	// the double buffer moves the rectangle between two VRAM halves every present : only a new
	// size restarts the history
	if ((s_rect.w != r.w) || (s_rect.h != r.h))
	{
		s_rect = r;
		s_filled = 0;
	}
	s_slot = (s_slot + 1) % 3;
	for (int t = 0; t < cols * rows; t++)
	{
		const int tx = (t % cols) * WEB_FLICKER_TILE_W;
		const int ty = (t / cols) * WEB_FLICKER_TILE_H;
		u32 h = 2166136261u;

		for (int y = ty; (y < ty + WEB_FLICKER_TILE_H) && (y < r.h); y++)
		{
			for (int x = tx; (x < tx + WEB_FLICKER_TILE_W) && (x < r.w); x++)
			{
				h = (h ^ (px[y * r.w + x] & 0x7fff)) * 16777619u;
			}
		}
		s_hash[s_slot][t] = h;
	}
	if (s_filled < 2)
	{
		s_filled++;
		return;
	}
	for (int t = 0; t < cols * rows; t++)
	{
		const u32 a = s_hash[(s_slot + 1) % 3][t];
		const u32 b = s_hash[(s_slot + 2) % 3][t];
		const u32 n = s_hash[s_slot][t];

		blink[t] = (u8)((a == n) && (a != b));
		count += blink[t];
	}
	{
		// 2P : the impostor atlas right of the framebuffers — DecalMP_01 fills its entries view by
		// view, DecalMP_03 gives them the 0x60 × 0x40 tiles at x 0x200 (view 0) and 0x260 (view 1),
		// y 0x180 : the lit pixels of each ; the HUD fruit's area (UI_RenderFrame_Wumpa3D_2P3P4P),
		// while the race HUD is on. -1 when not measured.
		int tile[2] = { -1, -1 };
		int fruitPx = -1;

		if (gGT->numPlyrCurrGame == 2)
		{
			const RECT16 fr = { GAME_WUMPA_HUD_VIEWPORTS[0].x, GAME_WUMPA_HUD_VIEWPORTS[0].y, GAME_WUMPA_HUD_VIEWPORTS[0].w, GAME_WUMPA_HUD_VIEWPORTS[0].h };
			const u16 *a = NativeRenderer_DebugReadDisplay(0x200, 0x180, 0xc0, 0x40);

			tile[0] = 0;
			tile[1] = 0;
			for (int i = 0; (a != NULL) && (i < 0xc0 * 0x40); i++)
			{
				tile[(i % 0xc0) >= 0x60] += (a[i] & 0x7fff) != 0;
			}
			if ((gGT->hudFlags & HUD_FLAG_RACE_HUD) != 0)
			{
				a = NativeRenderer_DebugReadDisplay(fr.x, fr.y, fr.w, fr.h);
				fruitPx = 0;
				for (int i = 0; (a != NULL) && (i < fr.w * fr.h); i++)
				{
					fruitPx += (a[i] & 0x7fff) != 0;
				}
			}
			// the read-backs reused the display buffer : read the display again for the RGBA copies
			px = NativeRenderer_DebugReadDisplay(r.x, r.y, r.w, r.h);
		}
		WebDebugBridge_FlickerJS(r.w, r.h, cols, rows, blink, count, px, VSync(-1), (int)((u8 *)pm->cursor - (u8 *)pm->start),
		                         (int)((u8 *)pm->guardEnd - (u8 *)pm->start), tile[0], tile[1], fruitPx);
	}
}

internal const char *WebDebugBridge_String(s16 stringIndex)
{
	if ((sdata->lngStrings == NULL) || (stringIndex == RECTMENU_STRING_NONE))
	{
		return NULL;
	}

	return sdata->lngStrings[(u16)stringIndex & ~MENU_ROW_LOCKED];
}

// Entries of a pool's free list, -1 while a level loads (the lists point into memory the
// load pops and reuses until JitPool_Init). Bounded by the pool's size.
internal int WebDebugBridge_PoolFree(const struct JitPool *pool)
{
	int n = 0;

	if (sdata->Loading.stage != LOAD_IDLE)
	{
		return -1;
	}
	for (const struct Item *it = pool->free.first; (it != NULL) && (n <= pool->maxItems); it = it->next)
	{
		n++;
	}
	return n;
}

// A point on the track ahead of driver `d` : the restart point two nodes past its checkpoint.
// Returns the checkpoint index, -1 (and no point) when the level has none.
internal int WebDebugBridge_Target(struct GameTracker *gGT, struct Driver *d, int *x, int *z)
{
	struct Level *level = gGT->level1;
	struct CheckpointNode *nodes;
	int next;

	if ((level == NULL) || (level->ptr_restart_points == NULL) || (d->checkpoint.currentIndex >= level->cnt_restart_points))
	{
		return -1;
	}
	nodes = level->ptr_restart_points;
	next = nodes[d->checkpoint.currentIndex].nextIndex_forward;
	if (next < level->cnt_restart_points)
	{
		next = nodes[next].nextIndex_forward;
	}
	if (next >= level->cnt_restart_points)
	{
		return -1;
	}
	*x = nodes[next].pos.x;
	*z = nodes[next].pos.z;
	return d->checkpoint.currentIndex;
}


// ---- window.__ctr.audio (session 21) : the audio output, seen from the page ----
//
// Kept in globalThis.__ctrAudio (window.__ctr is rewritten every present), from window.ctrAudio
// (web/audio/audio.js) and native_audio.c's own push :
//   path          'worklet' : the SPU mixes in an AudioWorklet (spu.wasm), off the main thread
//   sampleRate, block (frames per render quantum), baseLatency / outputLatency (s), state,
//   bufferMs (the command buffer), ready (the worklet runs)
//   blocks        render quanta the worklet mixed
//   underruns     null : the worklet mixes on the audio thread, which the page cannot watch ;
//                 audio.suite.mjs meters the output signal itself (its dropout meter)
//   batches, lateBatches, worstLateMs  the game's command batches, and those that reached the
//                 worklet after their stamp + bufferMs (heard late, never as a gap)
//   longestGapMs  the longest wall-clock gap between two worklet ticks seen by the page (the
//                 hidden page's wake clock)
//   workletMixerMsPerSec  the worklet's mixing time (Date.now(), 1 ms steps) ; mixerMsPerSec the
//                 main thread's (0 : it no longer mixes)
//   times         performance.now() of each tick since boot (20 000 at most)
//   late          { at: stamp, ms } of the late batches since boot
//   spu / spuTotal / spuHistory  pushed by native_audio.c once per 60 VBlanks : the game's SPU
//                 calls and bytes, and how late each VBlank came against its due time
//   reset()       starts a new window (counters only)
// __ctrStall = { ms, every } : a debug busy loop of `ms` in one frame every `every` ms (or once
// when `every` is 0) — the late frame the audio must survive.
EM_JS(void, WebDebugBridge_AudioJS, (void), {
	const A = (globalThis.__ctrAudio = globalThis.__ctrAudio || {});
	const audio = globalThis.ctrAudio;
	if (!A.reset) A.reset = () => audio && audio.resetStats && audio.resetStats();
	if (audio && audio.context) {
		const ctx = audio.context;
		const s = audio.stats;
		const secs = (performance.now() - s.since) / 1000;
		Object.assign(A, {
			path: 'worklet', sampleRate: ctx.sampleRate, block: 128, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, state: ctx.state,
			bufferMs: audio.bufferMs, ready: !!audio.node, blocks: s.quanta, underruns: null, missedMs: null, batches: s.batches,
			lateBatches: s.lateBatches, worstLateMs: s.worstLateMs, longestGapMs: s.longestGapMs,
			workletMixerMsPerSec: secs > 0 ? Math.round((s.workletMixMs / secs) * 10) / 10 : 0, mixerMsPerSec: 0,
			times: audio.times, late: audio.late, glitches: [],
		});
	}
	if (globalThis.__ctr) globalThis.__ctr.audio = A;
});

EM_JS(int, WebDebugBridge_StallJS, (void), {
	const S = globalThis.__ctrStall;
	if (!S || !S.ms) return 0;
	const now = performance.now();
	if (S.at && now - S.at < (S.every || 0)) return 0;
	if (S.at && !S.every) return 0;
	S.at = now;
	S.count = (S.count || 0) + 1;
	return S.ms | 0;
});

internal void WebDebugBridge_Stall(void)
{
	const int ms = WebDebugBridge_StallJS();

	if (ms > 0)
	{
		const double start = emscripten_get_now();

		while (emscripten_get_now() - start < ms)
		{
		}
	}
}

EM_JS(void, WebDebugBridge_DriversJS, (const s16 *ids, int drivers), {
	if (!globalThis.__ctr) return;
	globalThis.__ctr.characters = Array.from(HEAP16.subarray(ids >> 1, (ids >> 1) + 8));
	globalThis.__ctr.drivers = drivers;
});

EM_JS(int, WebDebugBridge_StateJS, (void), {
	const S = globalThis.__ctrState;
	if (!S || S.taken) return 0;
	S.taken = true;
	return S.op === 'load' ? 2 : 1;
});

EM_JS(void, WebDebugBridge_StateDoneJS, (void), {
	const S = globalThis.__ctrState;
	if (!S) return;
	if (S.op === 'save') {
		try {
			S.bytes = FS.readFile('debug/states/quick.ctrstates');
		} catch (e) {
			S.error = 'no state written';
		}
	}
	S.after = globalThis.__ctr;
	S.done = true;
});

// mode 1 Time Trial, 2 Arcade, 3 VS ; out : players, level, laps, difficulty row, characters[4]
EM_JS(int, WebDebugBridge_StartJS, (int *out), {
	const S = globalThis.__ctrStart;
	if (!S || S.taken) return 0;
	S.taken = true;
	const mode = { tt: 1, arcade: 2, vs: 3 }[S.mode] || 0;
	HEAP32[(out >> 2) + 0] = S.players | 0;
	HEAP32[(out >> 2) + 1] = S.level | 0;
	HEAP32[(out >> 2) + 2] = S.laps | 0;
	HEAP32[(out >> 2) + 3] = S.difficulty | 0;
	for (let i = 0; i < 4; i++) HEAP32[(out >> 2) + 4 + i] = (S.characters && S.characters[i] != null) ? S.characters[i] | 0 : i;
	return mode;
});

global_variable s32 s_webStateFrame = -1;

internal void WebDebugBridge_State(void)
{
	if (s_webStateFrame >= 0)
	{
		// sdata->frameCounter++ runs just before NativeSaveState_BeginFrame (MainMain.c) : a save
		// moves it on, a load brings back the snapshot's
		if ((s32)sdata->frameCounter != s_webStateFrame)
		{
			s_webStateFrame = -1;
			WebDebugBridge_StateDoneJS();
		}
		return;
	}

	switch (WebDebugBridge_StateJS())
	{
	case 1:
		NativeSaveState_RequestSave();
		s_webStateFrame = (s32)sdata->frameCounter;
		break;
	case 2:
		NativeSaveState_RequestLoad();
		s_webStateFrame = (s32)sdata->frameCounter;
		break;
	}
}

// A race from the main menu, through the game's own load : the values the menus set
// (game/230/MM_MenuFlow.c's main menu and player boxes, MM_TrackSelect.c's track, laps and Time
// Trial's empty ghost tape), the title left as Demo mode leaves it (MM_Title.c), then the queue
// menu's own procedure (QueueLoadTrack.c : Time Trial's N. Tropy and Oxide, the event time, the
// load request, the menu hidden). Fires once the main menu is up and no load runs, during the
// title intro too.
internal void WebDebugBridge_Start(struct GameTracker *gGT)
{
	s32 v[8];
	int mode;

	if ((sdata->Loading.stage != LOAD_IDLE) || (gGT->levelID != MAIN_MENU_LEVEL) || ((gGT->gameMode1 & MAIN_MENU) == 0) ||
	    (sdata->ptrActiveMenu != &D230.menuMainMenu))
	{
		return;
	}
	mode = WebDebugBridge_StartJS(v);
	if (mode == 0)
	{
		return;
	}

	MM_Title_CameraReset();
	MM_Title_KillThread();

	gGT->gameMode1 &= ~(BATTLE_MODE | ADVENTURE_MODE | TIME_TRIAL | ADVENTURE_ARENA | ARCADE_MODE | ADVENTURE_CUP);
	gGT->gameMode2 &= ~(CUP_ANY_KIND);
	gGT->numLaps = MM_DEFAULT_LAP_COUNT;

	if (mode == 1)
	{
		gGT->numPlyrNextGame = 1;
		gGT->gameMode1 |= TIME_TRIAL;
		gGT->gameMode2 &= ~(CHEAT_WUMPA | CHEAT_TURBO | CHEAT_MASK | CHEAT_ENGINE | CHEAT_BOMBS);
		sdata_static.ptrGhostTapePlaying = MEMPACK_AllocHighMem(0x3e00, R230.s_loaded_ghost_data);
		memset(sdata_static.ptrGhostTapePlaying, 0, 0x28);
		sdata_static.boolReplayHumanGhost = 0;
	}
	else
	{
		if (mode == 2)
		{
			gGT->gameMode1 |= ARCADE_MODE;
			gGT->arcadeDifficulty = D230.cupDifficulty.speed[(v[3] >= 0) && (v[3] < 3) ? v[3] : 0];
		}
		gGT->numPlyrNextGame = (u8)v[0];
		if ((v[2] == 1) || (v[2] == 3) || (v[2] == 5) || (v[2] == 7))
		{
			gGT->numLaps = (u8)v[2];
		}
	}

	for (int i = 0; i < 4; i++)
	{
		data.characterIDs[i] = (s16)v[4 + i];
	}
	MM_Characters_BackupIDs();

	gGT->currLEV = v[1];
	QueueLoadTrack_MenuProc(&D230.menuMainMenu);
}

// ---- The precise start ----

EM_JS(int, WebDebugBridge_SeedJS, (u32 *out), {
	const s = globalThis.__ctrSeed;
	if (s == null || String(s).length === 0) return 0;
	HEAPU32[out >> 2] = Number(s) >>> 0;
	return 1;
});

// Every generator the game draws from (MixRNG.c, RngDeadCoed.c, PSX_BIOS_Rand.c, the audio's), each
// from the seed and its own constant so that none is zero (RngDeadCoed's state must not be) ; and
// the free-running frame counters, which the AI reads too (BOTS.c : gGT->timer) and which differ by
// how long the boot and the menus took : the same race, however it was reached (a replay's start
// made again on another build, session 45b).
internal void WebDebugBridge_Seed(struct GameTracker *gGT, u32 seed)
{
	const u32 mix = seed * 0x9e3779b9u;

	gGT->timer = 0x100;
	gGT->frameTimer_VsyncCallback = 0x200;
	sdata->frameCounter = 0x100;

	sdata->randomNumber = (int)MixRNG_GetValue((s32)seed);
	sdata->advRng.state0 = 0x30215400u ^ mix;
	sdata->advRng.state1 = 0x493583feu ^ (mix >> 7) ^ 1u;
	gGT->deadcoed_struct.state0 = 0x30215400u ^ (mix << 3);
	gGT->deadcoed_struct.state1 = 0x493583feu ^ seed ^ 2u;
	sdata->audioRNG = 0x15a37e63u ^ mix;
	PSX_BIOS_SetRandSeed(seed);
}

// 1 record, 2 stop, 3 play (path written into `path`, the record count into *frames, *bypass)
EM_JS(int, WebDebugBridge_ReplayJS, (char *path, int size, int *frames, int *bypass), {
	const R = globalThis.__ctrReplay;
	if (!R || R.taken) return 0;
	R.taken = true;
	R.samples = [];
	if (R.op === 'record') return 1;
	if (R.op === 'stop') return 2;
	if (R.op !== 'play') return 0;
	stringToUTF8(R.path, path, size);
	HEAP32[frames >> 2] = R.frames | 0;
	HEAP32[bypass >> 2] = R.bypass ? 1 : 0;
	return 3;
});

EM_JS(void, WebDebugBridge_ReplayStateJS, (const char *what, int frame), {
	const R = globalThis.__ctrReplay;
	if (!R) return;
	R.state = UTF8ToString(what);
	R.frame = frame;
	if (R.state === 'ended' || R.state === 'failed') R.done = true;
});

// one sample : the replay frame, the generators, then 8 per kart (present, lap, rank, x, y, z, speed, angle)
EM_JS(void, WebDebugBridge_ReplaySampleJS, (const s32 *v, int karts), {
	const R = globalThis.__ctrReplay;
	if (!R) return;
	const a = Array.from(HEAP32.subarray(v >> 2, (v >> 2) + 8 + karts * 8));
	const s = { frame: a[0], level: a[1], raceTime: a[2], rng: a.slice(3, 8).map((n) => n >>> 0), karts: [] };
	for (let i = 0; i < karts; i++) {
		const k = a.slice(8 + i * 8, 16 + i * 8);
		s.karts.push(k[0] ? { lap: k[1], rank: k[2], pos: [k[3], k[4], k[5]], speed: k[6], angle: k[7] } : null);
	}
	R.samples.push(s);
});

enum WebReplayState
{
	WEB_REPLAY_IDLE = 0,
	WEB_REPLAY_ARMED,
	WEB_REPLAY_RECORDING,
	WEB_REPLAY_PLAYING
};

global_variable enum WebReplayState s_webReplay;
global_variable s32 s_webReplayFrame;
global_variable s32 s_webReplayFrames;
global_variable s32 s_webRaceLive;
global_variable s32 s_webRaceFrame = -1;

internal void WebDebugBridge_ReplaySample(struct GameTracker *gGT)
{
	s32 v[8 + 8 * 8];

	memset(v, 0, sizeof(v));
	v[0] = s_webReplayFrame;
	v[1] = gGT->levelID;
	v[2] = gGT->elapsedEventTime;
	v[3] = (s32)sdata->randomNumber;
	v[4] = (s32)sdata->advRng.state0;
	v[5] = (s32)sdata->advRng.state1;
	v[6] = (s32)gGT->deadcoed_struct.state0;
	v[7] = (s32)gGT->deadcoed_struct.state1;
	for (int i = 0; i < 8; i++)
	{
		struct Driver *k = s_webRaceLive ? gGT->drivers[i] : NULL;
		s32 *o = &v[8 + i * 8];

		if (k == NULL)
		{
			continue;
		}
		o[0] = 1;
		o[1] = k->lapIndex;
		o[2] = k->driverRank;
		o[3] = k->posCurr.x;
		o[4] = k->posCurr.y;
		o[5] = k->posCurr.z;
		o[6] = k->speedApprox;
		o[7] = k->angle & 0xfff;
	}
	WebDebugBridge_ReplaySampleJS(v, 8);
}

// Upstream's replay started as its command line would start it (main.c), from the page. A
// recording prepares its report folder, whose log path upstream sets before the log opens (main.c,
// before Platform_Init) — Platform_LogSetPath refuses once it is open : held aside for that call,
// the log keeps its stream (native_log.c, the same unity build).
internal s32 WebDebugBridge_ReplayArgs(int argc, char **argv)
{
	FILE *log = s_logStream;
	s32 ok;

	s_logStream = NULL;
	ok = NativeReplayScheduler_ConfigureFromArgs(argc, argv) == 0;
	s_logStream = log;
	return ok;
}

internal void WebDebugBridge_Replay(struct GameTracker *gGT, s32 raceBegins)
{
	char path[256];
	int frames = 0;
	int bypass = 0;

	switch (WebDebugBridge_ReplayJS(path, sizeof(path), &frames, &bypass))
	{
	case 1:
		s_webReplay = WEB_REPLAY_ARMED;
		WebDebugBridge_ReplayStateJS("armed", 0);
		break;
	case 2:
		if (s_webReplay == WEB_REPLAY_RECORDING)
		{
			NativeReplayScheduler_RequestStop();
			s_webReplay = WEB_REPLAY_IDLE;
			// RequestStop finalizes after the frame now running : the files are whole at the next
			WebDebugBridge_ReplayStateJS("stopping", s_webReplayFrame);
		}
		break;
	case 3:
	{
		char *argv[] = { "ctr", "--replay", path, "--replay-bypass-header" };

		s_webReplayFrame = 0;
		s_webReplayFrames = frames;
		if (WebDebugBridge_ReplayArgs(bypass ? 4 : 3, argv))
		{
			s_webReplay = WEB_REPLAY_PLAYING;
			WebDebugBridge_ReplayStateJS("playing", 0);
		}
		else
		{
			WebDebugBridge_ReplayStateJS("failed", 0);
		}
		return;
	}
	}

	if ((s_webReplay == WEB_REPLAY_ARMED) && raceBegins)
	{
		char *argv[] = { "ctr", "--record" };

		s_webReplayFrame = 0;
		if (WebDebugBridge_ReplayArgs(2, argv))
		{
			s_webReplay = WEB_REPLAY_RECORDING;
			WebDebugBridge_ReplayStateJS("recording", 0);
		}
		else
		{
			s_webReplay = WEB_REPLAY_IDLE;
			WebDebugBridge_ReplayStateJS("failed", 0);
		}
		return;
	}

	if ((s_webReplay == WEB_REPLAY_RECORDING) || (s_webReplay == WEB_REPLAY_PLAYING))
	{
		// this frame was replay frame s_webReplayFrame (the first is the frame after the start)
		if ((s_webReplayFrame % 300) == 0)
		{
			WebDebugBridge_ReplaySample(gGT);
		}
		s_webReplayFrame++;
		WebDebugBridge_ReplayStateJS(s_webReplay == WEB_REPLAY_PLAYING ? "playing" : "recording", s_webReplayFrame);
		if ((s_webReplay == WEB_REPLAY_PLAYING) && (s_webReplayFrame >= s_webReplayFrames))
		{
			// upstream's playback returns 1 from the next BeginFrame and CTR_Main ends : ended here
			// instead, after the last recorded frame, the game going on with the live pads
			NativeReplayScheduler_Shutdown();
			s_webReplay = WEB_REPLAY_IDLE;
			WebDebugBridge_ReplayStateJS("ended", s_webReplayFrame);
		}
	}
}

// out : [0..1] unlocks, [2..19] timeTrialFlags, [20] adv slot (-1 none), [21..26] rewards,
// [27] character, [28] hub, [29] version (0 = the game's) ; name into `name`
EM_JS(int, WebDebugBridge_CardJS, (u32 *out, char *name, int size), {
	const C = globalThis.__ctrCard;
	if (!C || C.taken) return 0;
	C.taken = true;
	if (C.op === 'ghost') return 2;
	if (C.op !== 'write') return 0;
	const o = out >> 2;
	for (let i = 0; i < 30; i++) HEAPU32[o + i] = 0;
	HEAPU32[o] = (C.unlocks?.[0] ?? 0) >>> 0;
	HEAPU32[o + 1] = (C.unlocks?.[1] ?? 0) >>> 0;
	for (let i = 0; i < 18; i++) HEAPU32[o + 2 + i] = (C.tt?.[i] ?? 0) >>> 0;
	HEAP32[o + 20] = C.adv ? C.adv.slot | 0 : -1;
	for (let i = 0; i < 6; i++) HEAPU32[o + 21 + i] = (C.adv?.rewards?.[i] ?? 0) >>> 0;
	HEAP32[o + 27] = C.adv?.character ?? 0;
	HEAP32[o + 28] = C.adv?.hub ?? 0;
	HEAP32[o + 29] = C.version ?? 0;
	stringToUTF8(C.adv && C.adv.name ? String(C.adv.name) : String(), name, size);
	return 1;
});

EM_JS(void, WebDebugBridge_CardDoneJS, (const char *what), {
	const C = globalThis.__ctrCard;
	if (!C) return;
	C.state = UTF8ToString(what);
	C.done = true;
});

EM_JS(void, WebDebugBridge_PreciseJS, (int screen, int start, int stage, int frameCounter, int raceFrame, const s32 *pos, const s32 *card), {
	if (!globalThis.__ctr) return;
	const c = HEAP32.subarray(card >> 2, (card >> 2) + 4 + 5 * 8);
	const profile = (i) => {
		const p = c.subarray(4 + i * 8, 12 + i * 8);
		return p[0] < 0 ? null : { character: p[0], hub: p[1], rewards: Array.from(p.subarray(2, 8), (n) => n >>> 0) };
	};
	globalThis.__ctr.card = { screen, start, stage, version: c[0], outdated: c[1], ghosts: c[2], tropyBeaten: c[3], profiles: [0, 1, 2, 3].map(profile), adv: profile(4) };
	globalThis.__ctr.frameCounter = frameCounter;
	globalThis.__ctr.raceFrame = raceFrame;
	const p = HEAP32.subarray(pos >> 2, (pos >> 2) + 32);
	globalThis.__ctr.positions = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (p[i * 4] ? [p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3]] : null));
});

// A card written by the game : the progress set as the spec says, a new card's profile around it
// (GAMEPROG_InitFullMemcard), then SelectProfile_SaveAdvProfile's own steps — the game's options,
// the cups, the progress synced into the card's buffer, MEMCARD_SetIcon, the save request that
// RefreshCard runs on the next frames (the main menu runs it, MainFrame_RenderFrame.c).
internal void WebDebugBridge_CardWrite(struct GameTracker *gGT, const u32 *v, const char *name)
{
	struct MemcardProfile *card = (struct MemcardProfile *)sdata->ptrToMemcardBuffer2;

	if ((gGT->gameMode1 & MAIN_MENU) == 0)
	{
		WebDebugBridge_CardDoneJS("refused : not in the main menu");
		return;
	}

	GAMEPROG_InitFullMemcard(card);
	GAMEPROG_NewProfile_OutsideAdv(&GAME_SAVE);
	GAME_PROGRESS.unlocks[0] = v[0];
	GAME_PROGRESS.unlocks[1] = v[1];
	for (int i = 0; i < MEMCARD_HIGH_SCORE_TRACK_COUNT; i++)
	{
		GAME_PROGRESS.highScoreTracks[i].timeTrialFlags = v[2 + i];
	}

	RaceConfig_SaveGameOptions();
	GAMEPROG_SaveCupProgress();
	GAMEPROG_SyncGameAndCard(&card->gameSave.progress, &GAME_SAVE.progress);
	if ((s32)v[20] >= 0 && (s32)v[20] < MEMCARD_ADV_PROFILE_COUNT)
	{
		GAMEPROG_NewProfile_InsideAdv(&GAME_ADV_PROGRESS);
		for (int i = 0; i < 6; i++)
		{
			GAME_ADV_PROGRESS.rewards[i] = v[21 + i];
		}
		memcpy(GAME_ADV_PROGRESS.name, name, sizeof(GAME_ADV_PROGRESS.name));
		GAME_ADV_PROGRESS.characterID = (s16)v[27];
		GAME_ADV_PROGRESS.HubLevYouSavedOn = (s16)v[28];
		memcpy(&card->advProgress[v[20]], &GAME_ADV_PROGRESS, sizeof(GAME_ADV_PROGRESS));
	}
	memcpy(&card->gameSave, &GAME_SAVE, sizeof(GAME_SAVE));
	if (v[29] != 0)
	{
		// an older profile version, written by the game as any card (its CRC valid)
		card->header[0] = (s16)v[29];
	}
	MEMCARD_SetIcon(0);
	RefreshCard_StartMemcardAction(3);
	WebDebugBridge_CardDoneJS("requested");
}

// The Time Trial just run saved as a ghost, by SelectProfile_StartGhostSave's steps (the end of
// race runs RefreshCard), in the card's first ghost row
internal void WebDebugBridge_CardGhost(struct GameTracker *gGT)
{
	struct Driver *driver = gGT->drivers[0];

	if (((gGT->gameMode1 & TIME_TRIAL) == 0) || ((gGT->gameMode1 & END_OF_RACE) == 0) || (driver == NULL))
	{
		WebDebugBridge_CardDoneJS("refused : not at the end of a Time Trial");
		return;
	}
	RefreshCard_GhostEncodeProfile(0, GAME_CHARACTER_IDS[0], gGT->levelID, driver->timeElapsedInRace, gGT->prevNameEntered);
	GAME_MEMCARD_STATE.ghostProfile_indexSave = 0;
	GAME_MEMCARD_STATE.ghostProfile_rowSelect = (GAME_MEMCARD_STATE.numGhostProfilesSaved > 0) ? 0 : -1;
	MEMCARD_SetIcon(1);
	RefreshCard_StartMemcardAction(6);
	WebDebugBridge_CardDoneJS("requested");
}

internal void WebDebugBridge_Precise(struct GameTracker *gGT)
{
	// a race or a battle (not the boot's intro levels, the hubs, the menus), loaded, its drivers in
	const s32 live = (sdata->Loading.stage == LOAD_IDLE) && ((gGT->gameMode1 & (MAIN_MENU | LOADING)) == 0) && (gGT->levelID < GEM_STONE_VALLEY) &&
	                 (gGT->drivers[0] != NULL);
	const s32 raceBegins = live && !s_webRaceLive;
	u32 seed;

	s_webRaceLive = live;
	s_webRaceFrame = !live ? -1 : raceBegins ? 0 : s_webRaceFrame + 1;
	// a replay brings its own generators back with its first checkpoint
	if (raceBegins && (s_webReplay != WEB_REPLAY_PLAYING) && WebDebugBridge_SeedJS(&seed))
	{
		WebDebugBridge_Seed(gGT, seed);
	}
	WebDebugBridge_Replay(gGT, raceBegins);

	{
		u32 v[30];
		char name[sizeof(GAME_ADV_PROGRESS.name)];

		switch (WebDebugBridge_CardJS(v, name, sizeof(name)))
		{
		case 1:
			WebDebugBridge_CardWrite(gGT, v, name);
			break;
		case 2:
			WebDebugBridge_CardGhost(gGT);
			break;
		}
	}
	{
		s32 pos[8 * 4];

		memset(pos, 0, sizeof(pos));
		for (int i = 0; live && (i < 8); i++)
		{
			struct Driver *k = gGT->drivers[i];

			if (k != NULL)
			{
				pos[i * 4] = 1;
				pos[i * 4 + 1] = k->posCurr.x >> 8;
				pos[i * 4 + 2] = k->posCurr.y >> 8;
				pos[i * 4 + 3] = k->posCurr.z >> 8;
			}
		}
		struct MemcardProfile *buffer = (struct MemcardProfile *)sdata->ptrToMemcardBuffer2;
		s32 card[4 + 5 * 8];

		memset(card, 0, sizeof(card));
		card[0] = buffer ? buffer->header[0] : 0;
		card[1] = sdata->boolMemcardDataOutdated;
		card[2] = GAME_MEMCARD_STATE.numGhostProfilesSaved;
		for (int i = 0; i < MEMCARD_HIGH_SCORE_TRACK_COUNT; i++)
		{
			card[3] += (GAME_PROGRESS.highScoreTracks[i].timeTrialFlags & TT_NTROPY_BEATEN) != 0;
		}
		for (int i = 0; i < MEMCARD_ADV_PROFILE_COUNT; i++)
		{
			s32 *o = &card[4 + i * 8];

			o[0] = buffer ? buffer->advProgress[i].characterID : -1;
			o[1] = buffer ? buffer->advProgress[i].HubLevYouSavedOn : 0;
			for (int w = 0; w < 6; w++)
			{
				o[2 + w] = buffer ? (s32)buffer->advProgress[i].rewards[w] : 0;
			}
		}
		card[4 + 4 * 8] = GAME_ADV_PROGRESS.characterID;
		card[4 + 4 * 8 + 1] = GAME_ADV_PROGRESS.HubLevYouSavedOn;
		for (int w = 0; w < 6; w++)
		{
			card[4 + 4 * 8 + 2 + w] = (s32)GAME_ADV_PROGRESS.rewards[w];
		}
		WebDebugBridge_PreciseJS(sdata->mcScreenText, sdata->mcStart, sdata->memcard_stage, (int)sdata->frameCounter, s_webRaceFrame, pos, card);
	}
}

internal void WebDebugBridge_Publish(void)
{
	struct GameTracker *gGT = sdata->gGT;
	struct RectMenu *menu = sdata->ptrActiveMenu;
	struct Driver *d;
	const char *menuTitle = NULL;
	const char *menuLabel = NULL;
	int menuRow = -1;
	int menuState = 0;
	int checkpoint = -1;
	int targetX = 0;
	int targetZ = 0;

	if (gGT == NULL)
	{
		return;
	}

	{
		static struct NavHeader *s_publishedPath = NULL;
		struct NavHeader *nh = NULL;

		if ((gGT->level1 != NULL) && (gGT->level1->LevNavTable != NULL))
		{
			nh = gGT->level1->LevNavTable[0];
		}
		if ((nh != NULL) && ((u16)nh->magicNumber != 0xECFD))
		{
			nh = NULL;
		}
		if (nh != s_publishedPath)
		{
			s_publishedPath = nh;
			WebDebugBridge_PushPathJS(gGT->levelID, nh ? (const s16 *)NAVHEADER_GETFRAME(nh) : NULL, nh ? nh->numPoints : 0,
			                          sizeof(struct NavFrame));
		}
	}

	if (menu != NULL)
	{
		menuTitle = WebDebugBridge_String(menu->stringIndexTitle);
		menuRow = menu->rowSelected;
		menuState = menu->state;
		if ((menu->rows != NULL) && (menuRow >= 0))
		{
			menuLabel = WebDebugBridge_String(menu->rows[menuRow].stringIndex);
		}
	}

	d = gGT->drivers[0];
	if (d != NULL)
	{
		checkpoint = WebDebugBridge_Target(gGT, d, &targetX, &targetZ);
	}

	WebDebugBridge_PushJS(VSync(-1), gGT->gameMode1, gGT->gameMode2, gGT->levelID, gGT->numLaps, gGT->trafficLightsTimer,
	                      gGT->elapsedEventTime, menu != NULL, menuTitle, menuRow, menuLabel, menuState, d != NULL, d ? d->lapIndex : 0,
	                      d ? d->speedApprox : 0, d ? d->driverRank : 0, d ? ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0) : 0,
	                      d ? (d->posCurr.x >> 8) : 0, d ? (d->posCurr.y >> 8) : 0, d ? (d->posCurr.z >> 8) : 0, d ? (d->angle & 0xfff) : 0, checkpoint, targetX,
	                      targetZ, d ? (int)d->distanceToFinish_curr : 0);

	{
		struct RectMenu *sub = NULL;
		const char *subTitle = NULL;
		const char *subLabel = NULL;
		s32 karts[4 * 27];
		int players = gGT->numPlyrCurrGame;

		for (struct RectMenu *m = menu; (m != NULL) && (m->state & DRAW_NEXT_MENU_IN_HIERARCHY) && (m->ptrNextBox_InHierarchy != NULL);
		     m = m->ptrNextBox_InHierarchy)
		{
			sub = m->ptrNextBox_InHierarchy;
		}
		if (sub != NULL)
		{
			subTitle = WebDebugBridge_String(sub->stringIndexTitle);
			if ((sub->rows != NULL) && (sub->rowSelected >= 0))
			{
				subLabel = WebDebugBridge_String(sub->rows[sub->rowSelected].stringIndex);
			}
		}
		if (players > 4)
		{
			players = 4;
		}
		for (int i = 0; i < players; i++)
		{
			struct Driver *k = gGT->drivers[i];
			s32 *o = &karts[i * 27];
			int tx = 0;
			int tz = 0;

			o[0] = k != NULL;
			if (k == NULL)
			{
				continue;
			}
			o[9] = WebDebugBridge_Target(gGT, k, &tx, &tz);
			o[1] = k->lapIndex;
			o[2] = k->speedApprox;
			o[3] = k->driverRank;
			o[4] = (k->actionsFlagSet & ACTION_RACE_FINISHED) != 0;
			o[5] = k->posCurr.x >> 8;
			o[6] = k->posCurr.y >> 8;
			o[7] = k->posCurr.z >> 8;
			o[8] = k->angle & 0xfff;
			o[10] = tx;
			o[11] = tz;
			o[12] = (s32)k->distanceToFinish_curr;
			o[13] = k->numWumpas;
			// the turbo's reserves (a start boost, a slide's boost : > 0 while it lasts) and the pad's
			// Cross held this frame (session 42 : the touch pad's held accelerator, the start boost)
			o[22] = k->reserves;
			o[23] = (i < NATIVE_INPUT_MAX_CONTROLLERS) && ((NativeInput_GetSnapshotButtons(&s_controllers[i].snapshot) & 0x4000) == 0);
			o[14] = (s32)k->heldItemID;
			// session 42b : the kart's state (KS_*), a slide's frame counter (signed : it spins out or
			// ends past the driver's limit) and the action flags — why a slide ended
			o[24] = k->kartState;
			o[25] = (k->kartState == KS_DRIFTING) ? k->KartStates.Drifting.numFramesDrifting : 0;
			o[26] = (s32)k->actionsFlagSet;
			o[15] = k->itemRollTimer;
			o[16] = k->numTimesHitWeaponBox;
			o[17] = k->invisibleTimer;
			o[18] = k->invincibleTimer;
			o[19] = 0;
			o[20] = 0;
			o[21] = 0;
			// drivers[] is stale in the menus and while a level loads (lap 40, rank 2397) : its
			// instSelf is a pointer to follow in a race only
			const int racing = (sdata->Loading.stage == LOAD_IDLE) && ((gGT->gameMode1 & (MAIN_MENU | LOADING)) == 0);

			for (int v = 0; racing && (k->instSelf != NULL) && (v < players); v++)
			{
				o[19] |= ((k->instSelf->idpp[v].instFlags & DRAW_SUCCESSFUL) != 0) << v;
				o[20] |= (k->instSelf->idpp[v].lodIndex & 0xff) << (v * 8);
				o[21] |= ((k->instSelf->idpp[v].instFlags & HIDE_MODEL) != 0) << v;
			}
		}
		// charSelect packed : locked bits 0-3, players 4-6, each player's character 4 bits from bit 8
		int charSelect = -1;
		if (menu == &D230.menuCharacterSelect)
		{
			charSelect = (int)(sdata->characterSelectFlags & 0xf) | ((gGT->numPlyrNextGame & 7) << 4);
			for (int p = 0; p < 4; p++)
				charSelect |= (data.characterIDs[p] & 0xf) << (8 + p * 4);
		}
		WebDebugBridge_PushMoreJS(sub != NULL, subTitle, sub ? sub->rowSelected : -1, subLabel, sub ? (int)sub->state : 0, players, karts,
		                          charSelect,
		                          WebDebugBridge_PoolFree(&gGT->JitPools.thread), WebDebugBridge_PoolFree(&gGT->JitPools.smallStack));
		WebDebugBridge_UnlocksJS(GAME_PROGRESS.unlocks[0], GAME_PROGRESS.unlocks[1], WEB_UNLOCK_ALL_OPEN);
		{
			const int n = GAME_LANGUAGE_STRING_COUNT;
			WebDebugBridge_DiscJS(s_webViewPal, s_webViewLanguage, s_webViewLastXa[0] ? s_webViewLastXa : NULL, (n > 3) ? GAME_LANGUAGE_STRINGS[3] : NULL,
			                      (n > 560) ? GAME_LANGUAGE_STRINGS[560] : NULL);
		}
		{
			int drivers = 0;
			const int racing = (sdata->Loading.stage == LOAD_IDLE) && ((gGT->gameMode1 & (MAIN_MENU | LOADING)) == 0);

			for (int i = 0; racing && (i < 8); i++)
			{
				drivers += gGT->drivers[i] != NULL;
			}
			WebDebugBridge_DriversJS(data.characterIDs, drivers);
		}
	}


	if (gGT->backBuffer != NULL)
	{
		struct PrimMem *pm = &gGT->backBuffer->primMem;

		WebDebugBridge_PushPrimJS((int)((u8 *)pm->cursor - (u8 *)pm->start), (int)((u8 *)pm->guardEnd - (u8 *)pm->start),
		                          (int)((u8 *)pm->end - (u8 *)pm->start));
		WebDebugBridge_Flicker(gGT);
	}
	WebDebugBridge_AudioJS();
	WebDebugBridge_Stall();
	WebDebugBridge_State();
	WebDebugBridge_Start(gGT);
	WebDebugBridge_Precise(gGT);
}
