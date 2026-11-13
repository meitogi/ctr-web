// Player suite : Time Trial.
//   TT-MENU-PATH  main menu (its snapshot) → Time Trial → the default character and the first track
//                 (Cross through each screen) until the race loads : a Time Trial on Crash Cove.
//   TT-LAP        Crash Cove's countdown (its snapshot, ctr.mjs startAt), the race driven by the
//                 page's Bot in turbo (web/ui/src/dev/bot.js, lib/autopilot.js) to its end : lap 0
//                 → 1 → the race finished, speed > 0, then VBlanks at game speed in real time.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//           (no-store : the agent browser caches across runs ; port forwarded)
//   Play  : bash plans/ctr-native-web/tools/play.sh time-trial <session> 8093
//   Browser : the agent browser (`agent-browser up`), else ctr-browser.sh on the Mac.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.
//
// DRIVING (lib/autopilot.js, as it was written here first) : the track is read, not guessed. __ctr.track.path is the level's
// racing line (LevNavTable[0], the points the AI karts follow). Pure pursuit :
// find the nearest point of the line, aim at the point a lookahead distance
// further along it, hold Left / Right while the kart's heading and that bearing
// differ. Heading = kart.angle : the kart moves along (sin, cos)(angle) in
// (x, z), Right lowers the angle, Left raises it (measured on Crash Cove with
// known inputs, see LOG T3). Stuck on a wall (no progress) : reverse
// (Square = X) with the wheel the other way, then go on.
// The lap is lap index 0 → 1 ; the run goes on to the end of the race.

import { PLAYER, brief, menuTo, startAt, state, turbo, until, vblankAdvances } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

export const tags = {
	'TT-MENU-PATH': ['menu', 'race'],
	'TT-LAP': ['race'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const ACCEL = 'c' // keyboard C = Cross (platform/native_input.c)

export default async ctx => {
	await ctx.scenario('TT-MENU-PATH', async () => {
		await startAt(ctx, 'menu')
		await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await ctx.shot('time-trial-row')
		// Cross through every screen (character, track…) until the level loads.
		const path = []
		for (let i = 0; i < 10; i++) {
			const s = await state(ctx)
			if (s.screen !== 'menu') break
			path.push(s.menu ? `${s.menu.title || '-'}:${s.menu.label}` : `levelID ${s.levelID}`)
			await ctx.press(ACCEL)
			await sleep(1200)
		}
		await ctx.shot('after-menus')
		const s = await until(ctx, 'the race to load', n => n.screen !== 'menu' && n.screen !== 'loading' && n.kart != null, { timeout: 90_000, every: 500 })
		if (!s.mode.includes('TIME_TRIAL')) throw new Error(`not a Time Trial : ${brief(s)}`)
		return `${path.join(' → ')} · ${brief(s)}`
	})

	await ctx.scenario('TT-LAP', async () => {
		const { from, ms } = await startAt(ctx, { race: 'crash-cove', char: 'crash', mode: 'tt' }, { turbo: true })
		await ctx.shot('race-start')
		await ctx.js('globalThis.ctrDev.bot(true); return true')
		const t0 = Date.now()
		let lapAt = 0
		let top = 0
		let end = null
		try {
			for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(250)) {
				const s = await state(ctx)
				const k = s.kart
				if (!k) continue
				top = Math.max(top, k.speed)
				if (k.lap >= 1 && !lapAt) {
					lapAt = s.raceTime
					await ctx.shot('lap-2')
				}
				if (s.screen === 'finished' || k.finished) {
					end = s
					break
				}
			}
		} finally {
			await ctx.js('globalThis.ctrDev.bot(false); return true')
			await turbo(ctx, false)
		}
		end ??= await state(ctx)
		await ctx.shot('end')
		if (!lapAt) throw new Error(`no lap completed in 180 s : ${brief(end)}`)
		if (!(top > 0)) throw new Error(`speed never above 0 (top ${top})`)
		if (!(end.screen === 'finished' || end.kart?.finished)) throw new Error(`race not finished in 180 s : ${brief(end)}`)
		const vb = await vblankAdvances(ctx)
		return `start ${from} in ${(ms / 1000).toFixed(1)} s · lap 0 → 1 at ${(lapAt / 1000).toFixed(1)} s of race time · finished at ${(end.raceTime / 1000).toFixed(1)} s, ${Math.round((Date.now() - t0) / 1000)} s of wall time (turbo) · top speed ${top} · then +${vb} VBlanks in 2 s in real time`
	})
}
