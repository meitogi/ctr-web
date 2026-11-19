// Player suite : the disc the player drops, US or PAL, and the game's language
// (platform/web_disc_view.c, web/ui/src/lib/language.js).
//   REGION-PAL-BOOT    : the PAL disc stored beside the US one, French chosen : the game boots on
//     the PAL disc (__ctr.disc.region), its voice line at boot is read from XA/FRN and sounds, the
//     loaded text is the French LNG in US order (string 560 lies past PAL's inserted strings),
//     and the main menu is reached.
//   REGION-LANG-SWITCH : Settings › System › Language → Deutsch while the game runs : the page asks
//     for a restart, « Restart now » reloads into German text and XA/GRM voices.
//   REGION-US-ONLY     : the PAL disc removed, language automatic : the US disc as it always was —
//     English, XA/ENG, the US text — to the main menu.
//   The PAL disc's shared 2D band (fonts, HUD icons, the racers' CLUTs), moved by web_disc_view.c
//   onto the US band's rows — screenshots compared, not only state (the bug drew solid boxes
//   while __ctr read right). The PAL disc in English (the page's debug ?disc=pal) against the
//   US disc (?disc=us) : same strings, same glyphs.
//   REGION-PAL-2D-MENU : the main menu's text, PAL vs US : glyph outlines where the US has them,
//     not solid blocks ; the band relocated, no patch refused ; a French shot to look at.
//   REGION-PAL-2D-HUD  : an arcade race, both discs held on the same seeded frame : the HUD
//     (time, lap, Wumpa count, the racers' icons, the position) PAL vs US.
//   REGION-PAL-2D-RELOAD : PAL menu, a race (the loading screen), the pause menu's QUIT,
//     the loading screen, the menu again : its text as before the race.
//   Shots in .tmp/shots/ (gitignored).
//
// The expected strings come from the player's own extraction when it is there
// (tools/extract : assets/extract/{us,pal}/lng, assets/extract/pal-diff.json) ; without it the
// text check is skipped and said so. No game data in this file.
//
// RUN
//   Build : web/dev.sh build debug — it links assets/ctr-u.bin and, when kept there (gitignored),
//           assets/ctr-pal.bin into build-web-debug/ : the page's test hook fetches them from the
//           server. No PAL image : the suite skips.
//   Serve : python3 web/test/player/serve.py build-web-debug 8091
//   Play  : CTR_PLAY='node <visual-loop>/scripts/e2e.mjs --suite web/test/player/{suite}.suite.mjs --url http://localhost:8091/index.html'
// Not a node --test file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { PLAYER, inPage, open, say, state, until } from './ctr.mjs'
import { waitIn } from './share.suite.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = {
	'REGION-PAL-BOOT': ['boot', 'audio', 'page'],
	'REGION-LANG-SWITCH': ['boot', 'page'],
	'REGION-US-ONLY': ['boot', 'page'],
	'REGION-PAL-2D-MENU': ['boot', 'render'],
	'REGION-PAL-2D-HUD': ['race', 'render'],
	'REGION-PAL-2D-RELOAD': ['boot', 'race', 'render'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const EXTRACT = join(REPO, 'assets', 'extract')
const SLOTS = { en: 'en', fr: 'fr', de: 'de', it: 'it', es: 'es', nl: 'ne' }
const XA = { en: 'ENG', fr: 'FRN', de: 'GRM', it: 'ITL', es: 'SPN', nl: 'DCH' }

/** What string `id` reads as on `region`'s disc in `language` : from the extraction, or null. */
function expected(region, language, id) {
	const lng = join(EXTRACT, region, 'lng', `${SLOTS[language]}.json`)
	const map = join(EXTRACT, 'pal-diff.json')
	if (!existsSync(lng) || (region === 'pal' && !existsSync(map))) return null
	const strings = JSON.parse(readFileSync(lng, 'utf8')).strings
	const at = region === 'pal' ? JSON.parse(readFileSync(map, 'utf8')).lng_id_map_us_to_pal[id] : id
	// the JSON spells the EU codes as what they drew ; the game gets the US glyphs (web_disc_view.c)
	return strings[at].replace(/[¡¿]/g, '').replace(/º/g, '.').replace(/"/g, "'").replace(/Ñ/g, 'N').replace(/ñ/g, 'n').replace(/\n/g, '\r')
}

/** The loudest sample of the game's output over `ms` (an AnalyserNode on ctrAudio.output), or null. */
const peak = (ctx, ms) =>
	ctx.js(`const A = globalThis.ctrAudio
	if (!A?.output) return null
	const an = A.context.createAnalyser()
	an.fftSize = 2048
	A.output.connect(an)
	const buf = new Float32Array(an.fftSize)
	let max = 0
	const end = performance.now() + ${ms}
	while (performance.now() < end) {
		an.getFloatTimeDomainData(buf)
		for (const v of buf) max = Math.max(max, Math.abs(v))
		await new Promise(r => setTimeout(r, 40))
	}
	A.output.disconnect(an)
	return { max, state: A.context.state }`)

/** A click on the game : the gesture the page's sound waits for (as ctr.mjs open() gives it). */
async function gesture(ctx) {
	const at = await ctx.js("const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }")
	for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, ctx.sid)
}

// The main menu in any language : ctr.mjs bootToMenu knows it by its English rows (autopilot.js
// MAIN_MENU), so here by the level, the mode and the untitled menu taking input.
const onMenu = s => s?.screen === 'menu' && s.levelID === 39 && !!s.menu?.input && s.menu.title === '' && /MAIN_MENU/.test(String(s.mode ?? '')) && !/ADVENTURE_MODE/.test(String(s.mode ?? ''))

/** Skips the intro (Cross, Triangle out of a press that opened Adventure) to the main menu. */
async function toMenu(ctx) {
	const end = Date.now() + 180_000
	let s = await state(ctx)
	while (!onMenu(s)) {
		if (Date.now() > end) throw new Error(`no main menu after 3 min (${JSON.stringify(s?.menu)} ${s?.mode})`)
		await ctx.press(s?.menu?.input && s.menu.title !== '' ? 'z' : 'c')
		await sleep(400)
		s = await state(ctx)
	}
	return s
}

const disc = ctx => ctx.js('return window.__ctr?.disc ?? null')
const opfs = ctx => ctx.js("const r = await navigator.storage.getDirectory(); const out = []; for await (const k of r.keys()) out.push(k); return out")

/** Reloads with `language` (or automatic) and auto start on, and waits for the game's disc state.
 *  `disc` : 'us' / 'pal' reads that kept disc alone (the page's debug ?disc=). */
async function bootWith(ctx, language, which = null) {
	await ctx.js(`localStorage.setItem('ctr-ui.auto-start', '1'); ${language ? `localStorage.setItem('ctr-ui.game-language', '${language}')` : "localStorage.removeItem('ctr-ui.game-language')"}; return true`)
	const base = await ctx.js('return location.origin + location.pathname')
	await ctx.conn.send('Page.navigate', { url: base + (which ? `?disc=${which}` : '') }, ctx.sid)
	await sleep(500)
	return waitIn(ctx.js, 'the game reading its disc', 'window.__ctr?.disc?.lng?.[3] ? window.__ctr.disc : null', 180_000)
}

/** The text and voices of `d` are `region`'s in `language`. */
function check(d, region, language) {
	if (d.region !== region || d.language !== language) throw new Error(`the game reads ${JSON.stringify(d)}, not the ${region} disc in ${language}`)
	const notes = []
	for (const id of [3, 560]) {
		const want = expected(region, language, id)
		if (want === null) { notes.push('text not checked (no extraction)'); break }
		if (d.lng[id] !== want) throw new Error(`string ${id} reads « ${d.lng[id]} », not « ${want} »`)
	}
	return notes
}

/** The `region` disc stored in this browser : from the server (web/dev.sh build links the images
 *  beside the build) when it is not ; skips without it. */
/** Runs `fn` and puts the page's game language back as it was : a French game left behind
 *  breaks the next suites' menu walks (they know the menus by their English labels). */
async function keepLanguage(ctx, fn) {
	const before = await ctx.js("return localStorage.getItem('ctr-ui.game-language')")
	try {
		return await fn()
	} finally {
		await ctx.js(`${before === null ? "localStorage.removeItem('ctr-ui.game-language')" : `localStorage.setItem('ctr-ui.game-language', ${JSON.stringify(before)})`}; return true`)
	}
}

async function ensureDisc(ctx, region) {
	const name = region === 'us' ? 'ctr-u.bin' : 'ctr-pal.bin'
	if ((await opfs(ctx)).includes(name)) return
	const res = await ctx.js(`return (await fetch(location.origin + '/${name}', { method: 'HEAD' })).ok`)
	if (!res) ctx.skip(`no ${region.toUpperCase()} image beside the build (assets/${name}, linked by web/dev.sh build)`)
	say(`storing the ${region.toUpperCase()} disc in this browser (~740 MB, once per origin)`)
	await ctx.js("localStorage.setItem('ctr-ui.auto-start', '0'); return true")
	await ctx.reload()
	await waitIn(ctx.js, 'the boot screen', "!!document.getElementById('press-start') || !!document.getElementById('drop-zone')", 60_000)
	await ctx.js(`void window.__ctrTestHandleFileFromUrl(location.origin + '/${name}'); return true`)
	// stored : the whole file in OPFS, and the page past its « preparing » (the game started, or the boot screen's press)
	await waitIn(ctx.js, `the ${region.toUpperCase()} disc stored`, `(async () => {
		const want = Number((await fetch(location.origin + '/${name}', { method: 'HEAD' })).headers.get('content-length'))
		const r = await navigator.storage.getDirectory()
		const h = await r.getFileHandle('${name}').catch(() => null)
		const size = h ? (await h.getFile()).size : 0
		return size === want && (!!window.__ctr || !!document.getElementById('press-start')) ? size : null
	})()`, 1_800_000, 5000)
}

const ensurePal = ctx => ensureDisc(ctx, 'pal')

// ---- the shared 2D band : screenshots ----

const SHOTS = join(REPO, '.tmp', 'shots')

/** An 8-bit RGB / RGBA PNG (what Page.captureScreenshot writes) : { w, h, px } in RGBA. */
function png(buf) {
	const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], type = buf[25]
	if (depth !== 8 || (type !== 2 && type !== 6) || buf[28] !== 0) throw new Error(`PNG ${depth}-bit type ${type} interlace ${buf[28]} : not read here`)
	const chunks = []
	for (let at = 8; at < buf.length;) {
		const len = buf.readUInt32BE(at), tag = buf.toString('latin1', at + 4, at + 8)
		if (tag === 'IDAT') chunks.push(buf.subarray(at + 8, at + 8 + len))
		at += 12 + len
	}
	const raw = inflateSync(Buffer.concat(chunks)), bpp = type === 6 ? 4 : 3, stride = w * bpp
	const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride), px = new Uint8Array(w * h * 4)
	for (let y = 0; y < h; y++) {
		const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
			const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
			cur[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255
		}
		for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[(y * w + x) * 4 + k] = k < bpp ? cur[x * bpp + k] : 255
		cur.copy(prev)
	}
	return { w, h, px }
}

/** The page captured from the compositor (the default capture is grey on the agent browser),
 *  written to .tmp/shots/<name>.png ; with the game canvas's rect in the shot's pixels. */
async function capture(ctx, name) {
	const { data } = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, ctx.sid)
	const buf = Buffer.from(data, 'base64')
	mkdirSync(SHOTS, { recursive: true })
	const file = join(SHOTS, `${name}.png`)
	writeFileSync(file, buf)
	const r = await ctx.js("const r = document.getElementById('canvas').getBoundingClientRect(), d = devicePixelRatio; return { x: r.x * d, y: r.y * d, w: r.width * d, h: r.height * d }")
	return { file, img: png(buf), canvas: r }
}

/** Strong luminance edges (glyph outlines) of a shot inside `box` (fractions of the canvas) : a
 *  mask on a grid of the box's pixels, with its size. */
function edges(shot, box) {
	const { img: { w, px }, canvas: c } = shot
	const x0 = Math.round(c.x + box[0] * c.w), y0 = Math.round(c.y + box[1] * c.h)
	const bw = Math.round((box[2] - box[0]) * c.w), bh = Math.round((box[3] - box[1]) * c.h)
	const lum = (x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] }
	const mask = new Uint8Array(bw * bh)
	for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
		const l = lum(x0 + x, y0 + y)
		mask[y * bw + x] = Math.abs(lum(x0 + x + 1, y0 + y) - l) + Math.abs(lum(x0 + x, y0 + y + 1) - l) > 120 ? 1 : 0
	}
	return { mask, w: bw, h: bh }
}

/** How much of `a`'s edges `b` has (within one pixel) and the reverse, and each one's density :
 *  the same glyphs give both coverages near 1 ; solid boxes have few edges, none inside. */
function compareEdges(a, b) {
	const near = (m, i) => {
		const x = i % m.w, y = (i / m.w) | 0
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const X = x + dx, Y = y + dy
			if (X >= 0 && Y >= 0 && X < m.w && Y < m.h && m.mask[Y * m.w + X]) return true
		}
		return false
	}
	const cover = (p, q) => { let n = 0, hit = 0; for (let i = 0; i < p.mask.length; i++) if (p.mask[i]) { n++; if (near(q, i)) hit++ } return n ? hit / n : 0 }
	const density = m => m.mask.reduce((s, v) => s + v, 0) / m.mask.length
	return { aInB: cover(a, b), bInA: cover(b, a), densityA: density(a), densityB: density(b) }
}

const fmt = r => `PAL edges in US ${(r.aInB * 100).toFixed(0)} %, US in PAL ${(r.bInA * 100).toFixed(0)} %, density PAL ${(r.densityA * 100).toFixed(1)} % / US ${(r.densityB * 100).toFixed(1)} %`

/** The main menu's rows under the first (fractions of the canvas) : the first row's highlight
 *  pulses in colour, so it is left out. */
const MENU_TEXT = [0.56, 0.31, 0.95, 0.78]

/** The band state of a PAL boot : relocated, no patch refused. */
function bandOk(d) {
	if (d.region !== 'pal') throw new Error(`the PAL disc was not read : ${JSON.stringify(d)}`)
	if (!d.band?.relocated || d.band.refused !== 0 || !(d.band.applied > 0)) throw new Error(`the band : ${JSON.stringify(d.band)}`)
	return `band relocated, ${d.band.applied} patch applications`
}

/** Boots `language` (auto start) to the main menu, settles, captures it. */
async function menuShot(ctx, language, name, which = null) {
	await bootWith(ctx, language, which)
	await gesture(ctx)
	await toMenu(ctx)
	await sleep(2500) // the menu's slide-in
	return { d: await disc(ctx), shot: await capture(ctx, name) }
}

const SEEDED_RACE = '?race=crash-cove&char=crash&mode=arcade&seed=1'
const HUD_FRAME = 400

/** A seeded arcade race on `language`'s disc, held on race frame HUD_FRAME, captured. */
async function hudShot(ctx, language, name, which = null) {
	await ctx.js(`localStorage.setItem('ctr-ui.game-language', '${language}'); return true`)
	await open(ctx, SEEDED_RACE + (which ? `&disc=${which}` : ''))
	await inPage(ctx, `globalThis.ctrDev.pauseAt(${HUD_FRAME})`)
	await sleep(500)
	const shot = await capture(ctx, name)
	const d = await disc(ctx)
	await inPage(ctx, 'globalThis.ctrDev.resume()')
	return { d, shot }
}

// The HUD's places (fractions of the canvas, from the 1P arcade HUD) : the time, the lap, the
// Wumpa count, the racers' icons, the position.
const HUD_BOXES = {
	time: [0.03, 0.02, 0.27, 0.17], lap: [0.83, 0.02, 0.96, 0.17], wumpa: [0.57, 0.03, 0.73, 0.17],
	icons: [0.03, 0.25, 0.14, 0.77], position: [0.03, 0.75, 0.22, 0.99],
}

/** Quits a race through the pause menu's « QUIT », « YES » (an English game), back to the main menu. */
async function quitRace(ctx) {
	await ctx.press('Enter') // Start
	let s = await until(ctx, 'the pause menu', s => !!s.menu?.input, { timeout: 10_000 })
	for (let i = 0; i < 8 && !/^QUIT/.test(s.menu.label ?? ''); i++) {
		await ctx.press('ArrowDown')
		await ctx.frames(8)
		s = await state(ctx)
	}
	if (!/^QUIT/.test(s.menu.label ?? '')) throw new Error(`no QUIT row in the pause menu (${JSON.stringify(s.menu)})`)
	await ctx.press('c')
	// « QUIT » asks : YES / NO, on NO
	s = await until(ctx, 'the QUIT question', s => s.menu?.title === 'QUIT' && !!s.menu.input, { timeout: 10_000 })
	for (let i = 0; i < 4 && s.menu.label !== 'YES'; i++) {
		await ctx.press('ArrowUp')
		await ctx.frames(8)
		s = await state(ctx)
	}
	if (s.menu.label !== 'YES') throw new Error(`no YES under QUIT (${JSON.stringify(s.menu)})`)
	await ctx.press('c')
	await until(ctx, 'the race left', s => !/PAUSE/.test(String(s.mode)), { timeout: 30_000 })
	return toMenu(ctx)
}

export default async ctx => {
	await ctx.scenario('REGION-PAL-BOOT', async () => {
		await ensurePal(ctx)
		await bootWith(ctx, 'fr')
		await gesture(ctx)
		// the boot's voice line (MainMain.c, EXTRA 0x50) : read from the French files, and sounding
		const voice = await waitIn(ctx.js, 'a French XA file read', "/^XA\\/FRN\\//.test(window.__ctr?.disc?.xa ?? '') ? window.__ctr.disc.xa : null", 60_000)
		const level = await peak(ctx, 2500)
		const notes = check(await disc(ctx), 'pal', 'fr')
		if (!level || !(level.max > 0.01)) throw new Error(`no sound while ${voice} plays : ${JSON.stringify(level)}`)
		await toMenu(ctx)
		return `PAL disc, fr : voice from ${voice}, peak ${level.max.toFixed(3)} · text in US order${notes.length ? ` (${notes.join(', ')})` : ''} · main menu · discs kept ${(await opfs(ctx)).join(', ')}`
	})

	await ctx.scenario('REGION-LANG-SWITCH', async () => {
		await ensurePal(ctx)
		await bootWith(ctx, 'fr')
		await toMenu(ctx)
		await ctx.press('Escape')
		await waitIn(ctx.js, 'Settings', "!!document.getElementById('ctr-settings')", 5000)
		await waitIn(ctx.js, 'the language choice', "(document.querySelector('#ctr-settings [data-tab=system]')?.click(), !!document.getElementById('ctr-game-language'))", 5000)
		await ctx.js("document.querySelector('#ctr-game-language [data-lang=de]').click(); return true")
		const asked = await waitIn(ctx.js, 'the restart question', "document.getElementById('ctr-confirm')?.querySelector('p')?.textContent ?? null", 3000)
		await ctx.js("document.querySelector('#ctr-confirm .btn.primary').click(); return true")
		const d = await waitIn(ctx.js, 'the game in German', "window.__ctr?.disc?.language === 'de' && window.__ctr.disc.lng?.[3] ? window.__ctr.disc : null", 120_000)
		const notes = check(d, 'pal', 'de')
		const voice = await waitIn(ctx.js, 'a German XA file read', "/^XA\\/GRM\\//.test(window.__ctr?.disc?.xa ?? '') ? window.__ctr.disc.xa : null", 60_000)
		return `asked « ${asked} » · restarted : de, voice from ${voice}${notes.length ? ` (${notes.join(', ')})` : ''}`
	})

	await ctx.scenario('REGION-US-ONLY', async () => {
		await ctx.js("const r = await navigator.storage.getDirectory(); await r.removeEntry('ctr-pal.bin').catch(() => {}); return true")
		if (!(await opfs(ctx)).includes('ctr-u.bin')) ctx.skip('no US disc stored in this browser (ready.suite.mjs READY-STORE stores it)')
		const d = await bootWith(ctx, null)
		const notes = check(d, 'us', 'en')
		await toMenu(ctx)
		const s = await disc(ctx)
		if (s.xa && !/^XA\/ENG\//.test(s.xa)) throw new Error(`a US boot read ${s.xa}`)
		return `US disc alone : en, voice from ${s.xa}${notes.length ? ` (${notes.join(', ')})` : ''} · main menu`
	})

	await ctx.scenario('REGION-PAL-2D-MENU', () => keepLanguage(ctx, async () => {
		await ensurePal(ctx)
		await ensureDisc(ctx, 'us')
		const pal = await menuShot(ctx, 'en', 'pal-en-menu', 'pal')
		const band = bandOk(pal.d)
		const us = await menuShot(ctx, 'en', 'us-en-menu', 'us')
		if (us.d.region !== 'us') throw new Error(`the US disc was not read : ${JSON.stringify(us.d)}`)
		const r = compareEdges(edges(pal.shot, MENU_TEXT), edges(us.shot, MENU_TEXT))
		const fr = await menuShot(ctx, 'fr', 'pal-fr-menu')
		const rf = compareEdges(edges(fr.shot, MENU_TEXT), edges(us.shot, MENU_TEXT))
		if (r.aInB < 0.8 || r.bInA < 0.8) throw new Error(`the PAL menu text is not the US one : ${fmt(r)} (${pal.shot.file})`)
		if (rf.densityA < 0.5 * rf.densityB) throw new Error(`the French menu has few glyph edges : ${fmt(rf)} (${fr.shot.file})`)
		return `${band} · en : ${fmt(r)} · fr : density ${(rf.densityA * 100).toFixed(1)} % · ${SHOTS}/{pal-en,us-en,pal-fr}-menu.png`
	}))

	await ctx.scenario('REGION-PAL-2D-HUD', () => keepLanguage(ctx, async () => {
		await ensurePal(ctx)
		await ensureDisc(ctx, 'us')
		const pal = await hudShot(ctx, 'en', 'pal-en-hud', 'pal')
		const band = bandOk(pal.d)
		const us = await hudShot(ctx, 'en', 'us-en-hud', 'us')
		const out = []
		for (const [what, box] of Object.entries(HUD_BOXES)) {
			const r = compareEdges(edges(pal.shot, box), edges(us.shot, box))
			out.push(`${what} : ${fmt(r)}`)
			if (r.aInB < 0.75 || r.bInA < 0.75) throw new Error(`the PAL HUD's ${what} is not the US one : ${fmt(r)} (${pal.shot.file})`)
		}
		await hudShot(ctx, 'fr', 'pal-fr-hud')
		return `${band} · race frame ${HUD_FRAME} · ${out.join(' · ')} · ${SHOTS}/{pal-en,us-en,pal-fr}-hud.png`
	}))

	await ctx.scenario('REGION-PAL-2D-RELOAD', () => keepLanguage(ctx, async () => {
		await ensurePal(ctx)
		const before = await menuShot(ctx, 'en', 'pal-en-menu-before', 'pal')
		await open(ctx, SEEDED_RACE + '&disc=pal')
		await until(ctx, 'the race', s => s.raceFrame > 200, { timeout: 120_000 })
		await capture(ctx, 'pal-en-race')
		await quitRace(ctx)
		await sleep(2500)
		const after = await capture(ctx, 'pal-en-menu-after')
		const r = compareEdges(edges(after, MENU_TEXT), edges(before.shot, MENU_TEXT))
		const say2 = fmt(r).replace(/US/g, 'before').replace(/PAL/g, 'after')
		if (r.aInB < 0.8 || r.bInA < 0.8) throw new Error(`the menu after a race is not the menu before : ${say2} (${after.file})`)
		return `${bandOk(await disc(ctx))} · menu after the race vs before : ${say2} · ${SHOTS}/pal-en-menu-{before,after}.png`
	}))
}
