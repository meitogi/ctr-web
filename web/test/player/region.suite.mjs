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

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAYER, say, state } from './ctr.mjs'
import { waitIn } from './share.suite.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = {
	'REGION-PAL-BOOT': ['boot', 'audio', 'page'],
	'REGION-LANG-SWITCH': ['boot', 'page'],
	'REGION-US-ONLY': ['boot', 'page'],
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

/** Reloads with `language` (or automatic) and auto start on, and waits for the game's disc state. */
async function bootWith(ctx, language) {
	await ctx.js(`localStorage.setItem('ctr-ui.auto-start', '1'); ${language ? `localStorage.setItem('ctr-ui.game-language', '${language}')` : "localStorage.removeItem('ctr-ui.game-language')"}; return true`)
	await ctx.reload()
	return waitIn(ctx.js, 'the game reading its disc', 'window.__ctr?.disc?.lng?.[3] ? window.__ctr.disc : null', 120_000)
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

async function ensurePal(ctx) {
	if ((await opfs(ctx)).includes('ctr-pal.bin')) return
	const res = await ctx.js("return (await fetch(location.origin + '/ctr-pal.bin', { method: 'HEAD' })).ok")
	if (!res) ctx.skip('no PAL image beside the build (assets/ctr-pal.bin, linked by web/dev.sh build)')
	say('storing the PAL disc in this browser (740 MB, once per origin)')
	await ctx.js("localStorage.setItem('ctr-ui.auto-start', '0'); return true")
	await ctx.reload()
	await waitIn(ctx.js, 'the boot screen', "!!document.getElementById('press-start') || !!document.getElementById('drop-zone')", 60_000)
	await ctx.js("void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-pal.bin'); return true")
	await waitIn(ctx.js, 'the PAL disc stored', "(async () => { const r = await navigator.storage.getDirectory(); for await (const k of r.keys()) if (k === 'ctr-pal.bin') return !!window.__ctr; return null })()", 900_000, 2000)
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
}
