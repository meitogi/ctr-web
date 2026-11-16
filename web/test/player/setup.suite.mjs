// The snapshots the suites start from (ctr.mjs startAt), made for the build being served : the main
// menu, and the race starts the suites use. A start point this build already has is loaded and
// checked, not made again. `node web/test/player/select.mjs setup --run` runs it ; startAt makes a
// missing one on first use anyway, this only does it ahead of a run.
//
// SAVES makes the named memory cards (saves.mjs) by the game's own save, RECORDINGS the recorded
// races (ctr.mjs recordRace) — both kept when they exist ; `--set remake=1` makes them again.
//
// The snapshots hold the game's memory (pieces of the disc) : web/test/player/.states/, gitignored,
// never committed, never in a site (web/pages/guard.sh) ; the saves (.saves/) and the recordings
// (.replays/) too.
//
// RUN : the player harness on setup.suite.mjs, --url http://localhost:8091/index.html (served by
// web/test/player/serve.py). Not a node --test file.

import { PLAYER, ensureSave, makeSave, pointName, recordRace, replayKept, say, startAt } from './ctr.mjs'
import { SAVES } from './saves.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = { SETUP: ['harness'], SAVES: ['harness', 'card'], RECORDINGS: ['harness', 'race'] }

/** The start points the suites use. */
export const POINTS = [
	'menu',
	{ race: 'crash-cove', char: 'crash', mode: 'tt' },
	{ race: 'crash-cove', char: ['crash', 'cortex'], mode: 'vs', players: 2 },
	{ race: 'crash-cove', char: 'crash', mode: 'arcade' },
]

/**
 * The recorded races : `cc-arcade-seed1` is the one an upstream merge replays (26b : made on the
 * version before the merge, played after it with ctr.mjs playRace(…, { rebase: true })).
 */
export const RECORDINGS = {
	'cc-arcade-seed1': { race: 'crash-cove', char: 'crash', mode: 'arcade', laps: 3, seed: 1 },
}

export default async ctx => {
	await ctx.scenario('SETUP', async () => {
		const out = []
		for (const point of POINTS) {
			const r = await startAt(ctx, point)
			say(`${pointName(point)} : ${r.from} in ${(r.ms / 1000).toFixed(1)} s`)
			out.push(`${pointName(point)} ${r.from} ${(r.ms / 1000).toFixed(1)} s`)
		}
		return out.join(' · ')
	})

	await ctx.scenario('SAVES', async () => {
		const out = []
		for (const name in SAVES) {
			const t0 = Date.now()
			const what = ctx.args?.remake === '1' ? await makeSave(ctx, name, { SAVES }) : await ensureSave(ctx, name, { SAVES })
			out.push(`${name} ${Object.keys(what.files).length} file(s) ${((Date.now() - t0) / 1000).toFixed(0)} s`)
		}
		return out.join(' · ')
	})

	await ctx.scenario('RECORDINGS', async () => {
		const out = []
		for (const name in RECORDINGS) {
			let kept = null
			try { kept = replayKept(name).what } catch { /* not made yet */ }
			if (kept && ctx.args?.remake !== '1') {
				out.push(`${name} kept (${kept.frames} frames, ${kept.version})`)
				continue
			}
			const r = await recordRace(ctx, name, RECORDINGS[name], { maxFrames: 9000 })
			out.push(`${name} recorded : ${r.frames} frames, ${r.samples} samples, ${r.version}`)
		}
		return out.join(' · ')
	})
}
