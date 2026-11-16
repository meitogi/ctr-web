// The named memory cards of the tests (session 45b) : what each holds, as the game's progress
// (ctrDev.card.write's spec, platform/web_debug_bridge.c CardWrite), and how it is made — every
// card written by the game's own save, never built byte by byte (ctr.mjs makeSave ; setup.suite.mjs
// makes them all). Kept in web/test/player/.saves/<name>/ (gitignored) ; a test starts from one with
// ?card=<name> (web/ui/src/dev/precise.js). No side effects : `node --test` imports it.
//
// The bits (include/namespace_Memcard.h, include/namespace_Main.h) :
//   GAME_PROGRESS.unlocks : the characters (UNLOCK_TROPY 0x20 … UNLOCK_FAKE_CRASH 0x800), the
//     tracks (bits 1–4 : Turbo Track, Parking Lot, North Bowl, Lab Basement), the cups won (bits
//     12–23 now, 24–35 before), the scrapbook (bit 36)
//   timeTrialFlags, one per track : 1 N. Tropy open, 2 N. Tropy beaten, 4 N. Oxide beaten
//   an Adventure profile's rewards (6 words) : trophies from bit 6 (one per track, levelID 0–15),
//     relics from 0x16 / 0x28 / 0x3a (sapphire / gold / platinum, levelID 0–17), CTR tokens from 0x4c,
//     boss keys from 0x5e (4), Oxide beaten as a boss 0x62 / 0x63, the hubs' doors 0x64–0x68, gems
//     from 0x6a (5), purple tokens from 0x6f (4), Oxide beaten 0x73 / 0x74, hints seen from 0x76

// include/namespace_Level.h (enum LevelID)
export const LEVEL = {
	DINGO_CANYON: 0, DRAGON_MINES: 1, BLIZZARD_BLUFF: 2, CRASH_COVE: 3, TIGER_TEMPLE: 4, PAPU_PYRAMID: 5, ROO_TUBES: 6,
	HOT_AIR_SKYWAY: 7, SEWER_SPEEDWAY: 8, MYSTERY_CAVES: 9, CORTEX_CASTLE: 10, N_GIN_LABS: 11, POLAR_PASS: 12, OXIDE_STATION: 13,
	COCO_PARK: 14, TINY_ARENA: 15, GEM_STONE_VALLEY: 25, N_SANITY_BEACH: 26, THE_LOST_RUINS: 27, GLACIER_PARK: 28, CITADEL_CITY: 29,
}
// The Adventure's hubs and their four races each (the trophies a boss asks for)
export const HUB_TRACKS = {
	N_SANITY_BEACH: ['CRASH_COVE', 'ROO_TUBES', 'TIGER_TEMPLE', 'COCO_PARK'],
	THE_LOST_RUINS: ['MYSTERY_CAVES', 'SEWER_SPEEDWAY', 'PAPU_PYRAMID', 'DINGO_CANYON'],
	GLACIER_PARK: ['BLIZZARD_BLUFF', 'DRAGON_MINES', 'POLAR_PASS', 'TINY_ARENA'],
	CITADEL_CITY: ['N_GIN_LABS', 'CORTEX_CASTLE', 'HOT_AIR_SKYWAY', 'OXIDE_STATION'],
}

export const UNLOCK = { TROPY: 0x20, PENTA: 0x40, ROO: 0x80, PAPU: 0x100, JOE: 0x200, PINSTRIPE: 0x400, FAKE_CRASH: 0x800 }
const CHARACTERS = 0xfe0
const TRACKS = 0x1e
export const TT = { NTROPY_OPEN: 1, NTROPY_BEATEN: 2, NOXIDE_BEATEN: 4 }
const TRACK_COUNT = 18

/** A bit set as u32 words ({ bits } → [w0, w1, …]). */
export function words(bits, count) {
	const w = new Array(count).fill(0)
	for (const b of bits) w[b >> 5] = (w[b >> 5] | (1 << (b & 31))) >>> 0
	return w
}
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i)
const trophies = (hubs) => hubs.flatMap((h) => HUB_TRACKS[h]).map((t) => 6 + LEVEL[t])

/** How many of each reward an Adventure profile's words hold. */
export function rewardsOf(rewards) {
	const has = (b) => ((rewards[b >> 5] >>> (b & 31)) & 1) === 1
	const count = (from, n) => range(from, n).filter(has).length
	return {
		trophies: count(6, 16), relics: count(0x16, 18) + count(0x28, 18) + count(0x3a, 18), tokens: count(0x4c, 16),
		keys: count(0x5e, 4), gems: count(0x6a, 5), purple: count(0x6f, 4), oxide: count(0x73, 2),
	}
}

const ALL_REWARDS = words([
	...range(6, 16), ...range(0x16, 54), ...range(0x4c, 16), ...range(0x5e, 6), ...range(0x64, 5), ...range(0x6a, 5),
	...range(0x6f, 4), 0x73, 0x74, ...range(0x76, 0x1e),
], 6)
const ALL_UNLOCKS = words([...range(1, 4), ...range(12, 25)], 2).map((w, i) => (i === 0 ? (w | CHARACTERS | TRACKS) >>> 0 : w))
const adv = (slot, name, hub, bits, character = 0) => ({ slot, name, character, hub: LEVEL[hub], rewards: words(bits, 6) })

/**
 * The named cards : `spec` (null : no file at all ; `ghost` : a Time Trial run and saved as a ghost ;
 * `from` + `flip` : another card with a byte changed) and `holds`, what a reader is told.
 */
export const SAVES = {
	new: { spec: null, holds: 'no save at all : a card the game has never written' },
	'full-100': {
		spec: { unlocks: ALL_UNLOCKS, tt: new Array(TRACK_COUNT).fill(TT.NTROPY_OPEN | TT.NTROPY_BEATEN | TT.NOXIDE_BEATEN), adv: { ...adv(0, 'FULL', 'GEM_STONE_VALLEY', []), rewards: ALL_REWARDS } },
		holds: 'everything : every character and track, the cups, the scrapbook, N. Tropy and N. Oxide beaten on every track ; profile 1 « FULL » with every trophy, relic (sapphire, gold, platinum), CTR token, key, gem, purple token, Oxide beaten twice',
	},
	partial: {
		spec: { unlocks: [(UNLOCK.ROO | UNLOCK.PAPU | 0x2) >>> 0, 0] },
		holds: 'Ripper Roo and Papu Papu, Turbo Track ; nothing else (the unlock box against a real save)',
	},
	'adv-start': { spec: { adv: adv(0, 'START', 'N_SANITY_BEACH', []) }, holds: 'profile 1 « START », Crash, N. Sanity Beach, nothing won' },
	'adv-4-trophies': {
		spec: { adv: adv(0, 'ROO', 'N_SANITY_BEACH', trophies(['N_SANITY_BEACH'])) },
		holds: "profile 1 « ROO », N. Sanity Beach's four trophies : before Ripper Roo",
	},
	'adv-2-keys': {
		spec: { unlocks: [(UNLOCK.ROO | UNLOCK.PAPU) >>> 0, 0], adv: adv(0, 'KEYS', 'THE_LOST_RUINS', [...trophies(['N_SANITY_BEACH', 'THE_LOST_RUINS']), 0x5e, 0x5f, 0x64]) },
		holds: 'profile 1 « KEYS », eight trophies (the Beach, the Lost Ruins), Ripper Roo and Papu Papu beaten : two keys, at the Lost Ruins',
	},
	'adv-before-oxide': {
		spec: { unlocks: [(UNLOCK.ROO | UNLOCK.PAPU | UNLOCK.JOE | UNLOCK.PINSTRIPE) >>> 0, 0], adv: adv(0, 'OXIDE', 'GEM_STONE_VALLEY', [...range(6, 16), ...range(0x5e, 4), ...range(0x64, 5)]) },
		holds: 'profile 1 « OXIDE », the sixteen trophies and four keys, every door open, at Gem Stone Valley : before N. Oxide',
	},
	'ntropy-beaten': {
		spec: { unlocks: [UNLOCK.TROPY, 0], tt: new Array(TRACK_COUNT).fill(TT.NTROPY_OPEN | TT.NTROPY_BEATEN) },
		holds: "N. Tropy's ghost open and beaten on every track, N. Tropy unlocked",
	},
	'ghost-crash-cove': { spec: null, ghost: { race: 'crash-cove', char: 'crash' }, holds: "a ghost : a Time Trial of Crash Cove the page's Bot drove, saved by the game's ghost save" },
	'old-version': {
		spec: { unlocks: [(UNLOCK.ROO | 0x2) >>> 0, 0], version: -17 },
		holds: 'a profile one version older (-17, the game writes -18) : the game reads it as outdated',
	},
	damaged: { from: 'partial', flip: 0x100 + 0x10, holds: "« partial » with one data byte changed : its checksum no longer matches" },
}
