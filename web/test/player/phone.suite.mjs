// Player suite : the page on a phone (session 41), seen from a desktop browser at a phone's size.
//   MEASURE-PANEL  ?measure (web/ui/src/dev/measure.js) on the phone server (serve.py --phone) : the
//                  panel's Start, tapped, boots the race with the Bot driving ; the panel samples it
//                  and Send's report reaches web/test/player/.reports/ with its numbers
//   PHONE-SERVER   serve.py --phone answers 404 on the tests' snapshots, saves and replays
//   AUDIO-BACK     the sound comes back after iOS « interrupts » it (a lock, the Home Screen : measured
//                  on an iPhone, the context stayed `interrupted` for good) — Chrome has no such state :
//                  the context is suspended and reports `interrupted`, and resumes only inside a
//                  gesture (navigator.userActivation), as Safari's ; a finger's tap must bring it back
//   INSTALL        what a phone's Home Screen reads : Chrome's own parse of the manifest (no error, name,
//                  display, orientation, icons), each icon loaded at its size, Safari's tags ; as an
//                  iPhone's Safari in a tab (its user agent, touch), the install bar's iOS words and the
//                  line saying the disc may go ; with a notch's safe areas (Emulation, when Chrome has
//                  it), the speaker / Settings buttons and the version inside them
//
// RUN
//   Build : web/dev.sh build debug ; web/pages/assemble.sh build-web-debug build-web-debug-site
//   Serve : python3 web/test/player/serve.py --phone build-web-debug-site 8092
//   Play  : the player harness (CLAUDE.md § Tests) on phone.suite.mjs, --url http://localhost:8092/index.html
//   The disc must already be stored in that origin's browser storage (any earlier suite on 8092).
// Not a node --test file.

import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAYER, open, phone, shot, tap } from './ctr.mjs'

export const meta = { url: 'http://localhost:8092/index.html', login: false, player: PLAYER }

export const tags = {
	'MEASURE-PANEL': ['page', 'race', 'harness'],
	'PHONE-SERVER': ['harness'],
	'AUDIO-BACK': ['audio', 'page'],
	INSTALL: ['page'],
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const REPORTS = join(dirname(fileURLToPath(import.meta.url)), '.reports')

/** Waits until the panel's text matches `re` ; returns the text. */
async function panel(ctx, re, what, timeout = 60_000) {
	let text = ''
	for (const end = Date.now() + timeout; Date.now() < end; await sleep(500)) {
		text = await ctx.js("return document.getElementById('ctr-measure')?.innerText ?? ''").catch(() => '')
		if (re.test(text)) return text
	}
	throw new Error(`the panel never showed ${what} (it says « ${text.replace(/\s+/g, ' ').slice(0, 160)} »)`)
}

async function tapButton(ctx, label) {
	const at = await ctx.js(`const b = [...document.querySelectorAll('#ctr-measure button')].find((n) => n.textContent === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
	if (!at) throw new Error(`no « ${label} » button on the panel`)
	await tap(ctx, at.x, at.y)
}

export default async ctx => {
	await ctx.scenario('MEASURE-PANEL', async () => {
		await phone(ctx)
		try {
			const base = await ctx.js('return location.origin + location.pathname')
			await ctx.conn.send('Page.navigate', { url: `${base}?measure&mute&race=crash-cove&char=crash&mode=arcade&laps=1` }, ctx.sid)
			await sleep(500)
			await panel(ctx, /Tap Start/, 'its Start step (is the disc stored on this origin ?)')
			mkdirSync(REPORTS, { recursive: true })
			const before = new Set(readdirSync(REPORTS))
			await tapButton(ctx, 'Start')
			await panel(ctx, /Racing \d+ s/, 'the race being measured', 120_000)
			await panel(ctx, /Race measured/, 'the end of the race', 240_000)
			// the small panel (« Less ») still says what Send did : on the iPhone it did not, Send was tapped 4 times
			await tapButton(ctx, 'Less')
			await tapButton(ctx, 'Send')
			const sent = await panel(ctx, /sent as/, 'the report sent', 20_000)
			const name = readdirSync(REPORTS).find(n => !before.has(n))
			if (!name) throw new Error(`the panel says « ${sent.match(/sent as \S+/)?.[0]} », no new file in ${REPORTS}`)
			const r = JSON.parse(readFileSync(join(REPORTS, name), 'utf8'))
			const s = r.race?.summary
			if (!s?.fps || r.samples.length < 20) throw new Error(`report ${name} : ${r.samples.length} samples, summary ${JSON.stringify(s)}`)
			if (!r.audio.first) throw new Error(`report ${name} : no AudioContext seen`)
			if (!r.memory.peak?.wasmHeapMB) throw new Error(`report ${name} : no wasm heap size (${JSON.stringify(r.memory)})`)
			return `${name} : ${s.seconds} s, median ${s.fps.median} fps (p5 ${s.fps.p5}), clock ${s.vblankRate} VBlanks/s, worst gap ${s.worstGapMs} ms, heap ${r.memory.peak.wasmHeapMB} MB, sound ${r.audio.first.state} → ${r.audio.changes.map(c => c.state).join(' → ') || 'no change'}, verdict ${r.race.verdict.runs ? 'runs' : r.race.verdict.reasons.join(' ; ')} · device ${r.device.platform} ${r.device.screen.inner.join('×')}`
		} finally {
			await phone(ctx, null)
		}
	})

	await ctx.scenario('PHONE-SERVER', async () => {
		const got = await ctx.js(`return Promise.all(['/__states/0123456789abcdef/menu.json', '/__saves/full-100/index.json', '/__replays/cc-arcade-seed1/index.json', '/index.html'].map((p) => fetch(p).then((r) => p + ' ' + r.status)))`)
		const want = ['404', '404', '404', '200']
		got.forEach((g, i) => { if (!g.endsWith(want[i])) throw new Error(`${got.join(', ')} : expected ${want.join(', ')}`) })
		return got.join(' · ')
	})

	await ctx.scenario('AUDIO-BACK', async () => {
		await phone(ctx)
		try {
			await open(ctx, '?race=crash-cove&char=crash&mode=tt&mute')
			const state = () => ctx.js('return globalThis.ctrAudio?.context?.state ?? null')
			for (const end = Date.now() + 15_000; (await state()) !== 'running'; await sleep(250)) if (Date.now() > end) throw new Error(`the sound never started (${await state()})`)
			// iOS's interruption, as Chrome can play it — once open()'s click no longer counts as a gesture
			// (a click's activation lasts ~5 s)
			for (const end = Date.now() + 15_000; await ctx.js('return navigator.userActivation.isActive'); await sleep(250)) if (Date.now() > end) throw new Error('the page stays activated')
			await ctx.js(`const c = globalThis.ctrAudio.context
				let fake = 'interrupted'
				const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get
				Object.defineProperty(c, 'state', { configurable: true, get: () => fake ?? real.call(c) })
				const resume = AudioContext.prototype.resume
				c.resume = () => navigator.userActivation.isActive ? (fake = null, resume.call(c)) : Promise.reject(new DOMException('no gesture (test shim)', 'NotAllowedError'))
				return c.suspend().then(() => true)`)
			await sleep(2500)
			const held = await state()
			if (held !== 'interrupted') throw new Error(`the shim did not hold : ${held} before any tap`)
			const at = await ctx.js("const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }")
			await tap(ctx, at.x, at.y)
			for (const end = Date.now() + 3000; (await state()) !== 'running'; await sleep(100)) if (Date.now() > end) throw new Error(`no sound after a tap : the context is still ${await state()}`)
			return 'interrupted for 2.5 s with no gesture, running again after one tap'
		} finally {
			await phone(ctx, null)
		}
	})

	await ctx.scenario('INSTALL', async () => {
		const send = (m, p) => ctx.conn.send(m, p, ctx.sid)
		const base = await ctx.js('return location.origin + location.pathname')
		await send('Page.navigate', { url: base })
		await sleep(1500)
		const m = await send('Page.getAppManifest', {})
		if (m.errors?.length) throw new Error(`the manifest : ${JSON.stringify(m.errors)}`)
		const man = JSON.parse(m.data)
		const want = { name: 'CTR Web', display: 'fullscreen', orientation: 'landscape' }
		for (const k in want) if (man[k] !== want[k]) throw new Error(`manifest ${k} « ${man[k]} », not « ${want[k]} »`)
		const icons = await ctx.js(`return Promise.all([...${JSON.stringify(man.icons.map(i => i.src))}, 'icons/apple-touch-icon.png'].map((src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(src + ' ' + im.naturalWidth); im.onerror = () => ok(src + ' FAILED'); im.src = src })))`)
		const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 }
		for (const line of icons) { const [src, w] = line.split(' '); if (Number(w) !== sizes[src.split('/').pop()]) throw new Error(`icon ${line}`) }
		const tags = await ctx.js(`const q = (s) => document.querySelector(s)?.getAttribute('content') ?? document.querySelector(s)?.getAttribute('href') ?? null
			return { capable: q('meta[name=apple-mobile-web-app-capable]'), bar: q('meta[name=apple-mobile-web-app-status-bar-style]'), title: q('meta[name=apple-mobile-web-app-title]'), touch: q('link[rel=apple-touch-icon]'), viewport: q('meta[name=viewport]') }`)
		if (tags.capable !== 'yes' || tags.title !== 'CTR Web' || !tags.touch || !/viewport-fit=cover/.test(tags.viewport)) throw new Error(`Safari's tags : ${JSON.stringify(tags)}`)
		const guest = await ctx.js(`return fetch('share/manifest.webmanifest').then((r) => r.json()).then((j) => j.name + ' · start_url ' + (j.start_url ?? 'none'))`)

		// an iPhone's Safari in a tab, a notch on the left in landscape
		await phone(ctx, { userAgent: IPHONE })
		let insets = 'not emulated (this Chrome has no Emulation.setSafeAreaInsetsOverride)'
		try { await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } }); insets = 'left 47, right 47, bottom 21' } catch { /* an older Chrome */ }
		try {
			await send('Page.navigate', { url: base })
			let page = null
			for (const end = Date.now() + 30_000; Date.now() < end; await sleep(500)) {
				page = await ctx.js(`const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(innerWidth - b.right), bottom: Math.round(innerHeight - b.bottom), text: e.innerText } }
					return { hint: r('#install-bar'), kept: r('#disc-kept'), version: r('#boot-version'), w: innerWidth }`)
				if (page.hint && page.kept) break
			}
			if (!/Add to Home Screen/.test(page?.hint?.text ?? '') || page.hint.left < 0 || page.hint.right < 0) throw new Error(`no iOS install hint (safe areas ${insets}) : ${JSON.stringify(page)}`)
			if (!/7 days/.test(page?.kept?.text ?? '')) throw new Error(`the disc line does not say it may go : ${JSON.stringify(page?.kept)}`)
			await shot(ctx, 'install-bar-iphone-landscape')
			await phone(ctx, { userAgent: IPHONE, portrait: true, width: 812, height: 375 })
			await sleep(800)
			await shot(ctx, 'install-bar-iphone-portrait')
			if (insets.startsWith('left') && (page.version.right < 47 || page.version.bottom < 21)) throw new Error(`the version sits under the notch / home bar : ${JSON.stringify(page.version)}`)
			return `manifest « ${man.name} » ${man.display} ${man.orientation}, ${man.icons.length} icons · ${icons.join(', ')} · Safari tags ok · guest : ${guest} · as an iPhone : « ${page.hint.text.slice(0, 60)}… », « ${page.kept.text.split('·').pop().trim().slice(0, 50)}… » · safe areas ${insets}, version ${page.version.right} px from the right, ${page.version.bottom} from the bottom`
		} finally {
			try { await send('Emulation.setSafeAreaInsetsOverride', { insets: {} }) } catch { /* none */ }
			await phone(ctx, null)
		}
	})
}
