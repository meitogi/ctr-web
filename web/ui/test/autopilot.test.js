// The bot's decisions (src/lib/autopilot.js), on a fake clock and a fake kart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAIN_MENU, MAIN_MENU_IDS, createPicker, drive, inBootIntro, menuTo, onMainMenu } from '../src/lib/autopilot.js'

/** A clock that moves only when the code sleeps. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms) => { t += ms } }
}
function recorder() {
  const log = []
  const held = {}
  return { log, held, out: { hold: async (k) => { held[k] = true; log.push(`+${k}`) }, release: async (k) => { delete held[k]; log.push(`-${k}`) }, press: async (k) => { log.push(k) } } }
}
// a straight line along +z
const line = { path: Array.from({ length: 40 }, (_, i) => ({ x: 0, y: 0, z: i * 100 })) }

test('drive : steers back to the line — a target at a lower heading is ArrowRight (Right lowers the angle, LOG T3)', async () => {
  const c = clock()
  const r = recorder()
  let ticks = 0
  // the kart at x = 300 heading +z (angle 0), the line at x = 0 : atan2(-300, dz) < 0
  const read = async () => (++ticks > 3 ? { screen: 'finished', kart: { finished: true, rank: 1, pos: { x: 300, y: 0, z: 100 }, angle: 0, speed: 0 } } : { screen: 'race', kart: { pos: { x: 300, y: 0, z: 100 + ticks * 50 }, angle: 0, speed: 1000, finished: false } })
  const res = await drive({ out: r.out, read, track: async () => line, deadline: 1e9, ...c })
  assert.equal(res.finished, true)
  assert.equal(res.rank, 1)
  assert.ok(r.log.includes('+c'), 'accelerates')
  assert.ok(r.log.includes('+ArrowRight'), `steers back to the line : ${r.log.join(' ')}`)
  assert.deepEqual(r.held, {}, 'nothing left held')
})

test('drive : an item every 1.5 s', async () => {
  const c = clock()
  const r = recorder()
  let z = 0
  const read = async () => { z += 40; return c.now() > 10_000 ? { screen: 'finished', kart: { finished: true, rank: 0 } } : { screen: 'race', kart: { pos: { x: 0, y: 0, z }, angle: 0, speed: 1000, finished: false } } }
  const res = await drive({ out: r.out, read, track: async () => ({ path: line.path.map((p, i) => ({ ...p, z: i * 1000 })) }), deadline: 1e9, ...c })
  assert.ok(res.fired >= 5 && res.fired <= 7, `fired ${res.fired}× in ~10 s`)
  assert.equal(r.log.filter((k) => k === 'v').length, res.fired)
})

test('drive : stuck (not moving for 1 s) → reverse with Square, then on again', async () => {
  const c = clock()
  const r = recorder()
  const read = async () => (c.now() > 5000 ? { screen: 'finished', kart: { finished: true, rank: 0 } } : { screen: 'race', kart: { pos: { x: 0, y: 0, z: 100 }, angle: 0, speed: 0, finished: false } })
  await drive({ out: r.out, read, track: async () => line, deadline: 1e9, ...c })
  const i = r.log.indexOf('+x')
  assert.ok(i > 0, `reversed : ${r.log.join(' ')}`)
  assert.ok(r.log.indexOf('-c') < i && r.log.indexOf('-x') > i, 'accelerator off while reversing')
  // Square alone only brakes : the game reverses with the stick down too (VehPhysProc.c)
  assert.ok(r.log.indexOf('+ArrowDown') > i && r.log.indexOf('-ArrowDown') < r.log.indexOf('-x'), `Down held while reversing : ${r.log.join(' ')}`)
})

test('drive : facing away from the line (turned round by a hit) → backs up turning its nose to the line, Square and Down', async () => {
  const c = clock()
  const r = recorder()
  // heading nearly -z (half a turn and a bit), the line runs +z ; backing up, the wheel turns the kart
  // the other way than going forwards (measured in the game : Left lowers the angle in reverse)
  let angle = 2348
  let reads = 0
  const read = async () => {
    reads++
    if (r.held.x && r.held.ArrowDown) angle += r.held.ArrowRight ? 200 : r.held.ArrowLeft ? -200 : 0
    return c.now() > 8000 ? { screen: 'finished', kart: { finished: true, rank: 0 } } : { screen: 'race', kart: { pos: { x: 0, y: 0, z: 500 + (reads % 2) * 20 }, angle, speed: 500, finished: false } }
  }
  const res = await drive({ out: r.out, read, track: async () => line, deadline: 1e9, ...c })
  assert.ok(res.turns >= 1, `turned : ${res.turns}`)
  const back = r.log.indexOf('+x')
  assert.ok(back >= 0 && r.log.indexOf('+ArrowDown') > back, `Square then Down : ${r.log.join(' ')}`)
  assert.ok(Math.abs(((angle % 4096) + 4096) % 4096 - 0) < 600 || Math.abs(((angle % 4096) + 4096) % 4096 - 4096) < 600, `faces the line again (angle ${angle})`)
  assert.deepEqual(r.held, {}, 'nothing left held')
})

test('drive : the countdown is no wall — no back-out while the kart cannot move (the iPhone reversed off the start line)', async () => {
  const c = clock()
  const r = recorder()
  const read = async () => (c.now() > 6000 ? { screen: 'finished', kart: { finished: true, rank: 0 } } : { screen: 'countdown', kart: { pos: { x: 0, y: 0, z: 100 }, angle: 0, speed: 0, finished: false } })
  const res = await drive({ out: r.out, read, track: async () => line, deadline: 1e9, ...c })
  assert.equal(res.recoveries, 0)
  assert.equal(res.turns, 0)
  assert.ok(!r.log.includes('+x'), `never reversed : ${r.log.join(' ')}`)
  assert.ok(r.log.includes('+c'), 'the accelerator held')
})

test('drive : the switch off stops the race at once', async () => {
  const c = clock()
  const r = recorder()
  const res = await drive({ out: r.out, read: async () => ({ stop: true }), track: async () => line, deadline: 1e9, ...c })
  assert.equal(res.finished, false)
  assert.deepEqual(r.held, {})
})

test('picker : browses 4–10 moves, then Cross until locked ; says browse, then locked', async () => {
  const c = clock()
  const r = recorder()
  const p = createPicker({ out: r.out, ...c, random: () => 0 })
  assert.equal(await p.step({ locked: 0 }, 1), 'browse')
  assert.deepEqual(r.log, ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'c'])
  assert.equal(await p.step({ locked: 0 }, 1), null) // within 1.5 s : no second Cross
  assert.equal(r.log.length, 5)
  assert.equal(await p.step({ locked: 0b10 }, 1), 'locked')
  assert.equal(await p.step(null, 1), null)
})

test('picker : after 3 refused Cross presses, moves again', async () => {
  const c = clock()
  const r = recorder()
  const p = createPicker({ out: r.out, ...c, random: () => 0 })
  await p.step({ locked: 0 }, 0)
  for (let i = 0; i < 3; i++) { await c.sleep(1600); await p.step({ locked: 0 }, 0) }
  const crosses = r.log.filter((k) => k === 'c').length
  assert.equal(crosses, 4)
  assert.equal(r.log.at(-2), 'ArrowRight', `moved before the 4th : ${r.log.join(' ')}`)
})

// A French main menu : the ids drive the walk, the labels are only along for the ride (visited).
const FR_MAIN_MENU = ['AVENTURE', 'CONTRE LA MONTRE', 'ARCADE', 'VS.', 'BATAILLE', 'EN LIGNE', 'MEILLEURS SCORES', 'ALBUM']

test('menuTo : walks the rows to the id, checking each step — a French menu', async () => {
  const c = clock()
  let row = 0
  const out = { press: async (k) => { row += k === 'ArrowDown' ? 1 : -1 } }
  const read = async () => ({ menu: { row, id: MAIN_MENU_IDS[row], label: FR_MAIN_MENU[row] } })
  const visited = await menuTo({ read, out, id: MAIN_MENU.NETPLAY, rows: MAIN_MENU_IDS, settle: async () => {}, ...c })
  assert.deepEqual(visited, FR_MAIN_MENU.slice(0, 6))
  await assert.rejects(menuTo({ read, out: { press: async () => {} }, id: MAIN_MENU.ADVENTURE, rows: MAIN_MENU_IDS, settle: async () => {}, ...c }), /never left row 5/)
})

test('onMainMenu : true on a French main-menu row, false on a submenu or the pause menu', () => {
  assert.equal(onMainMenu({ screen: 'menu', menu: { input: true, id: MAIN_MENU['TIME TRIAL'], label: 'CONTRE LA MONTRE' } }), true)
  // Adventure's own New/Load submenu (game/230/D230.c rowsAdventure, id 0x8d) : not a main-menu row
  assert.equal(onMainMenu({ screen: 'menu', menu: { input: true, id: 0x8d, label: 'NOUVELLE' } }), false)
  // the pause menu's QUIT row (game/zGlobal_DATA.c rowsArcadeRace, id 0x3) : not a main-menu row
  assert.equal(onMainMenu({ screen: 'menu', menu: { input: true, id: 0x3, label: 'QUITTER' } }), false)
  assert.equal(onMainMenu({ screen: 'menu', menu: { input: false, id: MAIN_MENU.ADVENTURE, label: 'AVENTURE' } }), false)
  assert.equal(onMainMenu(null), false)
})

test('onMainMenu : true on the real bridge shape (__ctr.menu, platform/web_debug_bridge.c)', () => {
  const s = { screen: 'menu', menu: { title: '', row: 1, label: 'TIME TRIAL', id: MAIN_MENU['TIME TRIAL'], titleId: -1, locked: false, state: 0, input: true } }
  assert.equal(onMainMenu(s), true)
})

test('boot intro : the Naughty Dog crate and the title before its menu takes input, nothing after', () => {
  assert.equal(inBootIntro({ screen: 'cutscene', levelID: 41, menu: null }), true)
  assert.equal(inBootIntro({ screen: 'loading', levelID: 41, menu: null }), true)
  assert.equal(inBootIntro({ screen: 'menu', levelID: 39, menu: { label: 'ADVENTURE', input: false } }), true)
  assert.equal(inBootIntro({ screen: 'menu', levelID: 39, menu: { label: 'ADVENTURE', input: true } }), false)
  assert.equal(inBootIntro({ screen: 'race', levelID: 3, menu: null }), false)
  assert.equal(inBootIntro(null), false)
})
