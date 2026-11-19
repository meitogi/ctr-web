// « My pad » (src/lib/touch/custom.js) : a layout as the browser keeps it, there and back.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PSX_BIT as B } from '../src/lib/guest-input.js'
import { PALETTE, STARTS, centre, cleanSpec, freeId, fromPalette, fromSpec, missing, moveTo, scaleTo, startFrom, toSpec } from '../src/lib/touch/custom.js'
import { hit, layout } from '../src/lib/touch/layouts.js'
import { createTouchPad } from '../src/lib/touch/pad.js'
import { createSettings, touchTraits } from '../src/lib/settings.js'

const MINI = { W: 812, H: 375, left: 47, right: 47, bottom: 21, top: 0 }
const MAX = { W: 932, H: 430, left: 59, right: 59, bottom: 21, top: 0 }
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what} : ${a} vs ${b}`)

test('every built-in layout goes to a spec and back unchanged, flags and bits kept', () => {
  for (const name of STARTS) {
    const controls = startFrom(name, MINI)
    const spec = cleanSpec(JSON.stringify(toSpec(controls, MINI, 'm', name)))
    assert.ok(spec, name)
    assert.equal(spec.from, name)
    const back = fromSpec(spec, MINI)
    assert.equal(back.length, controls.length, name)
    for (const c of controls) {
      const b = back.find((k) => k.id === c.id)
      const [x, y] = centre(c)
      const [bx, by] = centre(b)
      near(bx, x, `${name} ${c.id} x`)
      near(by, y, `${name} ${c.id} y`)
      if (c.r) near(b.r, c.r, `${name} ${c.id} r`)
      if (c.w) near(b.w, c.w, `${name} ${c.id} w`)
      if (c.reach) near(b.reach, c.reach, `${name} ${c.id} reach`)
      assert.equal(b.bits, c.bits, `${name} ${c.id} bits`)
      for (const f of ['go', 'anchor', 'boost', 'boosts', 'gesture', 'brake', 'back', 'group']) assert.equal(b[f] ?? false, c[f] ?? false, `${name} ${c.id} ${f}`)
    }
  }
})

test('a spec follows another phone : each control keeps its distance from its corner', () => {
  const spec = toSpec(layout('a', MINI), MINI, 'm', 'a')
  const mini = fromSpec(spec, MINI)
  const big = fromSpec(spec, MAX)
  const u = MAX.H / MINI.H
  const go = (list) => list.find((c) => c.id === 'go')
  near(MAX.W - MAX.right - go(big).cx, (MINI.W - MINI.right - go(mini).cx) * u, 'GO from the right edge')
  near(MAX.H - MAX.bottom - go(big).cy, (MINI.H - MINI.bottom - go(mini).cy) * u, 'GO from the bottom')
  near(go(big).r, go(mini).r * u, 'GO scaled with the screen')
})

test('the sticks\' zones come first : a button over a zone stays the one touched', () => {
  const controls = [fromPalette('go', [], MINI, 'm', 150, 250), ...layout('e', MINI)]
  const back = fromSpec(toSpec(controls, MINI), MINI)
  assert.equal(back[0].type, 'stick')
  assert.equal(hit(back, 150, 250).id, 'go')
})

test('the palette : a control added gets a free id, its bits and flags ; the super buttons are marked', () => {
  const controls = layout('a', MINI)
  const boost = fromPalette('boost', controls, MINI, 'm', 400, 100)
  assert.equal(boost.id, 'boost-2')
  assert.equal(boost.bits, B.l1)
  assert.equal(boost.boost, true)
  assert.equal(freeId([...controls, boost], 'boost'), 'boost-3')
  assert.equal(fromPalette('itemDown', controls, MINI, 'm', 0, 0).bits, B.circle | B.down)
  assert.equal(fromPalette('itemUp', controls, MINI, 'm', 0, 0).bits, B.circle | B.up)
  const supers = Object.keys(PALETTE).filter((k) => PALETTE[k].super)
  assert.deepEqual(supers, ['stick', 'go', 'slide', 'boost', 'gesture', 'itemUp', 'itemDown', 'brake'])
})

test('a stored spec is not trusted : junk dropped, values clamped, pause required', () => {
  assert.equal(cleanSpec('not json'), null)
  assert.equal(cleanSpec({ controls: [{ id: 'go', type: 'button' }] }), null, 'no pause : not a pad')
  const spec = cleanSpec({ from: 'e', controls: [
    { id: 'start', type: 'rect', ax: 'l', ay: 't', dx: 10, dy: 10, w: 46, h: 28, bits: B.start, label: 'II' },
    { id: 'go', type: 'button', ax: 'r', ay: 'b', dx: 1e9, dy: -5, r: 9999, s: 50, o: 0, bits: 0x4000 | 0x10000, label: 'A very long label indeed', go: true, evil: true },
    { id: 'go', type: 'button' },
    { id: 'x', type: 'iframe' },
    null,
  ] })
  assert.equal(spec.controls.length, 2)
  const go = spec.controls[1]
  assert.deepEqual([go.dx, go.dy, go.r, go.s, go.o, go.bits, go.label.length, go.go, go.evil], [2000, 0, 120, 1.6, 0.2, 0x4000, 12, true, undefined])
})

test('what a pad lacks : no accelerator, no steering (a warning, not a refusal)', () => {
  assert.deepEqual(missing(layout('e', MINI)), { go: false, steer: false })
  assert.deepEqual(missing(layout('c', MINI)), { go: false, steer: false }, 'left and right buttons steer')
  assert.deepEqual(missing(layout('e', MINI).filter((c) => !c.go)), { go: true, steer: false })
  assert.deepEqual(missing(layout('a', MINI).filter((c) => c.type !== 'stick')), { go: false, steer: true })
})

const MINI_UP = { W: 375, H: 812, left: 0, right: 0, top: 50, bottom: 34 }
const GAME_BOTTOM = MINI_UP.top + MINI_UP.W * 0.75
const top = (c) => (c.type === 'button' || c.type === 'dpad' ? c.cy - c.r : c.y)

test('portrait : every start goes to a spec and back unchanged, in the band under the game', () => {
  for (const name of STARTS) {
    const controls = startFrom(name, MINI_UP)
    for (const c of controls) assert.ok(top(c) >= GAME_BOTTOM, `${name} ${c.id} under the game : ${top(c)}`)
    const back = fromSpec(cleanSpec(JSON.stringify(toSpec(controls, MINI_UP, 'm', name))), MINI_UP)
    for (const c of controls) {
      const [x, y] = centre(c)
      const [bx, by] = centre(back.find((k) => k.id === c.id))
      near(bx, x, `${name} ${c.id} x`)
      near(by, y, `${name} ${c.id} y`)
    }
  }
})

test('portrait : a pad made in landscape opens in the band, its corners kept ; an added control lands there, a drag stays there', () => {
  const spec = toSpec(layout('a', MINI), MINI, 'm', 'a')
  const up = fromSpec(spec, MINI_UP)
  for (const c of up) assert.ok(top(c) >= GAME_BOTTOM, `${c.id} : ${top(c)}`)
  const go = up.find((c) => c.id === 'go')
  assert.ok(go.cx > MINI_UP.W / 2 && go.cy > MINI_UP.H * 0.8, 'GO still bottom right')
  const moved = moveTo(go, 100, 0, MINI_UP)
  assert.ok(moved.cy >= GAME_BOTTOM, `dragged onto the game : kept under it (${moved.cy})`)
  const added = fromPalette('brake', up, MINI_UP, 'm', 100, 600)
  assert.equal(added.cy, 600)
  assert.ok(added.r < fromPalette('brake', [], MINI, 'm', 100, 100).r, 'smaller upright')
})

test('moving keeps a control inside the safe area ; scaling keeps its centre', () => {
  const go = layout('a', MINI).find((c) => c.id === 'go')
  const moved = moveTo(go, 5000, -40, MINI)
  assert.deepEqual([moved.cx, moved.cy], [MINI.W - MINI.right, 8])
  const zone = layout('e', MINI).find((c) => c.id === 'right')
  const big = scaleTo(zone, 1.3)
  near(centre(big)[0], centre(zone)[0], 'x')
  near(big.w, zone.w * 1.3, 'w')
  assert.equal(scaleTo(go, 9).scale, 1.6)
  near(scaleTo(scaleTo(go, 1.5), 1).r, go.r, 'back to its size')
})

const packet = (pad, racing, t) => { const p = new Uint8Array(8); const ok = pad.packet(p, 0, racing, t); return { ok, id: p[1], bits: ~(p[2] | (p[3] << 8)) & 0xffff } }

test('the pad plays « mine » : its controls, analog with a stick, an item button holding its direction', () => {
  const controls = [...layout('a', MINI), fromPalette('itemDown', layout('a', MINI), MINI, 'm', 400, 120)]
  const spec = cleanSpec(toSpec(controls, MINI, 'm', 'a'))
  const pad = createTouchPad()
  pad.show(true)
  assert.equal(pad.place('mine', MINI, 'm', spec), true)
  assert.equal(pad.place('mine', MINI, 'm', spec), false, 'the same spec : not placed again')
  assert.equal(pad.controls.length, controls.length)
  pad.down(1, 400, 120, 0)
  const p = packet(pad, true, 10)
  assert.equal(p.id, 0x73)
  assert.equal(p.bits, B.circle | B.down)
  pad.up(1, 50)
  assert.deepEqual(pad.view, MINI)
})

test('the page\'s own tap (Start, the pause) reaches the game shown or hidden, 100 ms', () => {
  const pad = createTouchPad()
  pad.place('e', MINI)
  assert.equal(packet(pad, true, 0).ok, 0, 'hidden : the slot left alone')
  pad.tap(B.start)
  assert.deepEqual([packet(pad, true, 10).ok, packet(pad, true, 20).bits], [1, B.start])
  assert.equal(packet(pad, true, 200).ok, 0, 'over')
  pad.show(true)
  pad.tap(B.start)
  assert.equal(packet(pad, true, 300).bits, B.start)
  assert.equal(packet(pad, true, 450).bits, 0)
})

test('settings : « mine » only while a pad is kept ; the traits of the layout in use', () => {
  const map = new Map()
  const storage = { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }
  const st = createSettings(storage, { random: () => 0 })
  st.patch({ touchLayout: 'mine' })
  assert.equal(st.get().touchLayout, 'e', 'no pad kept : the default')
  const spec = toSpec(layout('a', MINI), MINI, 'm', 'a')
  st.patch({ touchCustom: spec, touchLayout: 'mine' })
  assert.equal(st.get().touchLayout, 'mine')
  assert.deepEqual(touchTraits(st.get()), { stick: true, gesture: false, retap: true, slideHold: true, slide: true, rock: true })
  const kept = st.get().touchCustom
  st.patch({ muted: true })
  assert.equal(st.get().touchCustom, kept, 'another setting changed : the same pad, the same object (the fingers are not let go)')
  const again = createSettings(storage, { random: () => 0 })
  assert.equal(again.get().touchLayout, 'mine', 'kept by the browser')
  assert.equal(again.get().touchCustom.controls.length, spec.controls.length)
  st.patch({ touchCustom: null })
  assert.equal(st.get().touchLayout, 'e', 'the pad reset : back to the default')
  assert.equal(map.has('ctr-ui.touch-custom'), false)
  assert.deepEqual(touchTraits({ touchLayout: 'e' }), { stick: true, gesture: true, retap: false, slideHold: false, slide: false, rock: false })
  assert.deepEqual(touchTraits({ touchLayout: 'c' }), { stick: false, gesture: false, retap: false, slideHold: true, slide: true, rock: true })
})
