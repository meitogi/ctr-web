// web/test/player/select.mjs : which player scenarios a change runs (the three levels of the tests).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SMOKE, SUITES, areasOf } from './player/coverage.mjs'
import { loadSuites, plan, scenariosIn, touchedScenarios } from './player/select.mjs'

const SOURCE = `import x from './ctr.mjs'
export const tags = { A: ['menu'], B: ['race'], C: ['share'] }
export default async ctx => {
	await ctx.scenario('A', async () => {
		one()
	})

	await ctx.scenario('B', async () => {
		two()
	})
	await ctx.scenario('C', async () => {
		three()
	})
}
`
const suites = {
	menu: { tags: { 'BOOT-MENU': ['boot', 'menu'], 'MENU-PAD': ['menu', 'input'] }, source: '' },
	'time-trial': { tags: { 'TT-LAP': ['race'] }, source: '' },
	bare: { tags: { 'BARE-PAGE': ['page'], 'UNLOCK-ON': ['unlock', 'menu'], 'SHARE-BUTTON': ['share', 'page'] }, source: '' },
	x: { tags: { A: ['menu'], B: ['race'], C: ['share'] }, source: SOURCE },
}
const smoke = [['menu', 'BOOT-MENU'], ['time-trial', 'TT-LAP'], ['bare', 'BARE-PAGE']]
const change = (...changes) => plan({ suites, smoke, changes })

test('the scenarios of a suite and the lines each one owns', () => {
	assert.deepEqual(scenariosIn(SOURCE).map(s => `${s.id}@${s.line}`), ['A@4', 'B@8', 'C@11'])
	assert.deepEqual(touchedScenarios(SOURCE, [[5, 5]]), ['A'])
	assert.deepEqual(touchedScenarios(SOURCE, [[9, 9], [12, 12]]), ['B', 'C'])
	// the header (imports, tags) : every scenario
	assert.deepEqual(touchedScenarios(SOURCE, [[2, 2]]), ['A', 'B', 'C'])
})

test('words only run nothing, not even node --test', () => {
	const p = change({ path: 'README.md' }, { path: 'docs/x.md' }, { path: 'web/share/README.md' })
	assert.deepEqual(p.suites, {})
	assert.equal(p.unit, false)
})

test('a path no rule claims runs the smoke', () => {
	const p = change({ path: 'something/new.txt' })
	assert.deepEqual(p.suites, { menu: ['BOOT-MENU'], 'time-trial': ['TT-LAP'], bare: ['BARE-PAGE'] })
	assert.match(p.why.join('\n'), /something\/new\.txt is claimed by no rule/)
})

test("a suite's own file runs the scenarios its diff touches, and those only", () => {
	const p = change({ path: 'web/test/player/x.suite.mjs', ranges: [[9, 9]] })
	assert.deepEqual(p.suites, { x: ['B'] })
	assert.equal(p.unit, true)
})

test('the game runs the scenarios tagged with what it touches', () => {
	assert.deepEqual(areasOf('game/MAIN/MainMain.c'), ['boot', 'menu', 'race', 'render'])
	const p = change({ path: 'game/MAIN/MainMain.c' })
	assert.deepEqual(p.suites, { menu: ['BOOT-MENU', 'MENU-PAD'], 'time-trial': ['TT-LAP'], bare: ['UNLOCK-ON'], x: ['A', 'B'] })
})

test('the unlock, Share and the page each reach their own scenarios', () => {
	assert.deepEqual(change({ path: 'game/230/MM_Characters.c' }).suites, { menu: ['BOOT-MENU', 'MENU-PAD'], bare: ['UNLOCK-ON'], x: ['A'] })
	assert.deepEqual(change({ path: 'web/share/host.js' }).suites, { bare: ['SHARE-BUTTON'], x: ['C'] })
	assert.deepEqual(change({ path: 'web/ui/src/Settings.svelte' }).suites, { bare: ['BARE-PAGE', 'SHARE-BUTTON'] })
})

test("the tests' tools run the smoke ; a unit test file runs node --test only", () => {
	assert.deepEqual(change({ path: 'web/test/player/ctr.mjs' }).suites, { menu: ['BOOT-MENU'], 'time-trial': ['TT-LAP'], bare: ['BARE-PAGE'] })
	const u = change({ path: 'web/ui/test/input.test.js' })
	assert.deepEqual(u.suites, {})
	assert.equal(u.unit, true)
})

test('the tag level is the smoke, the full level every scenario', () => {
	assert.deepEqual(plan({ level: 'tag', suites, smoke }).suites, { menu: ['BOOT-MENU'], 'time-trial': ['TT-LAP'], bare: ['BARE-PAGE'] })
	const full = plan({ level: 'full', suites, smoke }).suites
	assert.deepEqual(full.x, ['A', 'B', 'C'])
	assert.deepEqual(full.bare, ['BARE-PAGE', 'UNLOCK-ON', 'SHARE-BUTTON'])
})

test('every scenario of the real suites is tagged, and the smoke names real scenarios', async () => {
	const real = await loadSuites(SUITES)
	for (const [suite, id] of SMOKE) assert.ok(real[suite]?.tags[id], `${suite} ${id}`)
	const areas = new Set(['boot', 'menu', 'race', 'render', 'unlock', 'card', 'input', 'audio', 'page', 'share', 'harness'])
	for (const name in real) for (const id in real[name].tags) for (const a of real[name].tags[id]) assert.ok(areas.has(a), `${name} ${id} : ${a}`)
})
