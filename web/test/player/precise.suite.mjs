// Player suite : the precise start itself (session 45b ; web/ui/src/dev/precise.js, dev/presets.js,
// platform/web_debug_bridge.c, platform/native_platform.c, platform/native_audio.c — debug builds).
//   FRAMES          a race held (ctrDev.pause) : still after 1 s ; step(1) one game frame, step(10) ten
//   SEED-SAME       the same seed twice : the AI karts in the same places 600 frames into the race ;
//                   another seed, other places
//   REPLAY-SAME     a race recorded (upstream's replay, the page's Bot driving) then played : no
//                   divergence in upstream's per-frame check, the karts and generators equal at each
//                   sample (every 300 frames)
//   REPLAY-REBASE   the same recording played from its start made again (what 26b does across a merge)
//   CARD-NEW / CARD-FULL / CARD-PARTIAL / CARD-NTROPY / CARD-GHOST / CARD-OLD / CARD-DAMAGED
//                   a boot on each named card (saves.mjs) : what the game holds after reading it
//   ADV-POINTS      each Adventure card loaded through the game's menus (ADVENTURE › LOAD, profile 1) :
//                   the hub it was saved on, its trophies and keys
//   CARD-IMPORT     « full-100 » as a PS1 card image (.mcr), imported back (ctr.mjs importSave) : the
//                   game reads the same progress
//   PRESETS         each settings preset : read back, the player's own settings untouched
//   PLAYERS-SEATS   three pads and the keyboard, the keyboard on P2
//   FAULT-CARD-FULL the card refuses a save : the game's own « card full »
//   FAULT-DISC-READ the disc's reads fail during a race's load : what the game and the page do (today :
//                   the load freezes, the page says nothing)
//   FAULT-PROBE     the stored disc unreadable at the page's load : the boot screen says so
//   FAULT-STORAGE   the browser refuses to store a disc : the boot screen says so
//   FAULT-RELAY     Share's relay silent : Share says so
//   PHONE-BOOT      a phone (844 × 390, touch) : the game fits, a tap gives the sound, frames go on
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8091 (snapshots, saves, replays)
//   Relay : (cd relay && PORT=8788 node relay.js)
//   Play  : the player harness (CLAUDE.md § Tests) on precise.suite.mjs, --url http://localhost:8091/index.html
//           --set relay=ws://localhost:8788
// Not a node --test file.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	PLAYER, bootOnCard, brief, card, ensureSave, exportSave, importSave, inPage, open, phone, playRace, players,
	recordRace, replayKept, startAt, state, tap, turbo, until,
} from './ctr.mjs'
import { LEVEL, SAVES, rewardsOf } from './saves.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = {
	FRAMES: ['harness', 'race'],
	'SEED-SAME': ['harness', 'race'],
	'REPLAY-SAME': ['harness', 'race'],
	'REPLAY-REBASE': ['harness', 'race'],
	'CARD-NEW': ['harness', 'card'],
	'CARD-FULL': ['harness', 'card', 'unlock'],
	'CARD-PARTIAL': ['harness', 'card', 'unlock'],
	'CARD-NTROPY': ['harness', 'card'],
	'CARD-GHOST': ['harness', 'card', 'race'],
	'CARD-OLD': ['harness', 'card'],
	'CARD-DAMAGED': ['harness', 'card'],
	'ADV-POINTS': ['harness', 'card', 'menu'],
	'CARD-IMPORT': ['harness', 'card'],
	PRESETS: ['harness', 'page'],
	'PLAYERS-SEATS': ['harness', 'input'],
	'FAULT-CARD-FULL': ['harness', 'card'],
	'FAULT-DISC-READ': ['harness', 'boot'],
	'FAULT-PROBE': ['harness', 'page'],
	'FAULT-STORAGE': ['harness', 'page'],
	'FAULT-RELAY': ['harness', 'share'],
	'PHONE-BOOT': ['harness', 'page'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MC_SCREEN = { 0: 'NOCARD', 1: 'UNFORMATTED', 2: 'FORMATTING', 3: 'SAVING', 4: 'LOADING', 5: 'CHECKING', 6: 'ERROR_FULL', 7: 'ERROR_TIMEOUT', 8: 'NULL', 9: 'ERROR_NODATA' }
const short = c => `screen ${MC_SCREEN[c.screen] ?? c.screen}, version ${c.version}, outdated ${c.outdated}, ghosts ${c.ghosts}, N. Tropy beaten on ${c.tropyBeaten}, profiles ${c.profiles.map(p => (p ? `hub ${p.hub}` : '-')).join(' ')}`
const hex = a => `[${a.map(n => `0x${(n >>> 0).toString(16)}`).join(', ')}]`
const REPLAY = 'precise-cc-1lap'
const REPLAY_RACE = { race: 'crash-cove', char: 'crash', mode: 'arcade', laps: 1, seed: 1 }

/** The AI karts `frames` frames into a seeded race nobody drives (turbo, held there). */
async function aiAfter(ctx, seed, frames) {
	await open(ctx, `?race=crash-cove&char=crash&mode=arcade&seed=${seed}&turbo=1`)
	const at = await inPage(ctx, `globalThis.ctrDev.pauseAt(${frames})`)
	return ctx.js(`return { raceFrame: ${at.raceFrame}, karts: window.__ctr.positions }`)
}

/** A boot on card `name` (made first when not kept) : { what, card, state }. */
async function onCard(ctx, name, query = '') {
	const what = await ensureSave(ctx, name, { SAVES })
	const s = await bootOnCard(ctx, name, query)
	// the card is read on the main menu's first frames (RefreshCard) : settled when it says nothing
	await until(ctx, 'the card read', n => n.card?.stage === 0 && n.card.screen !== 4 && n.card.screen !== 5, { timeout: 10_000 })
	await sleep(500)
	return { what, card: await card(ctx), state: { ...s, unlocks: (await state(ctx)).unlocks } }
}

/** ADVENTURE › LOAD › profile 1, by the pad, from the main menu : the hub's first frames. */
async function adventureLoad(ctx) {
	await ctx.pad(0).connect()
	await sleep(500)
	await ctx.pad(0).press('cross')
	await until(ctx, 'NEW / LOAD', s => s.sub?.label === 'NEW', { timeout: 10_000 })
	await ctx.pad(0).press('down')
	await until(ctx, 'LOAD', s => s.sub?.label === 'LOAD', { timeout: 5000 })
	await ctx.pad(0).press('cross')
	await sleep(2500)
	await ctx.pad(0).press('cross')
	return until(ctx, 'the hub', s => s.mode?.includes('ADVENTURE_ARENA') && !s.mode.includes('LOADING') && s.levelID !== 39, { timeout: 60_000, every: 250 })
}

export default async ctx => {
	await ctx.scenario('FRAMES', async () => {
		await open(ctx, '?race=crash-cove&char=crash&mode=tt&turbo=1')
		await until(ctx, 'the countdown', s => s.screen === 'countdown', { timeout: 90_000, every: 100 })
		await turbo(ctx, false)
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000, every: 100 })
		const p = await ctx.js('return globalThis.ctrDev.pause()')
		const a = await state(ctx)
		await sleep(1000)
		const b = await state(ctx)
		if (b.frameCounter !== a.frameCounter) throw new Error(`paused, the game ran ${b.frameCounter - a.frameCounter} frames in 1 s`)
		await ctx.js('return globalThis.ctrDev.step(1)')
		const c = await state(ctx)
		await ctx.js('return globalThis.ctrDev.step(10)')
		const d = await state(ctx)
		await ctx.js('return globalThis.ctrDev.resume()')
		await sleep(500)
		const e = await state(ctx)
		const steps = `step(1) +${c.frameCounter - b.frameCounter} · step(10) +${d.frameCounter - c.frameCounter} · resumed +${e.frameCounter - d.frameCounter} in 0.5 s`
		if (c.frameCounter - b.frameCounter !== 1 || d.frameCounter - c.frameCounter !== 10) throw new Error(steps)
		if (e.frameCounter - d.frameCounter < 5) throw new Error(`not running after resume : ${steps}`)
		return `held at ${p.frameCounter}, still after 1 s · ${steps} · ${brief(e)}`
	})

	await ctx.scenario('SEED-SAME', async () => {
		const a = await aiAfter(ctx, 7, 600)
		const b = await aiAfter(ctx, 7, 600)
		const c = await aiAfter(ctx, 8, 600)
		const line = `seed 7 twice : ${JSON.stringify(a.karts.slice(1, 3))} / ${JSON.stringify(b.karts.slice(1, 3))} · seed 8 : ${JSON.stringify(c.karts.slice(1, 3))}`
		if (JSON.stringify(a.karts) !== JSON.stringify(b.karts)) throw new Error(`the same seed, another race : ${line}`)
		if (JSON.stringify(a.karts) === JSON.stringify(c.karts)) throw new Error(`another seed, the same race : ${line}`)
		return line
	})

	await ctx.scenario('REPLAY-SAME', async () => {
		const rec = await recordRace(ctx, REPLAY, REPLAY_RACE)
		const r = await playRace(ctx, REPLAY)
		const line = `recorded ${rec.frames} frames (${rec.seconds} s), ${rec.samples} samples · played ${r.frames}/${r.of} : ${r.state}`
		if (r.divergence) throw new Error(`${line} · upstream : ${r.divergence.join(' | ')}`)
		if (r.differ) throw new Error(`${line} · samples differ : ${JSON.stringify(r.differ)}`)
		return `${line}, no divergence, samples equal`
	})

	await ctx.scenario('REPLAY-REBASE', async () => {
		try {
			replayKept(REPLAY)
		} catch {
			await recordRace(ctx, REPLAY, REPLAY_RACE)
		}
		const r = await playRace(ctx, REPLAY, { rebase: true })
		const line = `the start made again on this build, the recording's ${r.of} frames played : ${r.state}, ${r.played} samples`
		if (r.differ) throw new Error(`${line} · samples differ : ${JSON.stringify(r.differ)}`)
		return `${line}, equal · upstream's per-frame check : ${r.divergence ? r.divergence[0] : 'no divergence'}`
	})

	await ctx.scenario('CARD-NEW', async () => {
		const { card: c, state: s } = await onCard(ctx, 'new')
		if (s.unlocks.save.join() !== '0,0' || c.profiles.some(Boolean)) throw new Error(`a new card, yet ${hex(s.unlocks.save)} · ${short(c)}`)
		return `unlocks ${hex(s.unlocks.save)} · ${short(c)}`
	})

	await ctx.scenario('CARD-FULL', async () => {
		const { card: c, state: s } = await onCard(ctx, 'full-100')
		const want = SAVES['full-100'].spec
		const got = rewardsOf(c.profiles[0]?.rewards ?? [])
		if (s.unlocks.save.join() !== want.unlocks.join()) throw new Error(`unlocks ${hex(s.unlocks.save)}, not ${hex(want.unlocks)}`)
		if (c.tropyBeaten !== 18) throw new Error(`N. Tropy beaten on ${c.tropyBeaten} tracks`)
		if (got.trophies !== 16 || got.relics !== 54 || got.keys !== 4 || got.gems !== 5 || got.tokens !== 16) throw new Error(`profile 1 : ${JSON.stringify(got)}`)
		return `unlocks ${hex(s.unlocks.save)} · N. Tropy beaten on 18 tracks · profile 1 ${JSON.stringify(got)}`
	})

	await ctx.scenario('CARD-PARTIAL', async () => {
		const out = []
		for (const [query, open] of [['&preset=unlock-off', false], ['', true]]) {
			const { state: s } = await onCard(ctx, 'partial', query)
			if (s.unlocks.save.join() !== SAVES.partial.spec.unlocks.join()) throw new Error(`unlocks ${hex(s.unlocks.save)}`)
			if (s.unlocks.open !== open) throw new Error(`the unlock box ${open ? 'on' : 'off'}, yet open = ${s.unlocks.open}`)
			out.push(`box ${open ? 'on' : 'off'} : the save ${hex(s.unlocks.save)}, everything open ${s.unlocks.open}`)
		}
		return out.join(' · ')
	})

	await ctx.scenario('CARD-NTROPY', async () => {
		const { card: c, state: s } = await onCard(ctx, 'ntropy-beaten')
		if (c.tropyBeaten !== 18 || !(s.unlocks.save[0] & 0x20)) throw new Error(`N. Tropy beaten on ${c.tropyBeaten}, unlocks ${hex(s.unlocks.save)}`)
		return `N. Tropy beaten on ${c.tropyBeaten} tracks, unlocked (${hex(s.unlocks.save)})`
	})

	await ctx.scenario('CARD-GHOST', async () => {
		const { what, card: c } = await onCard(ctx, 'ghost-crash-cove')
		if (!(c.ghosts >= 1)) throw new Error(`no ghost on the card : ${short(c)} (files ${Object.keys(what.files).join(', ')})`)
		return `${c.ghosts} ghost(s) · files ${Object.entries(what.files).map(([f, n]) => `${f} ${n} B`).join(', ')}`
	})

	await ctx.scenario('CARD-OLD', async () => {
		const { card: c, state: s } = await onCard(ctx, 'old-version')
		if (!c.outdated && c.version !== -17) throw new Error(`an older profile, read as current : ${short(c)}`)
		return `the game's verdict : ${short(c)} · unlocks ${hex(s.unlocks.save)}`
	})

	await ctx.scenario('CARD-DAMAGED', async () => {
		const { card: c, state: s } = await onCard(ctx, 'damaged')
		if (s.unlocks.save.join() === SAVES.partial.spec.unlocks.join()) throw new Error(`the damaged card read as whole : ${hex(s.unlocks.save)} · ${short(c)}`)
		return `the game's verdict : ${short(c)} · unlocks ${hex(s.unlocks.save)}`
	})

	await ctx.scenario('ADV-POINTS', async () => {
		const out = []
		for (const name of ['adv-start', 'adv-4-trophies', 'adv-2-keys', 'adv-before-oxide']) {
			const spec = SAVES[name].spec.adv
			await onCard(ctx, name)
			let s
			try {
				s = await adventureLoad(ctx)
			} finally {
				await ctx.pad(0).disconnect().catch(() => {})
			}
			const c = await card(ctx)
			const got = rewardsOf(c.adv.rewards)
			const want = rewardsOf(spec.rewards)
			if (s.levelID !== spec.hub || JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name} : level ${s.levelID} (not ${spec.hub}), ${JSON.stringify(got)} (not ${JSON.stringify(want)})`)
			out.push(`${name} : hub ${Object.keys(LEVEL).find(k => LEVEL[k] === s.levelID)}, ${got.trophies} trophies, ${got.keys} keys`)
		}
		return out.join(' · ')
	})

	await ctx.scenario('CARD-IMPORT', async () => {
		await ensureSave(ctx, 'full-100', { SAVES })
		const image = join(tmpdir(), 'ctr-precise-full-100.mcr')
		await exportSave('full-100', image)
		const r = await importSave(image, 'imported-mcr')
		const { state: s } = await onCard(ctx, 'imported-mcr')
		if (s.unlocks.save.join() !== SAVES['full-100'].spec.unlocks.join()) throw new Error(`imported, the game reads ${hex(s.unlocks.save)}`)
		return `full-100 → ${image} (128 KB) → imported-mcr (${r.files.join(', ')}) : the game reads ${hex(s.unlocks.save)}`
	})

	await ctx.scenario('PRESETS', async () => {
		await open(ctx, '?turbo=1')
		await ctx.js("localStorage.setItem('ctr-ui.duo', 'sentinel'); return true")
		const out = []
		const read = () => ctx.js('let v; globalThis.ctrUI.settings.subscribe((s) => { v = s })(); return { duo: v.duo, muted: v.muted, unlockAll: v.unlockAll, device: v.device.mode, keyboard: v.keyboard.slice(0, 4), name: v.name }')
		const want = {
			clean: v => !v.duo && !v.muted && v.unlockAll && v.device === 'auto',
			named: v => v.name === 'Tester',
			muted: v => v.muted,
			'unlock-off': v => !v.unlockAll,
			duo: v => v.duo,
			'keyboard-only': v => v.device === 'keyboard',
			'pad-only': v => v.device === 'gamepad',
			remapped: v => v.keyboard[1] === 6 && v.keyboard[3] === 25,
		}
		for (const name in want) {
			await open(ctx, `?turbo=1&preset=${name}`)
			const v = await read()
			if (!want[name](v)) throw new Error(`preset ${name} : ${JSON.stringify(v)}`)
			if (name === 'unlock-off') {
				const s = await until(ctx, 'the game reading the box', n => n.unlocks && n.unlocks.open === false, { timeout: 10_000 })
				out.push(`unlock-off : the game's box ${s.unlocks.open}`)
			} else out.push(name)
		}
		const kept = await ctx.js("return localStorage.getItem('ctr-ui.duo')")
		await ctx.js("localStorage.removeItem('ctr-ui.duo'); return true")
		if (kept !== 'sentinel') throw new Error(`the player's own settings changed : ctr-ui.duo = ${kept}`)
		return `${out.join(' · ')} · the player's own settings untouched`
	})

	await ctx.scenario('PLAYERS-SEATS', async () => {
		await startAt(ctx, 'menu')
		try {
			const got = await players(ctx, { pads: 3, want: ['pad', 'kb', 'pad', 'pad'] })
			return `seats ${got.join(' ')} · ${brief(await state(ctx))}`
		} finally {
			// a pad left plugged in takes P1 on the next pages (and in a snapshot made there)
			for (let i = 0; i < 3; i++) await ctx.pad(i).disconnect().catch(() => {})
		}
	})

	await ctx.scenario('FAULT-CARD-FULL', async () => {
		await bootOnCard(ctx, 'new', '&fault=card-full')
		await until(ctx, 'the card read', n => n.card?.stage === 0, { timeout: 10_000 })
		await inPage(ctx, `globalThis.ctrDev.card.write(${JSON.stringify(SAVES.partial.spec)})`, { label: 'a save on a full card' })
		const c = await until(ctx, "the game's card-full screen", n => n.card?.screen === 6, { timeout: 10_000 })
		const files = await ctx.js('return globalThis.ctrDev.card.files()')
		if (Object.keys(files).length) throw new Error(`written anyway : ${JSON.stringify(files)}`)
		return `the game : ${short(c.card)} · nothing written`
	})

	// What a disc failing mid-game does today : the game's CdRead goes on as if the read had worked
	// (platform/native_cd.c), a level load waits forever, the page says nothing. Asserted as it is, so a
	// fix shows here.
	await ctx.scenario('FAULT-DISC-READ', async () => {
		await startAt(ctx, 'menu')
		await ctx.js("globalThis.ctrDev.fault('disc-read', true); globalThis.__ctrStart = { mode: 'tt', players: 1, level: 3, laps: 3, difficulty: 0, characters: [0, 1, 2, 3] }; return true")
		await sleep(8000)
		const during = await state(ctx)
		const faults = await ctx.js('return globalThis.ctrDev.faults()')
		await ctx.js("globalThis.ctrDev.fault('disc-read', false); return true")
		await sleep(4000)
		const after = await state(ctx)
		const page = await ctx.js("return [...document.querySelectorAll('#drop-error, .toast, [role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ')")
		if (!(faults.discReads > 0)) throw new Error(`no read failed (${JSON.stringify(faults)}) : ${brief(during)}`)
		const stuck = after.screen === 'loading' && after.vblank === during.vblank
		return `${faults.discReads} reads failed during Crash Cove's load : ${brief(during)} · 4 s after the fault lifted : ${stuck ? 'still loading, no frame — the game froze' : brief(after)} · the page : ${page ? `« ${page} »` : 'nothing'}`
	})

	await ctx.scenario('FAULT-PROBE', async () => {
		await ctx.conn.send('Page.navigate', { url: `${await ctx.js('return location.origin + location.pathname')}?fault=disc-read` }, ctx.sid)
		await sleep(500)
		const end = Date.now() + 20_000
		let r
		while (Date.now() < end) {
			r = await ctx.js("return { error: document.getElementById('drop-error')?.textContent?.trim() ?? '', status: document.getElementById('boot-status')?.textContent?.trim() ?? '' }").catch(() => null)
			if (r?.error) break
			await sleep(300)
		}
		const still = await ctx.js("const root = await navigator.storage.getDirectory(); try { return (await (await root.getFileHandle('ctr-u.bin')).getFile()).size } catch { return 0 }")
		if (!r?.error) throw new Error(`no error on the boot screen after 20 s (status « ${r?.status} »)`)
		if (!still) throw new Error('the stored disc was forgotten for a read that failed')
		return `the boot screen : « ${r.error} » · the stored disc kept (${Math.round(still / 1048576)} MB)`
	})

	await ctx.scenario('FAULT-STORAGE', async () => {
		await ctx.conn.send('Page.navigate', { url: `${await ctx.js('return location.origin + location.pathname')}?fault=storage-full` }, ctx.sid)
		await sleep(500)
		const end = Date.now() + 20_000
		while (Date.now() < end && !(await ctx.js("return !!globalThis.__ctrTestHandleFileFromUrl && !!document.getElementById('press-start')").catch(() => false))) await sleep(300)
		// the disc this browser stores, offered again (a blob: URL of its stored file : no 600 MB download)
		await ctx.js("const root = await navigator.storage.getDirectory(); const file = await (await root.getFileHandle('ctr-u.bin')).getFile(); globalThis.__ctrStoreTry = globalThis.__ctrTestHandleFileFromUrl(URL.createObjectURL(file)).then(() => 'done', (e) => String(e)); return true")
		let error = ''
		for (const stop = Date.now() + 120_000; Date.now() < stop && !error; await sleep(500)) error = await ctx.js("return document.getElementById('drop-error')?.textContent?.trim() ?? ''")
		if (!/refused to store/.test(error)) throw new Error(`the boot screen : « ${error} »`)
		return `the boot screen : « ${error} »`
	})

	await ctx.scenario('FAULT-RELAY', async () => {
		const relay = ctx.args?.relay ?? 'ws://localhost:8788'
		await open(ctx, `?turbo=1&fault=relay-silent&relay=${encodeURIComponent(relay)}`)
		await turbo(ctx, false)
		await ctx.js("document.getElementById('ctr-share-btn').click(); return true")
		let error = ''
		for (const stop = Date.now() + 20_000; Date.now() < stop && !error; await sleep(300)) error = await ctx.js("return document.getElementById('ctr-share-error')?.textContent?.trim() ?? ''")
		if (!error) throw new Error('Share said nothing in 20 s')
		return `Share : « ${error} »`
	})

	await ctx.scenario('PHONE-BOOT', async () => {
		const vp = await phone(ctx)
		try {
			await startAt(ctx, 'menu')
			const a = await state(ctx)
			const r = await ctx.js("const c = document.getElementById('canvas').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height, vw: innerWidth, vh: innerHeight, touch: navigator.maxTouchPoints, mobile: /Mobile/.test(navigator.userAgent) }")
			if (r.vw !== vp.width || r.vh !== vp.height || !r.touch || !r.mobile) throw new Error(`not a phone : ${JSON.stringify(r)}`)
			if (r.x < -1 || r.y < -1 || r.x + r.w > r.vw + 1 || r.y + r.h > r.vh + 1) throw new Error(`the game outside the screen : ${JSON.stringify(r)}`)
			await ctx.js('globalThis.ctrAudio?.context?.suspend?.(); return true')
			await sleep(300)
			await tap(ctx, r.x + r.w / 2, r.y + r.h / 2)
			await sleep(800)
			const sound = await ctx.js('return globalThis.ctrAudio?.context?.state ?? null')
			await sleep(1000)
			const b = await state(ctx)
			if (sound !== 'running') throw new Error(`a tap, and the sound is ${sound}`)
			if (b.vblank <= a.vblank) throw new Error('no frame after the tap')
			return `${r.vw} × ${r.vh}, ${r.touch} touch points, the game ${Math.round(r.w)} × ${Math.round(r.h)} at (${Math.round(r.x)}, ${Math.round(r.y)}) · a tap : the sound ${sound} · +${b.vblank - a.vblank} VBlanks`
		} finally {
			await phone(ctx, null)
		}
	})
}
