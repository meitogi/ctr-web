// Player suite : the page's Bot (web/ui/src/lib/autopilot.js, dev/bot.js) gets itself out of a wall,
// whatever sent it there (session 41 : on the iPhone, hit by a bomb in lap 3, it stayed against a wall
// and the measured race never ended). Each case puts the kart somewhere bad by hand — keys held from
// the countdown, as a bomb or a bad turn would leave it — then switches the Bot on : it must be back
// on the racing line, going forwards, within the time a player would take.
//   BOT-WALL-<case>   Crash Cove, Time Trial (no other kart, the same start each time) :
//     HEAD-LEFT / HEAD-RIGHT   driven into the side wall nose first
//     BACKWARDS-LEFT / -RIGHT  turned round (a U-turn on the throttle), then driven on, the wrong way
//     REVERSED                 backed into the wall behind the start
//     SPIN                     a long full-lock spin, then left where it stopped
//     GRIND-LEFT               held against the wall while driving : it slides along the side (the
//                              user's case after the bomb, « roulé sur le côté et impossible d'en sortir »)
//   « Back » : 9 points of the racing line forward of where the Bot took over (of 227 on Crash Cove :
//   about 3 s at speed), within 20 s.
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Play  : the player harness (CLAUDE.md § Tests) on bot.suite.mjs, --url http://localhost:8093/index.html
// Not a node --test file.

import { PLAYER, open, until } from './ctr.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: PLAYER }

const CASES = {
	'HEAD-LEFT': [['c', 'ArrowLeft', 1400], ['c', 3000]],
	'HEAD-RIGHT': [['c', 'ArrowRight', 1400], ['c', 3000]],
	'BACKWARDS-LEFT': [['c', 'ArrowLeft', 3600], ['c', 2500]],
	'BACKWARDS-RIGHT': [['c', 'ArrowRight', 3600], ['c', 2500]],
	REVERSED: [['x', 3500]],
	SPIN: [['c', 'ArrowLeft', 7000], [600]],
	'GRIND-LEFT': [['c', 'ArrowLeft', 1000], ['c', 'ArrowLeft', 'ArrowRight', 0], ['c', 'ArrowLeft', 5000]],
}
// BOT-HITS : the Bot drives a lap ; every few seconds it is knocked off (one of these, in turn), at
// whatever spot of the track it has reached — narrow parts included — then it drives on
const HITS = [
	['bomb, left', [['c', 'ArrowLeft', 1500]]],
	['bomb, right', [['c', 'ArrowRight', 1500]]],
	['turned round, left', [['c', 'ArrowLeft', 3000]]],
	['turned round, right', [['c', 'ArrowRight', 3000]]],
	['backed off, left', [['x', 'ArrowLeft', 1500]]],
	['backed off, right', [['x', 'ArrowRight', 1500]]],
	['pushed into the left wall', [['c', 'ArrowLeft', 700], ['c', 2000]]],
	['pushed into the right wall', [['c', 'ArrowRight', 700], ['c', 2000]]],
	['stopped dead', [[1500]]],
	['spun out', [['c', 'ArrowLeft', 4500]]],
]
const HIT_BACK_MS = 10_000
export const tags = { ...Object.fromEntries(Object.keys(CASES).map((k) => [`BOT-WALL-${k}`, ['harness', 'race', 'input']])), 'BOT-HITS': ['harness', 'race', 'input'] }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BACK_POINTS = 9
const BACK_MS = 20_000

// the bot's own hands (dev/keys.js) : synthetic keys on window, flagged so Settings lets them through
const keys = (ctx, type, names) => ctx.js(`for (const [code, key, keyCode] of ${JSON.stringify(names.map((n) => ({ c: ['KeyC', 'c', 67], x: ['KeyX', 'x', 88], ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37], ArrowRight: ['ArrowRight', 'ArrowRight', 39] })[n]))}) {
	const e = new KeyboardEvent('${type}', { code, key, keyCode, which: keyCode, bubbles: true, cancelable: true }); e.ctrBot = true; window.dispatchEvent(e) } return true`)

// where the kart is along the racing line (its nearest point, as autopilot.js finds it) : a forward
// count that wraps at the finish line, unlike the checkpoints' laps
const kart = (ctx) => ctx.js(`const c = window.__ctr; if (!c?.kart) return null
	const p = c.track.path, k = c.kart
	let at = 0, best = Infinity
	for (let i = 0; i < p.length; i++) { const d = (p[i].x - k.pos.x) ** 2 + (p[i].z - k.pos.z) ** 2 + 4 * (p[i].y - k.pos.y) ** 2; if (d < best) { best = d; at = i } }
	return { at, n: p.length, cp: k.checkpoint, lap: k.lap, speed: k.speed, angle: k.angle }`)

/** What the Bot did (dev/bot.js's trace), one line. */
const botTrace = (ctx) => ctx.js("return (globalThis.__ctrBotTrace ?? []).map((e) => Object.entries(e).filter(([k]) => k !== 't').map(([k, v]) => k + '=' + v).join(',')).join(' | ') || 'nothing'")

/** Keys held for a while, step after step : [key, key, …, ms]. */
async function play(ctx, steps) {
	for (const step of steps) {
		const ms = step[step.length - 1]
		const held = step.slice(0, -1)
		if (held.length) await keys(ctx, 'keydown', held)
		await sleep(ms)
		if (held.length) await keys(ctx, 'keyup', held)
	}
}

/** The Bot on until it is 9 line points ahead of where it took over, going forwards : the seconds it took, or null. */
async function back(ctx, within) {
	const from = await kart(ctx)
	await ctx.js('globalThis.__ctrBotTrace = []; globalThis.ctrDev.bot(true); return true')
	const t0 = Date.now()
	const trail = []
	for (;;) {
		await sleep(500)
		const now = await kart(ctx)
		if (!now) return { from, s: null, trail, finished: true }
		const ahead = (now.at - from.at + now.n) % now.n
		trail.push(`@${now.at}:${now.speed}`)
		if (ahead >= BACK_POINTS && ahead < now.n / 2 && now.speed > 0) return { from, s: (Date.now() - t0) / 1000, trail }
		if (Date.now() - t0 > within) return { from, s: null, trail }
	}
}

export default async (ctx) => {
	await ctx.scenario('BOT-HITS', async () => {
		await open(ctx, '?race=crash-cove&char=crash&mode=tt&laps=3&mute')
		await until(ctx, 'the race', (s) => s.screen === 'race' && s.kart, { timeout: 60_000, every: 100 })
		await ctx.js('globalThis.ctrDev.bot(true); return true')
		const lines = []
		const stuck = []
		for (let i = 0; i < HITS.length * 2; i++) {
			await sleep(4000 + (i % 3) * 1500)
			const [what, steps] = HITS[i % HITS.length]
			await ctx.js('globalThis.ctrDev.bot(false); return true')
			await sleep(300)
			const at = await kart(ctx)
			if (!at || (await ctx.js('return window.__ctr.screen')) === 'finished') break
			await play(ctx, steps)
			const r = await back(ctx, HIT_BACK_MS)
			lines.push(`${what} at @${at.at} : ${r.s == null ? 'NOT BACK' : `${r.s.toFixed(1)} s`}`)
			if (r.s == null && !r.finished) stuck.push(`${what} at @${at.at} (took over at @${r.from.at}, speed ${r.from.speed}) : ${r.trail.join(' ')} · the Bot : ${await botTrace(ctx)}`)
		}
		await ctx.js('globalThis.ctrDev.bot(false); return true')
		if (stuck.length) throw new Error(`not back within ${HIT_BACK_MS / 1000} s : ${stuck.join(' ‖ ')} ‖ all : ${lines.join(' · ')}`)
		return lines.join(' · ')
	})

	for (const name in CASES) {
		await ctx.scenario(`BOT-WALL-${name}`, async () => {
			await open(ctx, '?race=crash-cove&char=crash&mode=tt&mute')
			await ctx.js('globalThis.ctrDev.bot(false); return true')
			await until(ctx, 'the race', (s) => s.screen === 'race' && s.kart, { timeout: 60_000, every: 100 })
			// put it somewhere bad, by hand
			await play(ctx, CASES[name])
			await sleep(400)
			const from = await kart(ctx)
			await ctx.js('globalThis.__ctrBotTrace = []; globalThis.ctrDev.bot(true); return true')
			const t0 = Date.now()
			const trail = []
			let now = from
			for (;;) {
				await sleep(500)
				now = await kart(ctx)
				const ahead = (now.at - from.at + now.n) % now.n
				trail.push(`${((Date.now() - t0) / 1000).toFixed(1)}s @${now.at} v${now.speed}`)
				if (ahead >= BACK_POINTS && ahead < now.n / 2 && now.speed > 0) break
				if (Date.now() - t0 > BACK_MS) throw new Error(`still not back after ${BACK_MS / 1000} s : took over at line point ${from.at} (speed ${from.speed}, angle ${from.angle}), now ${now.at} · ${trail.filter((_, i) => i % 4 === 0).join(' · ')} · the Bot : ${await botTrace(ctx)}`)
			}
			await ctx.js('globalThis.ctrDev.bot(false); return true')
			return `took over at line point ${from.at} (speed ${from.speed}, angle ${from.angle}) · ${BACK_POINTS} points on in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${trail.join(' ')} · the Bot : ${await botTrace(ctx)}`
		})
	}
}
