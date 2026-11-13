// Player suite : split screen, what goes missing (session 22, render-2p-flicker).
//   SPLIT-2P   VS., 2 players on Crash Cove (started as the menus start it : ctr.mjs startAt), two
//              virtual pads both driven by the bots' autopilot (racing line, an item every 1.5 s) ;
//              from the countdown, `frames` presents (default 600, ~20 s) counted, in real time
//   SPLIT-1P   the same on one screen (Arcade, a single race on Crash Cove), the baseline
// The counts are the debug bridge's (platform/web_debug_bridge.c, globalThis.__ctrFlicker), per
// present :
//   - impostor : from 2 players up a distant kart is shown as a sprite cut from a VRAM atlas the
//     game renders off-screen (DecalMP) ; presents where a view shows a kart so while that view's
//     atlas tile is empty, and presents where the HUD fruit's VRAM area is empty (the same off-screen path) —
//     both were every present before the session-22 fix (the user's « the other player's kart
//     invisible, from time to time », and the fruit next to « ×N »)
//   - karts : each other kart within `near` (2000) world units and 35° of a view's heading —
//     drawn there, hidden by the game's own rules (Invisibility, the post-hit flicker), or hidden
//     otherwise. Game-level only : the game marks an impostor kart drawn (DRAW_SUCCESSFUL) before
//     its sprite exists, so an empty atlas passes this one — the impostor counts carry that defect
//   - pixels : the displayed VRAM in 32 × 16 tiles, a tile whose hash goes A B A over three
//     presents ; reported only — exhaust, smoke and the countdown lights do that on their own
// Fails when the atlas or the fruit area is empty while shown, or a kart is hidden otherwise,
// unless --set expect=any (a « before » count). Writes <label>-counts.json, the first A B A frames
// and two frames per kart LOD (--set vram=n : n whole-VRAM PNGs, from --set vramAfter=<presents>)
// next to the run's screenshots.
//
// RUN : bash plans/ctr-native-web/tools/play.sh split <session> <port> -- --only SPLIT-2P
// [--set frames=1800 --set expect=any] — a debug build (window.__ctr), the disc in the origin's
// OPFS (or preloaded). Not a node --test file.

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as autopilot from '../../ui/src/lib/autopilot.js'
import { PLAYER, brief, pointName, recordWithSound, say, startAt, state, track, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

export const tags = {
	'SPLIT-2P': ['render', 'race'],
	'SPLIT-1P': ['render', 'race'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** The race of `point` at its countdown (its snapshot, else the direct start : ctr.mjs startAt), the pads plugged in. */
async function toRace(ctx, point, pads) {
	await startAt(ctx, point)
	for (const p of pads) await p.connect()
	const s = await until(ctx, 'the race loaded', n => n.screen !== 'menu' && n.screen !== 'loading' && n.karts?.length >= pads.length, { timeout: 30_000, every: 250 })
	return { s, path: [pointName(point)] }
}

/** Pad i as the autopilot's keys : Cross accelerate, Square reverse, Circle item, D-pad steer. */
const PAD_OF = { c: 'cross', x: 'square', v: 'circle', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const asPad = p => ({ hold: k => p.hold(PAD_OF[k]), release: k => p.release(PAD_OF[k]), press: k => p.press(PAD_OF[k]) })

/** Every kart on the racing line, items every 1.5 s (web/ui/src/lib/autopilot.js, the bots' driver). */
function driveAll(ctx, pads, deadline) {
	return Promise.all(pads.map((p, i) => autopilot.drive({
		out: asPad(p),
		read: async () => { const s = await state(ctx); return s && { ...s, kart: s.karts?.[i] ?? null } },
		track: () => track(ctx),
		deadline,
	})))
}

async function count(ctx, label, players) {
	const frames = Number(ctx.args.frames ?? 600)
	const pads = Array.from({ length: players }, (_, i) => ctx.pad(i))
	const point = players === 2 ? { race: 'crash-cove', char: ['crash', 'cortex'], mode: 'vs', players: 2 } : { race: 'crash-cove', char: 'crash', mode: 'arcade' }
	const { s, path } = await toRace(ctx, point, pads)
	if (s.players !== players) throw new Error(`${s.players} players in the race — expected ${players} : ${brief(s)}`)
	if (s.levelID !== 3) say(`level ${s.levelID}, not Crash Cove (3)`)
	say(`race loaded : ${brief(s)}`)
	await until(ctx, 'the countdown', n => n.screen === 'countdown' || n.screen === 'race', { timeout: 60_000, every: 100 })
	await ctx.js(`globalThis.__ctrFlicker = { keep: 4, keepLods: true, vram: Number(${JSON.stringify(ctx.args.vram ?? 0)}), vramAfter: Number(${JSON.stringify(ctx.args.vramAfter ?? 0)}), near: Number(${JSON.stringify(ctx.args.near ?? 2000)}) }; return true`)
	const counting = Date.now()
	let beat = Date.now()
	const done = async () => {
		const n = await ctx.js('return globalThis.__ctrFlicker?.frames ?? 0')
		if (Date.now() - beat > 10_000) { beat = Date.now(); say(`counted ${n} / ${frames} presents`) }
		return n >= frames
	}
	await recordWithSound(ctx, `${label}-race`, async () => {
		await until(ctx, 'the race', n => n.screen === 'race', { timeout: 30_000, every: 100 })
		// the karts race (and fire items) until `frames` presents are counted
		const drove = await driveAll(ctx, pads, Date.now() + (frames / 29) * 1000 + 2000)
		say(`driven : ${JSON.stringify(drove)}`)
		while (!(await done())) await sleep(250)
	})
	const png = await ctx.js(`
		return (async () => {
			const out = []
			for (const k of (globalThis.__ctrFlicker?.kept ?? [])) {
				for (const [part, rgba] of k.tag ? [[k.tag, k.rgba]] : [['blink', k.rgba], ['next', k.next]]) {
					if (!rgba) continue
					const c = new OffscreenCanvas(k.w, k.h)
					c.getContext('2d').putImageData(new ImageData(rgba, k.w, k.h), 0, 0)
					const b = await c.convertToBlob({ type: 'image/png' })
					const bytes = new Uint8Array(await b.arrayBuffer())
					let s = ''
					for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
					out.push({ name: 'frame-' + k.frame + '-' + part + '.png', data: btoa(s) })
				}
			}
			return out
		})()`)
	const f = await ctx.js(`const f = globalThis.__ctrFlicker; globalThis.__ctrFlicker = null; const { kept, prev, ...o } = f; return o`)
	// presents per second over the counted stretch (the counter's read-backs included : compare runs, not builds)
	const pps = Math.round((f.frames / ((Date.now() - counting) / 1000)) * 10) / 10
	// a proof only : the headless capture sometimes stalls (« captureScreenshot timed out ») after a long count
	await ctx.shot(`${label}-end`).catch(e => say(`no end screenshot : ${e.message}`))
	// the run's folder : the newest under --set proofs (the harness numbers the files it writes)
	const root = ctx.args.proofs
	const dir = root ? readdirSync(root).map(d => join(root, d)).filter(d => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] : null
	// which tiles blinked, as « row,col » over the cols × rows grid (row 0 = top of the screen)
	const where = (f.tiles ?? []).map((n, t) => [n, t]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])
		.map(([n, t]) => `${Math.floor(t / f.cols)},${t % f.cols}×${n}`)
	// the native GPU / renderer's own drop reports (stderr → the page log : a cap reached), not the
	// renderer's start-up lines (« *GLSL version », « *Vendor »…)
	const gpuErrors = await ctx.js(`return (document.getElementById('log')?.textContent ?? '').split('\\n').filter(l => /\\[CTR (GPU|Renderer)\\]/.test(l) && !/\\] \\*/.test(l)).slice(-20)`)
	const k = f.karts ?? null
	const result = { label, players, pps, karts: k, gpuErrors, frames: f.frames, bad: f.bad, events: f.events, primMax: f.primMax, primGuard: f.primGuard, impostor: f.impostor, grid: `${f.cols}x${f.rows}`, display: `${f.w}x${f.h}`, where, path, log: f.log }
	if (dir) {
		writeFileSync(join(dir, `${label}-counts.json`), JSON.stringify(result, null, 2))
		for (const p of png ?? []) writeFileSync(join(dir, `${label}-${p.name}`), Buffer.from(p.data, 'base64'))
	}
	for (const p of pads) await p.disconnect()
	const imp = f.impostor ? `impostor view-presents ${f.impostor.frames}, tile empty ${f.impostor.empty} · HUD fruit frames ${f.impostor.fruitFrames}, empty ${f.impostor.fruitEmpty} · ` : ''
	const kline = k ? `karts ahead of a view ${k.ahead} : drawn ${k.seen} (LOD 0–3 ${k.lod?.join(" / ")}, as the impostor ${k.impostor}), hidden by the game's rules ${k.ruled}, hidden otherwise ${k.hidden} · ` : ''
	const line = `${players}P : ${pps} presents/s · ${imp}${kline}${f.bad} pixel-blinked frames of ${f.frames} (${f.events} tile blinks), primMem max ${f.primMax} / guard ${f.primGuard} B, display ${f.w}x${f.h}, top tiles ${where.slice(0, 6).join(' ')}, GPU errors ${gpuErrors.length}${gpuErrors.length ? ` (${gpuErrors[gpuErrors.length - 1].slice(0, 120)})` : ''}`
	// the pixel count is reported, not asserted : exhaust, smoke and lights repeat A B A on their own
	const lost = (k?.hidden ?? 0) + (f.impostor?.empty ?? 0) + (f.impostor?.fruitEmpty ?? 0)
	if (lost > 0 && ctx.args.expect !== 'any') throw new Error(line)
	return line
}

export default async ctx => {
	await ctx.scenario('SPLIT-2P', async () => count(ctx, 'split-2p', 2))
	await ctx.scenario('SPLIT-1P', async () => count(ctx, 'split-1p', 1))
}
