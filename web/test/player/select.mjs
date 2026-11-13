#!/usr/bin/env node
// Which player scenarios to run : the three levels of the tests (CLAUDE.md § Tests).
//
//   node web/test/player/select.mjs [change|tag|full] [--since <ref>] [--run] [--json]
//   node web/test/player/select.mjs setup [--run]
//
//   change  (default) the scenarios the change touches : the files changed since <ref> (default : the
//           last tag) and in the working tree, read through coverage.mjs. A suite's own file runs
//           the scenarios its diff touches (all of them when the diff is outside any scenario) ;
//           a file no rule claims runs the smoke ; words only (README, docs) run nothing.
//           `node --test` in web/ runs first.
//   tag     the smoke (coverage.mjs SMOKE) : boot, a race, the page, the unlock, Share.
//   full    every scenario of every suite in coverage.mjs SUITES : a release, an upstream merge.
//   setup   the snapshots the suites start from (setup.suite.mjs), made once per build.
//
// Prints one line per suite, `<suite>: A,B,…`. --run runs each through $CTR_PLAY, a command
// template where {suite} is the suite's name and the scenarios are appended as `--only A,B`, e.g.
//   CTR_PLAY='node <visual-loop>/scripts/e2e.mjs --suite web/test/player/{suite}.suite.mjs --url http://localhost:8091/index.html'
// and times each suite and the whole run.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SMOKE, SUITES, WORDS, areasOf } from './coverage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SUITE_FILE = /^web\/test\/player\/([a-z0-9-]+)\.suite\.mjs$/

/** The scenarios of a suite's source : [{ id, line }] in order (line : 1-based). */
export function scenariosIn(source) {
	const out = []
	source.split('\n').forEach((text, i) => {
		const m = text.match(/ctx\.scenario\('([A-Z0-9-]+)'/)
		if (m) out.push({ id: m[1], line: i + 1 })
	})
	return out
}

/**
 * The scenarios a suite's diff touches : `ranges` are the new file's changed lines ([from, to],
 * 1-based) ; a scenario owns its lines up to the next one. A change before the first scenario (the
 * imports, the helpers, the tags) or after the last scenario's end touches them all.
 */
export function touchedScenarios(source, ranges) {
	const list = scenariosIn(source)
	if (!list.length) return []
	// the default export's body ends at the file's last `}` : the last scenario owns up to there
	const end = source.split('\n').length
	const hit = new Set()
	for (const [from, to] of ranges) {
		if (from < list[0].line) return list.map(s => s.id)
		for (let i = 0; i < list.length; i++) {
			const a = list[i].line
			const b = i + 1 < list.length ? list[i + 1].line - 1 : end
			if (from <= b && to >= a) hit.add(list[i].id)
		}
	}
	return list.filter(s => hit.has(s.id)).map(s => s.id)
}

/**
 * The plan of a level : { suites: { name: [ids] }, smoke, why: [lines], unit }.
 *   suites   { name: { tags: { ID: [areas] }, source } } : the suites a level can run
 *   changes  [{ path, ranges }] (change level) : ranges for a suite's file, null when unknown
 */
export function plan({ level = 'change', suites, changes = [], smoke = SMOKE }) {
	const out = {}
	const why = []
	const add = (suite, ids) => {
		const all = suites[suite] ? Object.keys(suites[suite].tags) : []
		out[suite] = [...new Set([...(out[suite] ?? []), ...ids])].sort((a, b) => all.indexOf(a) - all.indexOf(b))
	}
	if (level === 'full') {
		for (const name in suites) add(name, Object.keys(suites[name].tags))
		return { suites: out, why: ['full : every scenario'], unit: true }
	}
	const addSmoke = reason => {
		why.push(`smoke : ${reason}`)
		for (const [suite, id] of smoke) add(suite, [id])
	}
	if (level === 'tag') {
		addSmoke('the tag level')
		return { suites: out, why, unit: true }
	}
	const areas = new Set()
	let unit = false
	for (const { path, ranges } of changes) {
		const m = path.match(SUITE_FILE)
		if (m) {
			const s = suites[m[1]]
			if (!s) {
				why.push(`${path} : a suite outside coverage.mjs SUITES, not run`)
				continue
			}
			const ids = ranges ? touchedScenarios(s.source, ranges) : Object.keys(s.tags)
			why.push(`${path} : ${ids.join(', ') || 'no scenario'}`)
			unit = true
			add(m[1], ids)
			continue
		}
		if (!WORDS.test(path)) unit = true
		const a = areasOf(path)
		if (a === null) {
			addSmoke(`${path} is claimed by no rule of coverage.mjs`)
			continue
		}
		why.push(`${path} : ${a.join(', ') || 'no player suite'}`)
		for (const x of a) areas.add(x)
	}
	if (areas.has('harness')) addSmoke('the tests\' tools changed')
	for (const name in suites) {
		const ids = Object.keys(suites[name].tags).filter(id => suites[name].tags[id].some(t => areas.has(t)))
		if (ids.length) add(name, ids)
	}
	// in the suites' order (coverage.mjs SUITES)
	const ordered = {}
	for (const name in suites) if (out[name]) ordered[name] = out[name]
	return { suites: ordered, why, unit }
}

// ---- the command line ----

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: join(HERE, '../../..') }).trim()

/** The changed lines of a file's diff since `since` (the working tree), as [from, to] ranges. */
function rangesOf(since, path) {
	const diff = git('diff', '-U0', since, '--', path)
	const ranges = []
	for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const from = Number(m[1])
		const n = m[2] == null ? 1 : Number(m[2])
		ranges.push([from, n === 0 ? from : from + n - 1])
	}
	return ranges
}

export function changesSince(since) {
	const tracked = git('diff', '--name-only', since).split('\n').filter(Boolean)
	const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
	const changes = []
	for (const path of tracked) changes.push({ path, ranges: SUITE_FILE.test(path) ? rangesOf(since, path) : null })
	for (const path of untracked) changes.push({ path, ranges: null })
	return changes
}

export async function loadSuites(names = SUITES) {
	const suites = {}
	for (const name of names) {
		const file = join(HERE, `${name}.suite.mjs`)
		const mod = await import(pathToFileURL(file).href)
		const source = readFileSync(file, 'utf8')
		const tags = mod.tags ?? {}
		const missing = scenariosIn(source).map(s => s.id).filter(id => !tags[id])
		if (missing.length) throw new Error(`${name}.suite.mjs : no tags for ${missing.join(', ')}`)
		suites[name] = { tags, source }
	}
	return suites
}

async function main(argv) {
	const args = argv.slice(2)
	const flag = n => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1] }
	const level = ['change', 'tag', 'full', 'setup'].find(l => args.includes(l)) ?? 'change'
	const run = args.includes('--run')
	let p
	if (level === 'setup') {
		p = { suites: { setup: ['SETUP'] }, why: ['setup : the snapshots'], unit: false }
	} else {
		const since = flag('since') ?? git('describe', '--tags', '--abbrev=0')
		const suites = await loadSuites()
		p = plan({ level, suites, changes: level === 'change' ? changesSince(since) : [] })
		if (level === 'change') p.why.unshift(`since ${since} and the working tree`)
	}
	if (args.includes('--json')) {
		console.log(JSON.stringify(p, null, 1))
	} else {
		for (const w of p.why) console.log(`# ${w}`)
		if (p.unit) console.log('node --test (web/)')
		for (const s in p.suites) console.log(`${s}: ${p.suites[s].join(',')}`)
		if (!Object.keys(p.suites).length) console.log('# no player scenario')
	}
	if (!run) return 0
	const tpl = process.env.CTR_PLAY
	if (!tpl) {
		console.error('select.mjs --run : set CTR_PLAY, the command that runs one suite ({suite} = its name)')
		return 2
	}
	const t0 = Date.now()
	const times = []
	let failed = 0
	if (p.unit) {
		const t = Date.now()
		const r = spawnSync('node', ['--test'], { cwd: join(HERE, '../..'), stdio: 'inherit' })
		times.push(['node --test', Date.now() - t, r.status])
		failed += r.status !== 0
	}
	for (const s in p.suites) {
		const t = Date.now()
		const cmd = `${tpl.replaceAll('{suite}', s)} --only ${p.suites[s].join(',')}`
		console.log(`\n== ${s} : ${p.suites[s].length} scenario(s)\n$ ${cmd}`)
		const r = spawnSync('sh', ['-c', cmd], { stdio: 'inherit' })
		times.push([s, Date.now() - t, r.status])
		failed += r.status !== 0
	}
	const min = ms => `${Math.floor(ms / 60_000)} min ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')} s`
	console.log(`\n== ${level} : ${min(Date.now() - t0)}`)
	for (const [s, ms, status] of times) console.log(`   ${status === 0 ? 'ok  ' : 'FAIL'} ${s.padEnd(12)} ${min(ms)}`)
	return failed ? 1 : 0
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
	main(process.argv).then(code => process.exit(code), e => { console.error(e?.stack ?? e); process.exit(2) })
}
