// Shared helpers for the CTR player suites (*.suite.mjs beside this file).
// No top-level side effects : a bare `node --test` imports this harmlessly.
//
// Game state comes from window.__ctr (platform/web_debug_bridge.c, debug web
// builds only), never from pixels.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as autopilot from '../../ui/src/lib/autopilot.js'
import { MAIN_MENU, MAIN_MENU_IDS, onMainMenu, menuTo as autoMenuTo } from '../../ui/src/lib/autopilot.js'

// The suites' page options. pressFrames : a press must outlast one game frame
// (30 fps) on any display — 8 rAF = 67 ms at 120 Hz, 133 ms at 60 Hz.
export const PLAYER = { gamepad: true, pressFrames: 8 }

// MAIN_MENU (the main menu's rows) and onMainMenu : web/ui/src/lib/autopilot.js's, shared with the page
export { MAIN_MENU, MAIN_MENU_IDS, onMainMenu }

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** How often a long wait says where it is. */
export const HEARTBEAT_MS = 10_000

/** A progress line between the harness's PASS / FAIL lines, so a long wait never looks hung. */
export const say = (...a) => console.log(`    · ${new Date().toTimeString().slice(0, 8)}`, ...a)

/** window.__ctr without its track, or null before the first published frame. */
export const state = ctx => ctx.js('if (!window.__ctr) return null; const { track, ...s } = window.__ctr; return s')

/** window.__ctr.track : { levelID, path: [{x, y, z}] }, the level's racing line. */
export const track = ctx => ctx.js('return window.__ctr?.track ?? null')

/** Waits until `pred(__ctr)` holds ; returns that state. */
export async function until(ctx, label, pred, { timeout = 30_000, every = 200 } = {}) {
	const start = Date.now()
	const deadline = start + timeout
	let beat = start + HEARTBEAT_MS
	let s = null
	while (Date.now() < deadline) {
		s = await state(ctx)
		if (s && pred(s)) return s
		if (Date.now() >= beat) {
			say(`still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s of ${Math.round(timeout / 1000)}) : ${brief(s)}`)
			beat += HEARTBEAT_MS
		}
		await sleep(every)
	}
	throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${label} (last: ${brief(s)})`)
}

/** One line of __ctr for messages. */
export function brief(s) {
	if (!s) return 'no window.__ctr — is this a debug build?'
	const menu = s.menu ? ` menu=${JSON.stringify(s.menu.title)}/${s.menu.row}:${JSON.stringify(s.menu.label)}${s.menu.input ? '' : '(no input)'}` : ''
	const k = s.kart
	const kart = k && s.screen !== 'menu' ? ` lap=${k.lap}/${s.numLaps} speed=${k.speed} rank=${k.rank} cp=${k.checkpoint}` : ''
	return `screen=${s.screen} level=${s.levelID} mode=${s.mode.join('|')}${menu}${kart} vblank=${s.vblank} fps=${s.fps}`
}


/**
 * Boots to the main menu. The intro (copyright, crate, trophy) would play into
 * the menu by itself, ~45 s after boot with the preload build ; Cross skips it.
 */
export async function bootToMenu(ctx) {
	// The 605 MB preload crosses VS Code's port forwarding, which sometimes
	// drops it (`TypeError: network error` in #log) or stalls it with nothing
	// logged at all : reload, up to 3 tries. A game that runs (`vblank=` lines)
	// with no __ctr is a release build : no point reloading.
	const log = () => ctx.js("return document.getElementById('log')?.textContent ?? ''")
	for (let attempt = 1; ; attempt++) {
		if (!(await state(ctx))) say(`waiting for the game to boot (window.__ctr)${attempt > 1 ? `, attempt ${attempt}` : ''}`)
		const deadline = Date.now() + 120_000
		// a build without the preloaded disc, the disc stored : the boot screen waits for a press
		while (Date.now() < deadline && !(await state(ctx)) && !/network error/.test(await log())) {
			if (await ctx.js("return !!document.getElementById('press-start')").catch(() => false)) {
				say('disc ready in this browser : pressing Enter')
				await ctx.press('Enter')
			}
			await sleep(1000)
		}
		if (await state(ctx)) break
		const text = await log()
		if (attempt === 3 || /vblank=/.test(text)) {
			throw new Error(`no window.__ctr after attempt ${attempt} — is this a debug build ? page log : ${text.trim().split('\n').slice(-3).join(' | ')}`)
		}
		say('no game after 2 min (the data stream over the forwarded port can stall) : reloading')
		await ctx.reload()
	}
	// Skip the intro : Cross while the menu takes no input yet, re-read before
	// every press. A press landing as the menu wakes opens Adventure : Triangle
	// backs out of it.
	// Such a press sets ADVENTURE_MODE while the main menu still reads as the main menu for a
	// moment (the title on its way out, every input ignored) : not idle until it is gone, and
	// still so 1 s after the last press (session 32b, MENU-KEYBOARD / MENU-PAD stuck on row 0).
	const idle = s => onMainMenu(s) && !s.mode?.includes('ADVENTURE_MODE')
	const deadline = Date.now() + 180_000
	let s = await state(ctx)
	if (!idle(s)) say(`game running (${s.screen}) : skipping the intro to the main menu`)
	for (;;) {
		while (!idle(s) && Date.now() < deadline) {
			if (s.menu?.input) await ctx.press('z') // keyboard Z = Triangle
			else await ctx.press('c')
			await sleep(250)
			s = await state(ctx)
		}
		await sleep(1000)
		s = await state(ctx)
		if (idle(s) || Date.now() >= deadline) break
	}
	s = await until(ctx, 'the main menu', idle, { timeout: 5000, every: 250 })
	// Keys go to the focused element ; session 2's suite focused the canvas too.
	await ctx.js("document.getElementById('canvas')?.focus(); return true")
	return s
}

/**
 * Moves the main-menu cursor to `label` with `step(dir)` ('up' / 'down'),
 * asserting each step lands on the next row. Returns the rows visited.
 */
export async function menuTo(ctx, label, step) {
	// The menu acts on a newly pressed button : the next press must come after the game has
	// sampled this one released (one 30 fps frame or more) — 8 rAF.
	return autoMenuTo({
		read: () => state(ctx),
		out: { press: key => step(key === 'ArrowDown' ? 'down' : 'up') },
		id: MAIN_MENU[label],
		rows: MAIN_MENU_IDS,
		settle: () => ctx.frames(8),
	})
}

/**
 * Plays `fn` under ctx.record. index.html routes everything to the speakers through a
 * gain node (`ctrMute`), at zero under the player harness ; the harness taps what reaches the
 * destination, i.e. after that node, so the video is silent. The test browser plays on the
 * host's speakers (the user's Mac) : the sound is lifted only on request, `--set sound=1`
 * (user, session 12 : « désactive ce son quand tu testes »).
 */
export async function recordWithSound(ctx, label, fn) {
	if (ctx.args?.sound !== '1') return ctx.record(label, fn)
	const gain = v => ctx.js(`const m = globalThis.ctrAudio?.context?.ctrMute; if (m) m.gain.value = ${v}; return !!m`)
	await gain(1)
	try {
		return await ctx.record(label, fn)
	} finally {
		await gain(0)
	}
}

/** Asserts the VBlank clock advances over `ms` ; returns the VBlanks counted. */
export async function vblankAdvances(ctx, ms = 2000) {
	const a = await state(ctx)
	await sleep(ms)
	const b = await state(ctx)
	const n = b.vblank - a.vblank
	// 59.82 Hz : allow a wide band, the point is « advancing at game speed ».
	if (n < (ms / 1000) * 40) throw new Error(`VBlank advanced ${n} in ${ms} ms (from ${a.vblank} to ${b.vblank})`)
	return n
}

/** The racing line driven by autopilot.js over `js` (a page's or another browser's), until `deadline`. */
export async function drive(p, js, deadline, state = 'window.__ctr') {
	return autopilot.drive({
		out: p,
		read: () => js(`const c = ${state}; if (!c) return null; const { track, ...s } = c; return s`),
		track: () => js(`return (${state})?.track ?? null`),
		deadline,
	})
}

/** The run's proof folder : the newest one under --set proofs=<root> holding `file`. */
export function runDirOf(root, file) {
	if (!root) return null
	const dirs = readdirSync(root).map(d => join(root, d)).filter(d => existsSync(join(d, file)))
	return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

/**
 * A screenshot of the host's page. ctx.shot's capture (fromSurface: false) comes back flat grey
 * on the headless agent browser (LOG ## T3) : the same file is rewritten from the compositor's
 * surface, which shows the game.
 */
export async function shot(ctx, label) {
	const proof = await ctx.shot(label)
	const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
	const r = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, ctx.sid)
	if (dir && r?.data) writeFileSync(join(dir, proof.file), Buffer.from(r.data, 'base64'))
	return proof
}

// ---- the fast start (web/ui/src/dev/fast.js, debug builds) ----

/**
 * Opens the game page with `query` (dev/fast.js's ?race= / ?state= / ?turbo=) and waits for the
 * game's first frame (~6 s). A load can still stall (a request lost on the way, see serve.py) : no
 * frame in `stall` ms, the page is loaded again, up to `tries` times.
 */
export async function open(ctx, query = '', { stall = 15_000, tries = 3 } = {}) {
	const base = await ctx.js('return location.origin + location.pathname')
	const url = base + query
	const t0 = Date.now()
	for (let attempt = 1; ; attempt++) {
		await ctx.conn.send('Page.navigate', { url }, ctx.sid)
		await sleep(300)
		const end = Date.now() + stall
		while (Date.now() < end) {
			if (await ctx.js('return !!window.__ctr').catch(() => false)) {
				// a fast start skips the boot screen's press, the user gesture the sound waits for
				// (index.html resumes the AudioContext inside one) : a click on the game gives it
				const at = await ctx.js("const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }")
				for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, ctx.sid)
				return { url, ms: Date.now() - t0, attempt }
			}
			// no ?race / ?state / ?turbo : the boot screen waits for a press
			if (await ctx.js("return !!document.getElementById('press-start')").catch(() => false)) await ctx.press('Enter')
			await sleep(200)
		}
		const where = await ctx
			.js("const log = (document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-2).join(' / '); return (document.getElementById('ctr-ui')?.innerText?.replace(/\\s+/g, ' ').slice(0, 80) ?? '') + ' · log : ' + log")
			.catch(() => '?')
		if (attempt >= tries) throw new Error(`no game frame after ${tries} loads of ${url} (the page : « ${where} »)`)
		say(`no game frame ${stall / 1000} s after loading ${query || 'the page'} (« ${where} ») : loading it again`)
	}
}

/**
 * A real boot (the card read from the browser as on any start) in turbo, to the main menu : ~12 s
 * instead of ~45. For the scenarios about the card or the unlocks, which a snapshot would answer
 * with the card it was made with.
 */
export async function bootFast(ctx) {
	await open(ctx, '?turbo=1')
	const s = await bootToMenu(ctx)
	await turbo(ctx, false)
	return s
}

/** Turbo on or off (dev/fast.js) : frames back to back. Never for the sound or Share. */
export const turbo = (ctx, on) => ctx.js(`return globalThis.ctrDev.turbo(${on ? 'true' : 'false'})`)

/** Where the snapshots are kept : web/test/player/.states/<build>/ (gitignored, read by serve.py). */
export const STATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '.states')

/**
 * Saves the game's state as snapshot `name` (dev/fast.js), its bytes pulled over the devtools
 * connection in pieces (one 4 MB answer dropped the agent browser's connection) and written beside
 * this file. Returns { name, bytes, at, build }.
 */
export async function saveState(ctx, name) {
	const r = await ctx.js('return globalThis.ctrDev.state.save()')
	const PIECE = 384 << 10
	const parts = []
	for (let at = 0; at < r.bytes; at += PIECE) {
		const b64 = await ctx.js(`const a = globalThis.__ctrSaved.bytes.subarray(${at}, ${at + PIECE}); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s)`)
		parts.push(Buffer.from(b64, 'base64'))
	}
	const bytes = Buffer.concat(parts)
	if (bytes.length !== r.bytes) throw new Error(`snapshot ${name} : ${bytes.length} bytes read of ${r.bytes}`)
	const dir = join(STATES_DIR, r.build)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, `${name}.ctrstate`), bytes)
	writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ name, at: r.at, saved: new Date().toISOString() })}\n`)
	await ctx.js('globalThis.__ctrSaved = null; return true')
	return { name, ...r }
}

/** Waits for ?state='s load (dev/fast.js) : { name, ok, missing, expected, got }. */
export async function stateLoaded(ctx, timeout = 60_000) {
	const end = Date.now() + timeout
	for (;;) {
		const r = await ctx.js('return globalThis.__ctrStateLoaded ?? null')
		if (r) return r
		if (Date.now() > end) throw new Error('the snapshot was not loaded (no __ctrStateLoaded)')
		await sleep(100)
	}
}

/** The query of a direct start : { race, char, mode, players, laps, diff }. */
export const raceQuery = r =>
	'?' + new URLSearchParams(Object.entries({ race: r.race, char: [].concat(r.char ?? []).join(','), mode: r.mode ?? 'tt', players: r.players, laps: r.laps, diff: r.diff }).filter(([, v]) => v != null && v !== '')).toString()

/** The snapshot's name for a start point. */
export const pointName = point =>
	typeof point === 'string' ? point : ['race', point.mode ?? 'tt', point.race, [].concat(point.char ?? []).join('+'), `${point.players ?? 1}p`, point.laps && `${point.laps}laps`, point.diff && `diff${point.diff}`].filter(Boolean).join('-').replace(/[^A-Za-z0-9.+-]+/g, '-')

/**
 * Puts the game at a start point, from its snapshot when this build has one, else by the fastest
 * real way there, then saves the snapshot for the next time :
 *   'menu'          the main menu, idle, the cursor on its first row (made : a boot in turbo and
 *                   bootToMenu)
 *   { race, char, mode, players, laps, diff }  a race's countdown (made : the direct start, turbo)
 * Turbo is off on return unless `{ turbo: true }`. A snapshot holds the memory card as it was read
 * when it was made : a scenario about the card or the unlocks starts from a real boot instead.
 * Returns { from: 'snapshot' | 'made', ms, state }.
 */
export async function startAt(ctx, point, { turbo: keep = false } = {}) {
	const name = pointName(point)
	const t0 = Date.now()
	const ready = s => (point === 'menu' ? onMainMenu(s) && s.menu?.input && !s.mode?.includes('ADVENTURE_MODE') : s.screen === 'countdown')
	await open(ctx, `?turbo=1&state=${encodeURIComponent(name)}`)
	const r = await stateLoaded(ctx)
	let from = 'snapshot'
	if (!r.ok) {
		say(`${name} : ${r.missing ? 'no snapshot for this build' : `the snapshot did not restore (${r.error ?? `${r.got} vs ${r.expected}`})`} — making it`)
		from = 'made'
		if (point === 'menu') {
			await bootToMenu(ctx)
		} else {
			await open(ctx, `${raceQuery(point)}&turbo=1`)
			await until(ctx, 'the race countdown', ready, { timeout: 90_000, every: 100 })
		}
		await turbo(ctx, false)
		const saved = await saveState(ctx, name)
		say(`${name} : saved (${Math.round(saved.bytes / 1024)} KB)`)
	}
	await turbo(ctx, keep)
	const s = await until(ctx, name, ready, { timeout: 30_000, every: 100 })
	await ctx.js("document.getElementById('canvas')?.focus(); return true")
	return { from, ms: Date.now() - t0, state: s }
}

// ---- the precise start (web/ui/src/dev/precise.js, dev/presets.js, debug builds) ----
// What a test sets before it begins, beside a snapshot : a seed (?seed=), a recorded race
// (recordRace / playRace), a memory card (makeSave, importSave, ?card=), the settings (?preset=), the
// players (players), the frames (ctrDev.pause / step), faults (?fault=, ctrDev.fault) and a phone
// (phone, tap). Saves and replays hold pieces of the game (icon frames, a checkpoint) : kept beside
// this file in .saves/ and .replays/, gitignored, served by serve.py, refused by web/pages/guard.sh.

const HERE = dirname(fileURLToPath(import.meta.url))
/** web/test/player/.saves/<name>/ : one folder per memory card, its save files as the game wrote them. */
export const SAVES_DIR = join(HERE, '.saves')
/** web/test/player/.replays/<name>/ : one folder per recorded race (upstream's replay files). */
export const REPLAYS_DIR = join(HERE, '.replays')

let awaited = 0
/**
 * Runs `expr` (a promise in the page, ctrDev's) to its end : one evaluation may last 15 s at most
 * (the harness), a recording or a replay minutes — started, then polled, a line every 10 s.
 */
export async function inPage(ctx, expr, { label = expr, timeout = 120_000 } = {}) {
	const key = `__ctrAwait${++awaited}`
	await ctx.js(`globalThis.${key} = { done: false }; Promise.resolve().then(() => ${expr}).then((value) => { globalThis.${key} = { done: true, value } }, (e) => { globalThis.${key} = { done: true, error: String(e?.message ?? e) } }); return true`)
	const t0 = Date.now()
	let beat = t0 + HEARTBEAT_MS
	for (;;) {
		const r = await ctx.js(`return globalThis.${key}`)
		if (r?.done) {
			await ctx.js(`delete globalThis.${key}; return true`)
			if (r.error) throw new Error(`${label} : ${r.error}`)
			return r.value
		}
		if (Date.now() - t0 > timeout) throw new Error(`${label} : not done after ${timeout / 1000} s`)
		if (Date.now() >= beat) {
			say(`still waiting for ${label} (${Math.round((Date.now() - t0) / 1000)} s) : ${brief(await state(ctx))}`)
			beat += HEARTBEAT_MS
		}
		await sleep(250)
	}
}

/** A Uint8Array the page holds (`expr`, `size` bytes) pulled in pieces (one 4 MB answer once dropped the connection). */
async function pullBytes(ctx, expr, size) {
	const PIECE = 384 << 10
	const parts = []
	for (let at = 0; at < size; at += PIECE) {
		const b64 = await ctx.js(`const a = (${expr}).subarray(${at}, ${at + PIECE}); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s)`)
		parts.push(Buffer.from(b64, 'base64'))
	}
	const bytes = Buffer.concat(parts)
	if (bytes.length !== size) throw new Error(`${bytes.length} bytes read of ${size}`)
	return bytes
}

/** Writes `files` ({ 'rel/path': Buffer }) into `dir`, emptied first. */
function writeFolder(dir, files) {
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	for (const rel in files) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true })
		writeFileSync(join(dir, rel), files[rel])
	}
}

/** The query of a direct start with a seed : raceQuery's, plus &seed=. */
export const seededQuery = r => `${raceQuery(r)}&seed=${r.seed ?? 1}`

/**
 * Records a race as replay `name` : the direct start of `race` ({ race, char, mode, players, laps,
 * diff, seed }) in turbo, upstream's recorder from the race's first frame (after the seed), the page's
 * Bot driving, until P1 finishes or `maxFrames`. Kept in .replays/<name>/ : the replay's files,
 * samples.json (the karts and generators every 300 frames) and what.json. Returns what.json.
 */
export async function recordRace(ctx, name, race, { maxFrames = 3000, timeout = 600_000 } = {}) {
	await open(ctx, `${seededQuery(race)}&turbo=1`)
	await inPage(ctx, 'globalThis.ctrDev.replay.record()', { label: `the recording of ${name} to start` })
	await ctx.js('return globalThis.ctrDev.bot(true)')
	const t0 = Date.now()
	let beat = t0 + HEARTBEAT_MS
	for (;;) {
		const at = await ctx.js('return { finished: !!window.__ctr?.kart?.finished, frame: globalThis.__ctrReplay?.frame ?? 0, lap: window.__ctr?.kart?.lap }')
		if (at.finished || at.frame >= maxFrames) break
		if (Date.now() > t0 + timeout) throw new Error(`recording ${name} : P1 not finished after ${timeout / 1000} s (${JSON.stringify(at)})`)
		if (Date.now() >= beat) {
			say(`recording ${name} : replay frame ${at.frame}, lap ${at.lap}`)
			beat += HEARTBEAT_MS
		}
		await sleep(500)
	}
	await ctx.js('return globalThis.ctrDev.bot(false)')
	const r = await inPage(ctx, 'globalThis.ctrDev.replay.stop()', { label: `the recording of ${name} to stop` })
	const files = {}
	for (const rel in r.files) files[rel] = await pullBytes(ctx, `globalThis.__ctrReplayFiles[${JSON.stringify(rel)}]`, r.files[rel])
	const what = {
		name, race, frames: r.frames, files: r.files, build: await ctx.js("return (await fetch('/__build')).text()"),
		version: execSync('git describe --tags --dirty', { cwd: HERE }).toString().trim(),
		recorded: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
	}
	writeFolder(join(REPLAYS_DIR, name), { ...files, 'samples.json': `${JSON.stringify(r.samples)}\n`, 'what.json': `${JSON.stringify(what, null, 2)}\n` })
	return { ...what, samples: r.samples.length }
}

/** A replay's what.json and samples.json, as recorded. */
export function replayKept(name) {
	const dir = join(REPLAYS_DIR, name)
	if (!existsSync(join(dir, 'what.json'))) throw new Error(`no replay « ${name} » in ${dir} (recordRace makes it)`)
	return { what: JSON.parse(readFileSync(join(dir, 'what.json'), 'utf8')), samples: JSON.parse(readFileSync(join(dir, 'samples.json'), 'utf8')) }
}

/** Where two lists of samples first differ : null, or { frame, field, recorded, played }. */
export function samplesDiffer(recorded, played) {
	const n = Math.max(recorded.length, played.length)
	for (let i = 0; i < n; i++) {
		const a = recorded[i]
		const b = played[i]
		if (!a || !b) return { frame: (a ?? b).frame, field: a ? 'missing in the playback' : 'beyond the recording', recorded: a ?? null, played: b ?? null }
		for (const field of ['frame', 'level', 'raceTime', 'rng', 'karts']) {
			if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) return { frame: a.frame, field, recorded: a[field], played: b[field] }
		}
	}
	return null
}

/**
 * Plays replay `name` (upstream's playback, from its first checkpoint) and compares it with the
 * recording : upstream's per-frame check (its log's divergence lines) and the samples. rebase : the
 * start made again on this build (the same direct start and seed, a one-frame recording for its
 * checkpoint), the old pads played from it — a recording from another build (an upstream merge),
 * whose checkpoint this build's memory layout cannot load. Returns { divergence, differ, frames, of }.
 */
export async function playRace(ctx, name, { rebase = false, timeout = 600_000 } = {}) {
	const { what, samples } = replayKept(name)
	let play = JSON.stringify(name)
	await open(ctx, rebase ? `${seededQuery(what.race)}&turbo=1` : '?turbo=1')
	const build = await ctx.js("return (await fetch('/__build')).text()")
	if (rebase) {
		await inPage(ctx, 'globalThis.ctrDev.replay.record()', { label: 'the start made again' })
		await inPage(ctx, 'globalThis.ctrDev.replay.stop()', { label: 'its checkpoint' })
		// this build's start (state.ctrstates, memcard.seed/), the recording's pads (input.ctrreplay)
		await inPage(ctx, `globalThis.ctrDev.replay.fetch(${JSON.stringify(name)}).then((kept) => { globalThis.__ctrRebased = { ...globalThis.__ctrReplayFiles, 'input.ctrreplay': kept['input.ctrreplay'] }; return true })`, { label: 'the recording\'s pads' })
		play = 'globalThis.__ctrRebased'
	}
	const r = await inPage(ctx, `globalThis.ctrDev.replay.play(${play}, { bypass: ${rebase || what.build !== build}, timeout: ${timeout} })`, { label: `the playback of ${name}`, timeout })
	const differ = samplesDiffer(samples, r.samples)
	return { ...r, differ, recorded: samples.length, played: r.samples.length }
}

/** The card as the game holds it (__ctr.card : its screen, version, ghosts, profiles). */
export const card = ctx => ctx.js('return window.__ctr?.card ?? null')

/** Boots for real in turbo on card `name` (?card=, 'new' : empty) to the main menu, turbo off after. */
export async function bootOnCard(ctx, name, query = '') {
	await open(ctx, `?turbo=1&card=${encodeURIComponent(name)}${query}`)
	const put = await ctx.js('return globalThis.__ctrCardPut ?? null')
	if (put?.error) throw new Error(`card ${name} : ${put.error}`)
	const s = await bootToMenu(ctx)
	await turbo(ctx, false)
	return s
}

/** Pulls the card's files from the page into `dir` (/memcards/slot0, as the game wrote them). */
async function pullCard(ctx) {
	const sizes = await ctx.js('return globalThis.ctrDev.card.files()')
	const files = {}
	for (const file in sizes) files[file] = await pullBytes(ctx, `globalThis.__ctrCardFiles[${JSON.stringify(file)}]`, sizes[file])
	return files
}

/**
 * Makes the named card `name` (saves.mjs SAVES) by the game's own save and keeps it in
 * .saves/<name>/ with what.json (what it holds, how it was made). `done` : the cards made already in
 * this run (a damaged card is another one with a byte changed). Returns what.json.
 */
export async function makeSave(ctx, name, { SAVES }) {
	const def = SAVES[name]
	if (!def) throw new Error(`no card « ${name} » in saves.mjs`)
	let files = {}
	if (def.from) {
		const dir = join(SAVES_DIR, def.from)
		for (const file of readdirSync(dir).filter(f => f !== 'what.json')) files[file] = readFileSync(join(dir, file))
		const profile = files['BASCUS-94426-SLOTS']
		if (!profile) throw new Error(`${name} : « ${def.from} » has no profile to change`)
		profile[def.flip] ^= 0xff
	} else if (def.ghost) {
		await bootOnCard(ctx, 'new')
		await open(ctx, `${raceQuery({ ...def.ghost, mode: 'tt' })}&turbo=1`)
		await ctx.js('globalThis.ctrDev.bot(true); return true')
		await until(ctx, 'the end of the Time Trial', s => s.kart?.finished && s.mode?.includes('END_OF_RACE'), { timeout: 300_000, every: 500 })
		await ctx.js('globalThis.ctrDev.bot(false); return true')
		await inPage(ctx, 'globalThis.ctrDev.card.ghost()', { label: `${name} : the ghost save` })
		files = await pullCard(ctx)
	} else if (def.spec) {
		await bootOnCard(ctx, 'new')
		await inPage(ctx, `globalThis.ctrDev.card.write(${JSON.stringify(def.spec)})`, { label: `${name} : the game's save` })
		files = await pullCard(ctx)
	}
	const what = { name, holds: def.holds, spec: def.spec ?? null, made: def.from ? `from « ${def.from} », byte 0x${def.flip.toString(16)} changed` : def.ghost ? 'a Time Trial and the game\'s ghost save' : def.spec ? "the game's profile save" : 'nothing written', files: Object.fromEntries(Object.entries(files).map(([f, b]) => [f, b.length])), at: new Date().toISOString(), version: execSync('git describe --tags --dirty', { cwd: HERE }).toString().trim() }
	writeFolder(join(SAVES_DIR, name), { ...files, 'what.json': `${JSON.stringify(what, null, 2)}\n` })
	return what
}

/**
 * The user's own saves as a named card : a folder of save files as the web build keeps them (38's
 * format, /memcards/slot0's files), or a PS1 card image / an emulator's (.mcr, .mcd : 128 KB, cut by
 * memcard.mjs). Only CTR's saves are kept. Returns { name, files, others }.
 */
export async function importSave(path, name) {
	const { splitCardImage } = await import('./memcard.mjs')
	let files = {}
	let others = []
	if (statSync(path).isDirectory()) {
		for (const file of readdirSync(path).filter(f => /^BASCUS-94426/.test(f))) files[file] = readFileSync(join(path, file))
	} else {
		;({ files, others } = splitCardImage(readFileSync(path)))
	}
	if (!Object.keys(files).length) throw new Error(`${path} : no save of CTR (BASCUS-94426…)${others.length ? `, only ${others.join(', ')}` : ''}`)
	const what = { name, holds: `imported from ${path.split('/').pop()}`, made: 'imported', files: Object.fromEntries(Object.entries(files).map(([f, b]) => [f, b.length])), others, at: new Date().toISOString() }
	writeFolder(join(SAVES_DIR, name), { ...Object.fromEntries(Object.entries(files).map(([f, b]) => [f, Buffer.from(b)])), 'what.json': `${JSON.stringify(what, null, 2)}\n` })
	return { name, files: Object.keys(files), others }
}

/** A named card as a PS1 card image (.mcr / .mcd) at `path`, for an emulator. */
export async function exportSave(name, path) {
	const { cardImage } = await import('./memcard.mjs')
	const dir = join(SAVES_DIR, name)
	const files = {}
	for (const file of readdirSync(dir).filter(f => /^BASCUS-94426/.test(f))) files[file] = new Uint8Array(readFileSync(join(dir, file)))
	writeFileSync(path, cardImage(files))
	return path
}

/** The card `name` of saves.mjs, made (makeSave) when it is not kept yet ; returns its what.json. */
export async function ensureSave(ctx, name, { SAVES }) {
	const what = join(SAVES_DIR, name, 'what.json')
	if (existsSync(what)) return JSON.parse(readFileSync(what, 'utf8'))
	if (SAVES[name]?.from) await ensureSave(ctx, SAVES[name].from, { SAVES })
	say(`card ${name} : not kept yet — making it`)
	return makeSave(ctx, name, { SAVES })
}

/** P1–P4 as the page holds them : 'pad', 'kb', 'kb2' ('kb+kb2' : both halves), '-' for nobody. */
export const seats = ctx => ctx.js(`return (globalThis.ctrUI?.players?.slots ?? []).map(s => [s.pad ? 'pad' : '', s.keyboard ? 'kb' : '', s.keyboard2 ? 'kb2' : ''].filter(Boolean).join('+') || '-')`)

/**
 * The players of a test : `pads` virtual pads plugged in (the harness's, as real ones arrive : the
 * first seats), then the page's swaps (Settings › Players) until the seats read `want` — e.g.
 * ['pad', 'kb', 'pad', 'pad'] : the keyboard on P2. Returns the seats.
 */
export async function players(ctx, { pads = 0, want = null } = {}) {
	for (let i = 0; i < pads; i++) {
		await ctx.pad(i).connect()
		await sleep(300)
	}
	const deadline = Date.now() + 5000
	let now = await seats(ctx)
	while (now.filter(s => s.includes('pad')).length < pads && Date.now() < deadline) {
		await sleep(150)
		now = await seats(ctx)
	}
	if (!want) return now
	for (let i = 0; i < 4; i++) {
		if (now[i] === want[i]) continue
		const j = now.findIndex((s, k) => k > i && s === want[i])
		if (j < 0) throw new Error(`no seat to bring ${want[i]} to P${i + 1} (seats ${now.join(' ')})`)
		await ctx.js(`globalThis.ctrUI.players.swap(${i}, ${j}); return true`)
		const end = Date.now() + 5000
		const before = now.join()
		while ((now = await seats(ctx)).join() === before && Date.now() < end) await sleep(150)
	}
	if (now.join() !== want.join()) throw new Error(`seats ${now.join(' ')}, not ${want.join(' ')}`)
	return now
}

/** A phone : the viewport (CSS px), its pixel ratio, a mobile browser's user agent, touch. */
export const PHONE = { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }

/**
 * The page seen as on a phone (Emulation : its viewport, a mobile user agent, touch events), until
 * `phone(ctx, null)`. Landscape by default (the game's way) ; { portrait: true } turns it.
 */
export async function phone(ctx, opts = {}) {
	const send = (m, p) => ctx.conn.send(m, p, ctx.sid)
	if (opts === null) {
		await send('Emulation.clearDeviceMetricsOverride', {})
		await send('Emulation.setTouchEmulationEnabled', { enabled: false })
		await send('Emulation.setUserAgentOverride', { userAgent: '' })
		return null
	}
	const p = { ...PHONE, ...opts }
	const [width, height] = p.portrait ? [p.height, p.width] : [p.width, p.height]
	await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: p.deviceScaleFactor, mobile: p.mobile, screenOrientation: p.portrait ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 } })
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
	await send('Emulation.setUserAgentOverride', { userAgent: p.userAgent, platform: 'Android' })
	return { width, height }
}

/** A finger's tap at (x, y) CSS px (touchstart, then touchend 80 ms later). */
export async function tap(ctx, x, y) {
	const send = (type, touchPoints) => ctx.conn.send('Input.dispatchTouchEvent', { type, touchPoints }, ctx.sid)
	await send('touchStart', [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }])
	await sleep(80)
	await send('touchEnd', [])
}

/** An iPhone mini in landscape (the user's : 812 × 375 CSS px, DPR 3, Safari's user agent). */
export const IPHONE_MINI = { width: 812, height: 375, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1' }

/**
 * Several fingers on the touch screen at once (CDP Input.dispatchTouchEvent : touchStart and
 * touchMove carry every finger down ; touchEnd carries the fingers it lifts — measured : a finger
 * missing from a touchMove stays down, and an empty touchEnd lifts them all). down / move / up by a
 * finger's id ; `on(id, control)` puts it on the centre of a touch control of the page
 * (#ctr-touch [data-id=…], TouchPad.svelte), `off(id)` lifts it, `all()` lifts every finger.
 */
export function fingers(ctx) {
	const points = {}
	const send = (type) => {
		const touchPoints = []
		for (const id in points) touchPoints.push({ x: points[id].x, y: points[id].y, id: Number(id), radiusX: 8, radiusY: 8, force: 1 })
		return ctx.conn.send('Input.dispatchTouchEvent', { type, touchPoints }, ctx.sid)
	}
	const self = {
		points,
		async down(id, x, y) { points[id] = { x, y }; await send('touchStart') },
		async move(id, x, y) { points[id] = { x, y }; await send('touchMove') },
		async up(id) {
			const p = points[id]
			if (!p) return
			delete points[id]
			await ctx.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: Number(id), radiusX: 8, radiusY: 8, force: 1 }] }, ctx.sid)
		},
		async all() {
			if (!Object.keys(points).length) return
			for (const id in points) delete points[id]
			await send('touchEnd')
		},
		/** a touch control's box (CSS px), or null when it is not drawn */
		rect: (control) => ctx.js(`const e = document.querySelector('#ctr-touch [data-id="${control}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }`),
		async on(id, control, { dx = 0, dy = 0 } = {}) {
			const r = await self.rect(control)
			if (!r) throw new Error(`no touch control « ${control} » on the screen`)
			if (points[id]) await self.move(id, r.cx + dx, r.cy + dy)
			else await self.down(id, r.cx + dx, r.cy + dy)
			return r
		},
		off: (id) => self.up(id),
	}
	return self
}

/** The touch controls as drawn : { kind, hold, ids } or null (TouchPad.svelte). */
export const touchState = ctx => ctx.js("const t = document.getElementById('ctr-touch'); return t ? { kind: t.dataset.kind, hold: t.dataset.hold, ids: [...t.querySelectorAll('[data-id]')].map(e => e.dataset.id), on: [...t.querySelectorAll('.on')].map(e => e.dataset.id) } : null")
