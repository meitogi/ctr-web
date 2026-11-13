// Shared helpers for the CTR player suites (*.suite.mjs beside this file).
// No top-level side effects : a bare `node --test` imports this harmlessly.
//
// Game state comes from window.__ctr (platform/web_debug_bridge.c, debug web
// builds only), never from pixels.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as autopilot from '../../ui/src/lib/autopilot.js'
import { MAIN_MENU, onMainMenu, menuTo as autoMenuTo } from '../../ui/src/lib/autopilot.js'

// The suites' page options. pressFrames : a press must outlast one game frame
// (30 fps) on any display — 8 rAF = 67 ms at 120 Hz, 133 ms at 60 Hz.
export const PLAYER = { gamepad: true, pressFrames: 8 }

// MAIN_MENU (the main menu's rows) and onMainMenu : web/ui/src/lib/autopilot.js's, shared with the page
export { MAIN_MENU, onMainMenu }

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
		label,
		rows: MAIN_MENU,
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
