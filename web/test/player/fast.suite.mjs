// Player suite : the tests' fast start itself (web/ui/src/dev/fast.js, platform/web_debug_bridge.c,
// platform/native_platform.c — debug builds only).
//   STATE        a snapshot saved on the main menu, the page loaded again, the snapshot loaded at
//                the game's first frame : the same menu row, level and mode, the menu takes input
//   START-TT     ?race=crash-cove&char=pinstripe&mode=tt : Pinstripe (an unlockable one) on Crash
//                Cove's countdown, from the page's load to the countdown timed
//   START-ARCADE ?race=coco-park&char=coco&mode=arcade : 1P against seven AI karts
//   START-VS     ?race=tiger-temple&char=crash,cortex&mode=vs&players=2 : two players, split screen
//   TURBO        a Time Trial lap driven by the page's Bot in turbo : the lap counted, game time at
//                3× real time or more
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8091 (it keeps the snapshots, /__states)
//   Play  : the player harness (CLAUDE.md § Tests) on fast.suite.mjs, --url http://localhost:8091/index.html
// Not a node --test file.

import { PLAYER, brief, open, saveState, state, stateLoaded, turbo, until } from './ctr.mjs'
import { bootToMenu, onMainMenu } from './ctr.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = {
	STATE: ['harness', 'menu'],
	'START-TT': ['harness', 'race', 'unlock'],
	'START-ARCADE': ['harness', 'race'],
	'START-VS': ['harness', 'race', 'render'],
	TURBO: ['harness', 'race'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const countdown = s => s.screen === 'countdown'

async function started(ctx, query, want) {
	const t0 = Date.now()
	const o = await open(ctx, `${query}&turbo=1`)
	const s = await until(ctx, 'the countdown', countdown, { timeout: 90_000, every: 100 })
	const ms = Date.now() - t0
	await turbo(ctx, false)
	const k = await ctx.js('const c = window.__ctr; return { players: c.players, karts: c.drivers, characters: c.characters }')
	if (s.levelID !== want.level) throw new Error(`level ${s.levelID}, not ${want.level} : ${brief(s)}`)
	for (const m of want.mode) if (!s.mode.includes(m)) throw new Error(`mode ${s.mode.join('|')} lacks ${m}`)
	if (k.players !== want.players) throw new Error(`${k.players} players, not ${want.players}`)
	const chars = k.characters
	if (want.characters && JSON.stringify(chars?.slice(0, want.characters.length)) !== JSON.stringify(want.characters)) {
		throw new Error(`characters ${JSON.stringify(chars)}, not ${JSON.stringify(want.characters)}`)
	}
	if (want.karts && k.karts !== want.karts) throw new Error(`${k.karts} karts, not ${want.karts}`)
	return `${(ms / 1000).toFixed(1)} s from the load to the countdown (first frame ${(o.ms / 1000).toFixed(1)} s, load ${o.attempt}) · characters ${JSON.stringify(chars)} · ${brief(s)}`
}

export default async ctx => {
	await ctx.scenario('STATE', async () => {
		await open(ctx, '?turbo=1')
		await bootToMenu(ctx)
		await turbo(ctx, false)
		const saved = await saveState(ctx, 'fast-suite-menu')
		const t0 = Date.now()
		await open(ctx, '?turbo=1&state=fast-suite-menu')
		const r = await stateLoaded(ctx)
		const ms = Date.now() - t0
		await turbo(ctx, false)
		if (!r.ok) throw new Error(`loaded ${JSON.stringify(r)}`)
		const s = await until(ctx, 'the main menu, taking input', n => onMainMenu(n) && n.menu.input, { timeout: 10_000 })
		await ctx.js("document.getElementById('canvas')?.focus(); return true")
		await ctx.press('ArrowDown')
		const moved = await until(ctx, 'the cursor on the next row', n => n.menu?.row === s.menu.row + 1, { timeout: 5000 })
		return `${Math.round(saved.bytes / 1024)} KB · the page loaded and the snapshot in ${(ms / 1000).toFixed(1)} s · ${r.got} · Down → ${moved.menu.label}`
	})

	await ctx.scenario('START-TT', () =>
		started(ctx, '?race=crash-cove&char=pinstripe&mode=tt', { level: 3, mode: ['TIME_TRIAL'], players: 1, characters: [8], karts: 1 }))

	await ctx.scenario('START-ARCADE', () =>
		started(ctx, '?race=coco-park&char=coco&mode=arcade', { level: 14, mode: ['ARCADE_MODE'], players: 1, characters: [3], karts: 8 }))

	await ctx.scenario('START-VS', () =>
		started(ctx, '?race=tiger-temple&char=crash,cortex&mode=vs&players=2', { level: 4, mode: [], players: 2, characters: [0, 1], karts: 2 }))

	await ctx.scenario('TURBO', async () => {
		await open(ctx, '?race=crash-cove&char=crash&mode=tt&turbo=1')
		await until(ctx, 'the countdown', countdown, { timeout: 90_000, every: 100 })
		await ctx.js('globalThis.ctrDev.bot(true); return true')
		const a = await state(ctx)
		const t0 = Date.now()
		const s = await until(ctx, 'lap 2', n => n.kart?.lap >= 1, { timeout: 120_000, every: 100 })
		const wall = (Date.now() - t0) / 1000
		await ctx.js('globalThis.ctrDev.bot(false); return true')
		await turbo(ctx, false)
		const game = (s.raceTime - a.raceTime) / 1000
		const x = game / wall
		if (!(x >= 3)) throw new Error(`game time ${game.toFixed(1)} s in ${wall.toFixed(1)} s : ×${x.toFixed(1)}`)
		await sleep(200)
		return `lap 1 in ${game.toFixed(1)} s of game time, ${wall.toFixed(1)} s of wall time : ×${x.toFixed(1)} · ${brief(s)}`
	})
}
