// The snapshots the suites start from (ctr.mjs startAt), made for the build being served : the main
// menu, and the race starts the suites use. A start point this build already has is loaded and
// checked, not made again. `node web/test/player/select.mjs setup --run` runs it ; startAt makes a
// missing one on first use anyway, this only does it ahead of a run.
//
// The snapshots hold the game's memory (pieces of the disc) : web/test/player/.states/, gitignored,
// never committed, never in a site (web/pages/guard.sh).
//
// RUN : the player harness on setup.suite.mjs, --url http://localhost:8091/index.html (served by
// web/test/player/serve.py). Not a node --test file.

import { PLAYER, pointName, say, startAt } from './ctr.mjs'

export const meta = { url: 'http://localhost:8091/index.html', login: false, player: PLAYER }

export const tags = { SETUP: ['harness'] }

/** The start points the suites use. */
export const POINTS = [
	'menu',
	{ race: 'crash-cove', char: 'crash', mode: 'tt' },
	{ race: 'crash-cove', char: ['crash', 'cortex'], mode: 'vs', players: 2 },
	{ race: 'crash-cove', char: 'crash', mode: 'arcade' },
]

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
}
