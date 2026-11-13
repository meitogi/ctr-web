// Player suite : what makes this edition the bare one — the game as it is, unlock, Share by one
// button, four players in all.
//   BARE-PAGE    : the home page and Settings carry none of the room UI (no « or join a room », no
//     code dials, no relay figures, no joining card, no Help tab, no Netplay tab) ; the « Unlock
//     everything » box is there, checked by default ; « Report a problem » opens this repository's
//     own form (meitogi/ctr-web), filled with this build's version.
//   UNLOCK-ON    : box checked, Time Trial's character select : more characters reachable than the
//     eight of a new save, the track select more tracks ; GAME_PROGRESS.unlocks (what the card
//     stores) unchanged throughout (__ctr.unlocks.save).
//   UNLOCK-OFF   : box unchecked : the character select is back to the save's own characters.
//   CARD-CLEAN   : box checked, a Time Trial raced to its end : GAME_PROGRESS.unlocks still the
//     save's own, and every save file of the card (IDBFS /memcards) carries them, not the opened ones.
//   SHARE-BUTTON : the page's « Share » button : the room opens, the link is shown (selectable,
//     with Copy) and is the one guests get ; a guest joins while the host is on the main menu, sees
//     it, and its pad reaches the game (the main menu itself is P1's, as on the PS1) ; pressed
//     again, Share stops and the guest is told the host left.
//   TOO-MANY     : the host's machine has two gamepads besides its keyboard : the guests take the
//     seats left, the next guest reads « Too many players » on its own window and gets no seat.
//
// Each scenario starts on its own (select.mjs runs any of them alone) : the main menu's snapshot
// where the card does not matter, a real boot in turbo (bootFast) where it does.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=OFF ; ln -s ../assets/ctr-u.bin build-web-debug/
//   Serve : python3 web/test/player/serve.py build-web-debug 8091
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js)
//   Play  : CTR_WORKTREE=<this repo> bash plans/ctr-native-web/tools/play.sh bare <session> 8091 -- \
//             --set relay=ws://localhost:8788 --set rk=<key>
// Not a node --test file.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAIN_MENU, bootFast, menuTo, open, runDirOf, say, shot, startAt, state, turbo, until } from './ctr.mjs'
import { guestWindow, settled, share, waitIn } from './share.suite.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

export const tags = {
	'BARE-PAGE': ['page'],
	'UNLOCK-ON': ['unlock', 'menu'],
	'UNLOCK-OFF': ['unlock', 'menu'],
	'CARD-CLEAN': ['card', 'unlock', 'race'],
	'SHARE-BUTTON': ['share', 'page'],
	'TOO-MANY': ['share', 'input'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const UNLOCK_KEY = 'ctr-ui.unlock-all'

/** A shot of the page's own layers (Page.captureScreenshot, no surface : the guest page's way). */
async function pageShot(ctx, label) {
	const proof = await ctx.shot(label)
	const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
	const r = await ctx.conn.send('Page.captureScreenshot', { format: 'png' }, ctx.sid)
	if (dir && r?.data) writeFileSync(join(dir, proof.file), Buffer.from(r.data, 'base64'))
	return proof
}
let unlockedOn = null // UNLOCK-ON's counts, for UNLOCK-OFF

/** The home page with the box as `checked` (null : as the browser has it), reloaded, not started. */
async function home(ctx, checked = null) {
	await ctx.js(`${checked === null ? '' : checked ? `localStorage.removeItem('${UNLOCK_KEY}')` : `localStorage.setItem('${UNLOCK_KEY}', '0')`}; return true`)
	// a load can stall on « Looking for the game in this browser… » with nothing else on screen
	// (home-code.suite.mjs saw it too) : another load, three in all
	for (let attempt = 1; ; attempt++) {
		await ctx.reload()
		try {
			return await waitIn(ctx.js, 'the home page', "!!(document.getElementById('press-start') || document.getElementById('drop-zone'))", 25_000)
		} catch (e) {
			if (attempt === 3) throw e
			say(`the home page stalled (${await ctx.js("return document.getElementById('boot-status')?.textContent ?? ''").catch(() => '?')}) : reloading`)
		}
	}
}

/** The character select of Time Trial, from the main menu of a real boot (the card read). */
async function toCharacterSelect(ctx) {
	await bootFast(ctx)
	await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
	await ctx.press('c')
	return until(ctx, 'the character select', s => !!s.charSelect, { timeout: 15_000 })
}

/** Every character P1's cursor reaches : right along each row, then down, the grid twice over. */
async function reachable(ctx) {
	const seen = {}
	const at = async () => { const s = await state(ctx); seen[s.charSelect.characters[0]] = true; return s }
	await at()
	for (const [across, down] of [['ArrowRight', 'ArrowDown'], ['ArrowLeft', 'ArrowUp']]) {
		for (let row = 0; row < 6; row++) {
			for (let i = 0; i < 6; i++) { await ctx.press(across); await sleep(250); await at() }
			await ctx.press(down); await sleep(250); await at()
		}
	}
	return Object.keys(seen).map(Number).sort((a, b) => a - b)
}

/** The tracks Time Trial's track select offers (its rows ; a closed track is skipped by the game) : Down until the first row comes back. */
async function tracks(ctx) {
	await ctx.press('c') // the character picked
	// the track select takes its input itself (its menu's state says « no input ») : its row is the track
	await until(ctx, 'the track select', s => s.menu && !s.charSelect, { timeout: 20_000 })
	await sleep(2000) // its slide-in
	const rows = [(await state(ctx)).menu.row]
	for (let i = 0; i < 30; i++) {
		await ctx.press('ArrowDown')
		await sleep(400)
		const r = (await state(ctx)).menu?.row
		if (r === rows[0]) break
		if (r != null && !rows.includes(r)) rows.push(r)
	}
	return rows.sort((a, b) => a - b)
}

/** The card's files (IDBFS, IndexedDB '/memcards') : [{ path, bytes }]. */
const cardFiles = ctx => ctx.js(`return await new Promise((resolve) => {
	const open = indexedDB.open('/memcards')
	open.onerror = () => resolve([])
	open.onsuccess = () => {
		const db = open.result
		if (!db.objectStoreNames.contains('FILE_DATA')) return resolve([])
		const out = []
		const cur = db.transaction('FILE_DATA').objectStore('FILE_DATA').openCursor()
		cur.onsuccess = () => {
			const c = cur.result
			if (!c) return resolve(out)
			if (c.value?.contents) out.push({ path: String(c.key), bytes: Array.from(c.value.contents) })
			c.continue()
		}
	}
})`)

// The profile file (…-SLOTS) : its icon frames, then struct MemcardProfile, which starts with the
// version 0xffee (MEMCARD_PROFILE_VERSION, include/namespace_Memcard.h) on a 0x80 boundary ; its
// gameSave.progress.unlocks at + 0x144 + 4. Measured on a card this build wrote : at 0x248.
const unlocksOf = bytes => {
	const u32 = o => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
	for (let at = 0; at + 0x150 <= bytes.length; at += 0x80) {
		if (bytes[at] === 0xee && bytes[at + 1] === 0xff) return [u32(at + 0x148), u32(at + 0x14c)]
	}
	return null
}

export default async ctx => {
	let baseline = null

	await ctx.scenario('BARE-PAGE', async () => {
		await home(ctx, true)
		const p = await ctx.js(`return {
			room: ['or-join', 'join-code', 'relay-live', 'joining', 'join-netplay', 'ctr-waiting'].filter(id => document.getElementById(id)),
			box: document.getElementById('unlock-all-box')?.checked ?? null,
			label: document.getElementById('unlock-all')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
		}`)
		if (p.room.length) throw new Error(`room UI on the home page : ${p.room}`)
		if (p.box !== true) throw new Error(`the unlock box is not checked by default : ${p.box}`)
		await pageShot(ctx, 'bare-home')
		await startAt(ctx, 'menu')
		await ctx.press('Escape')
		const s = await waitIn(ctx.js, 'Settings', "document.getElementById('ctr-settings') && [...document.querySelectorAll('#ctr-settings [data-tab]')].map(t => t.dataset.tab)", 10_000)
		if (s.includes('help') || s.includes('online')) throw new Error(`Settings tabs : ${s}`)
		await ctx.js("document.querySelector('#ctr-settings [data-tab=system]').click(); return true")
		const r = await waitIn(ctx.js, 'the report link', "(() => { const a = document.getElementById('ctr-report'); a?.dispatchEvent(new FocusEvent('focus')); return a?.href.includes('version=') ? a.href : null })()", 5000)
		const u = new URL(r)
		if (`${u.origin}${u.pathname}` !== 'https://github.com/meitogi/ctr-web/issues/new') throw new Error(`report : ${r}`)
		const version = await ctx.js('return window.__CTR_VERSION')
		if (u.searchParams.get('version') !== version || u.searchParams.get('mode') !== 'Solo') throw new Error(`report fields : ${r}`)
		await ctx.press('Escape')
		return `no room UI · box « ${p.label} » checked · tabs ${s.join(', ')} · report → ${u.origin}${u.pathname} (${version}, Solo)`
	})

	await ctx.scenario('UNLOCK-ON', async () => {
		await home(ctx, true)
		const s0 = await toCharacterSelect(ctx)
		baseline = s0.unlocks.save
		if (!s0.unlocks.open) throw new Error(`the box does not reach the game : ${JSON.stringify(s0.unlocks)}`)
		const chars = await reachable(ctx)
		await shot(ctx, 'unlock-on-characters')
		const list = await tracks(ctx)
		await shot(ctx, 'unlock-on-tracks')
		const s1 = await state(ctx)
		if (s1.unlocks.save.join() !== baseline.join()) throw new Error(`the save's unlocks changed : ${baseline} → ${s1.unlocks.save}`)
		// 0–7 : the eight of a new save ; 8–14 : the ones a save unlocks (Pinstripe … Fake Crash)
		if (!chars.some(c => c > 7)) throw new Error(`no unlockable character reachable : ${chars}`)
		unlockedOn = { chars, tracks: list }
		return `characters ${chars.join(',')} (${chars.length}) · tracks ${list.length} (rows ${list.join(',')}) · save unlocks ${baseline.map(w => w.toString(16))} unchanged`
	})

	await ctx.scenario('UNLOCK-OFF', async () => {
		await home(ctx, false)
		const s0 = await toCharacterSelect(ctx)
		if (s0.unlocks.open) throw new Error('the box is off, the game still opens everything')
		const chars = await reachable(ctx)
		await shot(ctx, 'unlock-off-characters')
		const list = await tracks(ctx)
		const on = unlockedOn
		if (chars.some(c => c > 7) && !s0.unlocks.save.some(w => w)) throw new Error(`an unlockable character with the box off and nothing in the save : ${chars}`)
		if (on && list.length > on.tracks.length) throw new Error(`off ${list.length} tracks, on ${on.tracks.length}`)
		return `characters ${chars.join(',')} (${chars.length})${on ? ` against ${on.chars.join(',')} with the box` : ''} · tracks ${list.length}${on ? ` against ${on.tracks.length}` : ''} · save unlocks ${s0.unlocks.save.map(w => w.toString(16))}`
	})

	await ctx.scenario('CARD-CLEAN', async () => {
		await home(ctx, true)
		// a real boot (the card read) then a Time Trial started as the menus start it, in turbo : the
		// page's Bot drives it to its end
		await open(ctx, '?race=crash-cove&char=crash&mode=tt&turbo=1')
		const s0 = await until(ctx, 'the countdown', s => s.screen === 'countdown', { timeout: 90_000, every: 100 })
		if (!s0.unlocks.open) throw new Error(`the box does not reach the game : ${JSON.stringify(s0.unlocks)}`)
		baseline = baseline ?? s0.unlocks.save
		const before = await cardFiles(ctx)
		say('the Bot drives the Time Trial to its end (3 laps), in turbo')
		await ctx.js('globalThis.ctrDev.bot(true); return true')
		await until(ctx, 'the race finished', s => !!s.kart?.finished, { timeout: 180_000, every: 250 })
		await ctx.js('globalThis.ctrDev.bot(false); return true')
		await turbo(ctx, false)
		await sleep(1000)
		const end = await state(ctx)
		// the results, then the race's end menu : SAVE GHOST writes the card (the ghost and the
		// progress) ; every label met is kept for the report
		const met = []
		const label = async () => { const t = await state(ctx); const l = t.menu?.input ? t.menu.label : ''; if (l && met.at(-1) !== l) met.push(l); return l }
		let saved = false
		// the results (Cross), then PLEASE ENTER YOUR NAME for a new record : Start (Enter) jumps to
		// SAVE HIGH SCORE, Cross saves it — the card's first write
		for (let i = 0; i < 3; i++) { await ctx.press('c'); await sleep(1500) }
		await shot(ctx, 'card-name')
		for (let i = 0; i < 2; i++) { await ctx.press('Enter'); await sleep(1500) }
		await ctx.press('c')
		await sleep(4000)
		await shot(ctx, 'card-after-name')
		for (let i = 0; i < 40 && !saved; i++) {
			const l = await label()
			if (/SAVE/i.test(l)) { await ctx.press('c'); saved = true; break }
			await ctx.press(l ? 'ArrowDown' : 'c')
			await sleep(800)
		}
		// the card's own questions (a slot, OK) : Cross through them, then the menus again
		for (let i = 0; i < 12; i++) { await sleep(1500); await label(); await ctx.press('c') }
		await sleep(5000)
		const s = await state(ctx)
		const after = await cardFiles(ctx)
		const written = after.filter(f => !before.some(b => b.path === f.path && b.bytes.join() === f.bytes.join()))
		const profiles = after.map(f => ({ path: f.path, unlocks: unlocksOf(f.bytes) })).filter(f => f.unlocks)
		await shot(ctx, 'card-clean')
		if (!profiles.length) throw new Error(`no profile on the card after the save (files ${after.map(f => f.path).join(', ') || 'none'})`)
		if (s.unlocks.save.join() !== (baseline ?? s.unlocks.save).join()) throw new Error(`the save's unlocks changed : ${baseline} → ${s.unlocks.save}`)
		for (const f of profiles) {
			if (f.unlocks.join() !== s.unlocks.save.join()) throw new Error(`${f.path} carries ${f.unlocks.map(w => w.toString(16))}, the game's save ${s.unlocks.save.map(w => w.toString(16))}`)
		}
		return `race ended on ${end.screen} (lap ${end.kart?.lap}) · menus ${met.join(' > ')}${saved ? '' : ' (no SAVE row met)'} · files written ${written.map(f => `${f.path} (${f.bytes.length} B)`).join(', ') || 'none'} · profiles ${profiles.map(f => `${f.path} ${f.unlocks.map(w => w.toString(16))}`).join(', ') || 'none'} · memory ${s.unlocks.save.map(w => w.toString(16))}`
	})

	await ctx.scenario('SHARE-BUTTON', async () => {
		const { relay, rk = '' } = ctx.args
		if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8788 --set rk=<key>')
		await home(ctx, true)
		await startAt(ctx, 'menu')
		await ctx.js(`for (const [k, v] of [['ctr-share.relay', ${JSON.stringify(relay)}], ['ctr-share.rk', ${JSON.stringify(rk)}]]) localStorage.setItem(k, v)
			const set = (id, v) => { const e = document.getElementById(id); e.value = v } ; set('share-relay', ${JSON.stringify(relay)}); set('share-rk', ${JSON.stringify(rk)}); return true`)
		await ctx.js("document.getElementById('ctr-share-btn').click(); return true")
		const link = await waitIn(ctx.js, 'the link in the card', "document.getElementById('ctr-share-link')?.value || null", 20_000)
		const api = await ctx.js('return window.__ctrShare.state().link')
		if (link !== api) throw new Error(`card ${link} ≠ panel ${api}`)
		const copy = await ctx.js("document.getElementById('ctr-share-copy').click(); await new Promise(r => setTimeout(r, 300)); return { button: document.getElementById('ctr-share-copy').textContent, toasts: [...document.querySelectorAll('.toast')].map(t => t.innerText) }")
		// the page's layers alone : the harness's capture of the WebGL canvas comes back flat grey on
		// the headless agent browser, and the compositor's surface leaves the page's layers out
		await ctx.js("document.getElementById('canvas').style.visibility = 'hidden'; return true")
		await pageShot(ctx, 'share-card')
		await ctx.js("document.getElementById('canvas').style.visibility = ''; return true")
		const g = await guestWindow(ctx, link)
		try {
			const gs = await settled(g.js)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message})`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			// on the main menu, the guest's Down reaches the game as its player's pad (the bus the
			// game reads) ; the main menu itself takes P1's pad only (RECTMENU_ProcessInput reads
			// buttonTapPerPlayer[0] unless a menu says ALL_PLAYERS_USE_MENU) : as on the PS1, a
			// second player moves their own cursor from the character select on (share.suite's SHARE-2TAB)
			const on = await state(ctx)
			if (!on.menu?.input || on.screen !== 'menu') throw new Error(`the host is not on the main menu : ${on.screen}`)
			await g.js("dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' })); return true")
			const pad = await waitIn(ctx.js, "the guest's Down in the game", `window.__ctrShare.state().pads[${gs.slot}]?.buttons === 0xffbf ? window.__ctrShare.state().pads[${gs.slot}] : null`, 5000)
			await g.js("dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', key: 'ArrowDown' })); return true")
			const frames = await g.js('return (await window.__ctrShareGuest.stats())?.framesDecoded ?? 0')
			await shot(ctx, 'share-guest-on-menu')
			await ctx.js("document.getElementById('ctr-share-btn').click(); return true")
			const off = await waitIn(ctx.js, 'Share off', "(() => { const s = window.__ctrShare.state(); return s.sharing ? null : s })()", 10_000)
			const gone = await waitIn(g.js, 'the guest told', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'closed' ? s : null })()", 20_000)
			return `link shown and copied (« ${copy.button} », ${copy.toasts.join(' | ') || 'no toast'}) · guest P${gs.slot + 1} joined on the main menu (${MAIN_MENU[on.menu.row]}), ${frames} frames of it decoded, its Down read by the game (pad word ${pad.buttons.toString(16)}) · pressed again : sharing ${off.sharing}, guest ${gone.state} (${gone.code})`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('TOO-MANY', async () => {
		if (!ctx.args.relay) ctx.skip('no relay')
		await startAt(ctx, 'menu')
		await ctx.pad(0).connect()
		await ctx.pad(1).connect()
		// both pads in : beside the keyboard's P1, each is a player (the game reports them one by one)
		const seats = await waitIn(ctx.js, "the host's two gamepads as players", "(() => { const s = window.__ctrShare.state().localSeats; return [1, 2, 3].filter(n => s & (1 << n)).length >= 2 ? s : null })()", 15_000)
		const link = await share(ctx)
		const gs = []
		try {
			const free = [1, 2, 3].filter(n => !(seats & (1 << n)))
			for (const want of free) {
				const g = await guestWindow(ctx, link)
				gs.push(g)
				const s = await settled(g.js)
				if (s.state !== 'connected') {
					if (s.code === 'online-mode') ctx.skip(`no direct WebRTC path between the windows (${s.message})`)
					throw new Error(`guest P${want + 1} : ${JSON.stringify(s)}`)
				}
				if (s.slot !== want) throw new Error(`a guest got slot ${s.slot}, the next free one is ${want}`)
			}
			const fifth = await guestWindow(ctx, link)
			gs.push(fifth)
			const s = await settled(fifth.js)
			const text = await waitIn(fifth.js, 'the window says it', "document.getElementById('overlay-text')?.textContent || null", 10_000)
			await sleep(500)
			const { data } = await ctx.conn.send('Page.captureScreenshot', { format: 'png' }, fifth.sid)
			const proof = await ctx.shot('too-many-host')
			const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
			if (dir && data) writeFileSync(join(dir, proof.file.replace(/host(\.png)$/, 'guest$1')), Buffer.from(data, 'base64'))
			if (s.state !== 'refused' || s.code !== 'full' || !/^Too many players/.test(text)) throw new Error(`fifth : ${JSON.stringify(s)} « ${text} »`)
			const h = await ctx.js('return window.__ctrShare.state()')
			if (h.guests.length !== free.length) throw new Error(`host guests ${JSON.stringify(h.guests)}`)
			return `the host's own players : P1 and ${[1, 2, 3].filter(n => seats & (1 << n)).map(n => `P${n + 1}`).join(', ')} (its gamepads) · guests ${free.map(n => `P${n + 1}`).join(', ')} · the fifth player : « ${text} » (${s.code})`
		} finally {
			for (const g of gs) await g.close()
			await ctx.js("window.ctrShareApi.stop(); return true").catch(() => {})
			await ctx.pad(1).disconnect()
			await ctx.pad(0).disconnect()
		}
	})
}
