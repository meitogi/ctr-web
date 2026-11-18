// The first-race tutorial's cards (src/lib/touch/tutorial.js) : one an action, for the pad in use.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fromPalette, startFrom } from '../src/lib/touch/custom.js'
import { layout } from '../src/lib/touch/layouts.js'
import { CARDS, PARTS, cards } from '../src/lib/touch/tutorial.js'

const MINI = { W: 812, H: 375, left: 47, right: 47, bottom: 21, top: 0 }
const say = (controls) => cards(controls).map((c) => `${c.id}:${c.parts.join('+')}`)

test('the default (E) : the six actions, the right half and the stick lit', () => {
  const list = cards(layout('e', MINI))
  assert.deepEqual(list.map((c) => c.id), CARDS)
  assert.deepEqual(say(layout('e', MINI)), ['go:steerStick+goGesture', 'start:startGesture', 'slide:slideGesture', 'items:itemSwipe', 'brake:brakeStick', 'look:look'])
  assert.deepEqual(list[0].targets, ['steer', 'right'])
  assert.deepEqual(list[4].targets, ['steer'], 'the brake is the stick')
  assert.deepEqual(list[5].targets, ['look'])
})

test('each layout gets the same six actions, said for its own controls', () => {
  assert.deepEqual(say(layout('a', MINI)), ['go:steerStick+goButton', 'start:startButton', 'slide:slideButton', 'items:itemButton', 'brake:brakeButton', 'look:look'])
  assert.deepEqual(cards(layout('a', MINI))[2].targets, ['slide', 'boost'])
  assert.deepEqual(say(layout('b', MINI))[2], 'slide:slideGlide')
  assert.deepEqual(cards(layout('b', MINI))[2].targets, ['go', 'slide', 'boost'])
  assert.deepEqual(say(layout('c', MINI)), ['go:steerArrows+goButton', 'start:startButton', 'slide:slidePad', 'items:itemButton', 'brake:brakeButton', 'look:look'])
  assert.deepEqual(say(layout('d', MINI))[2], 'slide:slideButtonAlone')
  assert.deepEqual(say(layout('minimal', MINI)).slice(0, 4), ['go:steerDpad+goPad', 'start:startPad', 'slide:slidePad', 'items:itemButton'])
  assert.deepEqual(say(startFrom('three', MINI)).map((c) => c.split(':')[0]), CARDS)
})

test('the player\'s own pad : an action with no control has no card', () => {
  const bare = layout('a', MINI).filter((c) => !['brake', 'look', 'item'].includes(c.id))
  assert.deepEqual(cards(bare).map((c) => c.id), ['go', 'start', 'slide'])
  const both = [...bare, fromPalette('itemUp', bare, MINI, 'm', 300, 100), fromPalette('itemDown', bare, MINI, 'm', 360, 100)]
  const items = cards(both).find((c) => c.id === 'items')
  assert.deepEqual([items.parts, items.targets], [['itemButtons'], ['itemUp', 'itemDown']])
  assert.deepEqual(cards([]), [])
})

test('every text a card can say exists in every language', async () => {
  const { STRINGS } = await import('../src/lib/strings.js')
  for (const lang in STRINGS) {
    const t = STRINGS[lang].tutorial
    for (const k of PARTS) assert.equal(typeof t.text[k], 'string', `${lang} text.${k}`)
    for (const k of CARDS) assert.equal(typeof t.titles[k], 'string', `${lang} titles.${k}`)
    for (const k of ['skip', 'next', 'back', 'play', 'again', 'againHelp']) assert.equal(typeof t[k], 'string', `${lang} ${k}`)
  }
  for (const list of [layout('e', MINI), layout('a', MINI), layout('b', MINI), layout('c', MINI), layout('d', MINI), layout('minimal', MINI)]) for (const c of cards(list)) for (const k of c.parts) assert.ok(PARTS.includes(k), k)
})

test('settings : the tutorial is new until seen ; « again » asks for it', async () => {
  const { KEYS, createSettings } = await import('../src/lib/settings.js')
  const map = new Map()
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
  const st = createSettings(storage, { random: () => 0 })
  assert.equal(st.get().touchTutorial, null)
  st.patch({ touchTutorial: 'seen' })
  assert.equal(map.get(KEYS.touchTutorial), '1')
  assert.equal(createSettings(storage).get().touchTutorial, 'seen')
  st.patch({ touchTutorial: 'new' })
  assert.equal(map.get(KEYS.touchTutorial), '0')
  assert.equal(createSettings(storage).get().touchTutorial, 'new')
  st.patch({ touchTutorial: 'nonsense' })
  assert.equal(map.has(KEYS.touchTutorial), false)
})

test('the pause under the page\'s screens : Start tapped until the game takes it, resumed after', async () => {
  const { pauseGame } = await import('../src/lib/touch/pause.js')
  const make = (racing) => { const taps = []; return { racing, taps, pending: false, tap(b) { taps.push(b); this.pending = true }, untap() { const p = this.pending; this.pending = false; if (p) taps.pop(); return p } } }
  let tick = null
  const opts = { timer: (fn) => { tick = fn; return 1 }, clear: () => { tick = null } }
  // taken at the second try, resumed at the close
  const pad = make(true)
  const p = pauseGame(pad, opts)
  assert.equal(pad.taps.length, 1, 'at once')
  pad.pending = false // the game read it, and refused (the flag still on screen)
  tick()
  assert.equal(pad.taps.length, 2, 'again')
  pad.pending = false
  pad.racing = false
  tick()
  assert.deepEqual([pad.taps.length, tick], [2, null], 'paused : no more taps')
  p.release()
  assert.deepEqual([pad.taps.length, pad.taps[0]], [3, 0x8], 'resumed')
  pad.pending = false
  tick()
  assert.equal(pad.taps.length, 4, 'the resume swallowed by the game\'s cooldown : again')
  pad.racing = true
  for (let i = 0; i < 6 && tick; i++) tick()
  assert.deepEqual([pad.taps.length, tick], [4, null], 'driven again : it stops')
  // closed before the game was given the pause : the tap is dropped, nothing pauses
  const quick = make(true)
  pauseGame(quick, opts).release()
  assert.equal(quick.taps.length, 0)
  for (let i = 0; i < 6 && tick; i++) tick()
  assert.deepEqual([quick.taps.length, tick], [0, null])
  // closed while the game was taking it : the pause lands after, and is undone
  const late = make(true)
  const l = pauseGame(late, opts)
  late.pending = false
  l.release()
  assert.equal(late.taps.length, 1)
  late.racing = false
  tick()
  assert.equal(late.taps.length, 2, 'resumed once it landed')
  // nothing to pause in the menus, nothing to resume
  const menu = make(false)
  pauseGame(menu, opts).release()
  assert.equal(menu.taps.length, 0)
})

test('the pad drops a tap the game has not been given ; one in flight stays', async () => {
  const { createTouchPad } = await import('../src/lib/touch/pad.js')
  const pad = createTouchPad()
  pad.place('e', MINI)
  const pk = (t) => { const p = new Uint8Array(8); return pad.packet(p, 0, true, t) }
  pad.tap(0x8)
  assert.equal(pad.untap(), true)
  assert.equal(pk(10), 0, 'nothing sent')
  pad.tap(0x8)
  assert.equal(pk(20), 1)
  assert.equal(pad.untap(), false, 'already given')
  assert.equal(pk(60), 1)
})

test('a pad with none of the six actions has no card (the tutorial closes itself)', () => {
  assert.deepEqual(cards([{ id: 'start', type: 'rect', bits: 0x8, label: 'II' }, { id: 'triangle', type: 'button', bits: 0x1000, label: 'TRI' }]), [])
})
