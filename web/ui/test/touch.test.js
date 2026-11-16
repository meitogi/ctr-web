// The touch pad (src/lib/touch/) : fingers down / moved / up → the pad it yields ; the held
// accelerator's timings. Session 42.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PSX_BIT as B } from '../src/lib/guest-input.js'
import { HOLD_DELAY, createHold } from '../src/lib/touch/hold.js'
import { KINDS, hit, layout } from '../src/lib/touch/layouts.js'
import { PAD_ANALOG, PAD_DIGITAL, createTouchPad } from '../src/lib/touch/pad.js'

const MINI = { W: 812, H: 375, left: 47, right: 47, bottom: 21, top: 0 }
const MAX = { W: 932, H: 430, left: 59, right: 59, bottom: 21, top: 0 }
const at = (pad, id) => pad.controls.find((c) => c.id === id)
const centre = (c) => (c.type === 'button' || c.type === 'dpad' ? [c.cx, c.cy] : [c.x + c.w / 2, c.y + c.h / 2])
/** the packet's buttons as active-high bits, its id, its left stick */
function read(pad, racing = true, now = 0) {
  const p = new Uint8Array(8)
  const shown = pad.packet(p, 0, racing, now)
  return { shown, id: p[1], bits: ~(p[2] | (p[3] << 8)) & 0xffff, lx: p[6], ly: p[7] }
}
function make(kind, view = MINI, opts) {
  const pad = createTouchPad(opts)
  pad.place(kind, view)
  pad.show(true)
  return pad
}

test('every layout keeps its controls inside the safe areas, on both phones', () => {
  for (const view of [MINI, MAX]) {
    for (const kind of KINDS) {
      for (const c of layout(kind, view)) {
        const [x0, y0, x1, y1] = c.type === 'button' || c.type === 'dpad'
          ? [c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r]
          : [c.x, c.y, c.x + c.w, c.y + c.h]
        assert.ok(x0 >= view.left - 0.5 && x1 <= view.W - view.right + 0.5, `${kind}/${c.id} x ${x0}..${x1} on ${view.W}`)
        assert.ok(y0 >= -0.5 && y1 <= view.H - view.bottom + 0.5, `${kind}/${c.id} y ${y0}..${y1} on ${view.H}`)
      }
    }
  }
})

test('every button can be hit at its centre (no control hides another)', () => {
  for (const kind of KINDS) {
    const controls = layout(kind, MINI)
    for (const c of controls) {
      if (c.type === 'stick') continue
      const [x, y] = centre(c)
      assert.equal(hit(controls, x, y)?.id, c.id, `${kind}/${c.id}`)
    }
  }
})

test('hidden : no packet', () => {
  const pad = make('a')
  pad.show(false)
  assert.equal(read(pad).shown, 0)
})

test('minimal : the D-pad, its diagonals, Cross plain (never held)', () => {
  const pad = make('minimal', MINI, { hold: { delay: 100 } })
  const d = at(pad, 'dpad')
  pad.down(1, d.cx + d.r * 0.7, d.cy)
  assert.equal(read(pad).bits, B.right)
  pad.move(1, d.cx + d.r * 0.5, d.cy + d.r * 0.5)
  assert.equal(read(pad).bits, B.right | B.down)
  pad.move(1, d.cx, d.cy - d.r * 0.7)
  assert.equal(read(pad).bits, B.up)
  pad.up(1)
  const [x, y] = centre(at(pad, 'cross'))
  pad.down(2, x, y)
  assert.equal(read(pad, true, 0).bits, B.cross)
  assert.equal(read(pad, true, 500).bits, B.cross)
  pad.up(2)
  assert.equal(read(pad, true, 600).bits, 0, 'the minimal pad never holds Cross')
  assert.equal(read(pad).id, PAD_DIGITAL)
})

test('a finger slides from one button onto the next', () => {
  const pad = make('minimal')
  pad.down(1, ...centre(at(pad, 'square')))
  assert.equal(read(pad).bits, B.square)
  pad.move(1, ...centre(at(pad, 'cross')))
  assert.equal(read(pad).bits, B.cross)
  pad.move(1, 400, 30)
  assert.equal(read(pad).bits, 0, 'off every control : nothing')
})

test('A : the floating stick is centred where the thumb lands, analog, clamped', () => {
  const pad = make('a')
  const z = at(pad, 'steer')
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(1, ox, oy)
  let r = read(pad)
  assert.equal(r.id, PAD_ANALOG)
  assert.deepEqual([r.lx, r.ly], [0x80, 0x80], 'where it lands is the centre')
  pad.move(1, ox + z.reach / 2, oy)
  r = read(pad)
  assert.ok(r.lx > 0xb0 && r.lx < 0xd0, `half right : ${r.lx}`)
  pad.move(1, ox - z.reach * 3, oy)
  assert.equal(read(pad).lx, 1, 'full left, clamped')
  pad.move(1, ox, oy + z.reach)
  assert.equal(read(pad).ly, 255, 'down')
  pad.up(1)
  assert.deepEqual([read(pad).lx, read(pad).ly], [0x80, 0x80])
})

test('several fingers at once : steer + GO + R + item in the same update', () => {
  const pad = make('a')
  const z = at(pad, 'steer')
  pad.down(1, z.x + 60, z.y + 100)
  pad.move(1, z.x + 60 - z.reach, z.y + 100)
  pad.down(2, ...centre(at(pad, 'go')))
  pad.down(3, ...centre(at(pad, 'slide')))
  pad.down(4, ...centre(at(pad, 'item')))
  const r = read(pad)
  assert.equal(r.bits, B.cross | B.r1 | B.circle)
  assert.ok(r.lx < 0x10, `steering left : ${r.lx}`)
})

test('A : a finger started on R keeps R wherever it goes ; rolled over BOOST it adds L1', () => {
  const pad = make('a')
  pad.down(1, ...centre(at(pad, 'slide')))
  assert.equal(read(pad).bits, B.r1)
  pad.move(1, ...centre(at(pad, 'boost')))
  assert.equal(read(pad).bits, B.r1 | B.l1)
  pad.move(1, ...centre(at(pad, 'slide')))
  assert.equal(read(pad).bits, B.r1, 'back off BOOST : L1 let go, R kept')
  pad.move(1, 300, 60)
  assert.equal(read(pad).bits, B.r1, 'anywhere : R kept')
})

test('B : the glide — GO, GO + R, + BOOST without lifting ; off them, the last kept', () => {
  const pad = make('b', MINI, { hold: { enabled: false } })
  pad.down(1, ...centre(at(pad, 'go')))
  assert.equal(read(pad).bits, B.cross)
  pad.move(1, ...centre(at(pad, 'slide')))
  assert.equal(read(pad).bits, B.cross | B.r1)
  pad.move(1, ...centre(at(pad, 'boost')))
  assert.equal(read(pad).bits, B.cross | B.r1 | B.l1)
  pad.move(1, ...centre(at(pad, 'slide')))
  assert.equal(read(pad).bits, B.cross | B.r1, 'back down : L1 let go')
  pad.move(1, 300, 60)
  assert.equal(read(pad).bits, B.cross | B.r1, 'off the pad : the last kept')
  pad.up(1)
  assert.equal(read(pad).bits, 0)
})

test('C : left / right buttons, digital, slid across', () => {
  const pad = make('c')
  pad.down(1, ...centre(at(pad, 'left')))
  assert.equal(read(pad).bits, B.left)
  pad.move(1, ...centre(at(pad, 'right')))
  assert.equal(read(pad).bits, B.right)
  assert.equal(read(pad).id, PAD_DIGITAL)
})

test('the held accelerator : plain before the delay, locked after, the thumb then free', () => {
  const pad = make('a')
  const go = centre(at(pad, 'go'))
  pad.down(1, ...go)
  assert.equal(read(pad, true, 0).bits, B.cross, 'a plain press first (the start boost is the player\'s)')
  pad.up(1)
  assert.equal(read(pad, true, HOLD_DELAY - 100).bits, 0, 'lifted before the delay : let go')
  pad.down(1, ...go)
  read(pad, true, 1000)
  assert.equal(read(pad, true, 1000 + HOLD_DELAY - 1).bits, B.cross)
  assert.equal(pad.hold.state, 'pressing')
  assert.equal(read(pad, true, 1000 + HOLD_DELAY).bits, B.cross)
  assert.equal(pad.hold.state, 'held')
  pad.up(1)
  assert.equal(read(pad, true, 3000).bits, B.cross, 'locked : the finger left, Cross stays')
  pad.down(2, ...centre(at(pad, 'slide')))
  assert.equal(read(pad, true, 3100).bits, B.cross | B.r1, 'the right thumb free for R')
})

test('the held accelerator lets go : the brake, a tap on GO, the race\'s end ; off in Settings', () => {
  const lock = (pad, t0) => {
    pad.down(9, ...centre(at(pad, 'go')))
    read(pad, true, t0)
    read(pad, true, t0 + HOLD_DELAY)
    pad.up(9)
    read(pad, true, t0 + HOLD_DELAY + 30)
    assert.equal(pad.hold.state, 'held')
  }
  const pad = make('a')
  lock(pad, 0)
  pad.down(1, ...centre(at(pad, 'brake')))
  assert.equal(read(pad, true, 2000).bits, B.square, 'the brake : Cross let go')
  pad.up(1)
  assert.equal(read(pad, true, 2100).bits, 0, 'and stays let go')

  lock(pad, 3000)
  pad.down(1, ...centre(at(pad, 'go')))
  read(pad, true, 5000)
  pad.up(1)
  assert.equal(read(pad, true, 5100).bits, 0, 'a tap on GO : let go')

  lock(pad, 6000)
  assert.equal(read(pad, false, 8000).bits, 0, 'not racing (pause, menu, end) : let go')
  assert.equal(read(pad, true, 8100).bits, 0, 'and not taken back by itself')

  const off = make('a', MINI, { hold: { enabled: false } })
  off.down(1, ...centre(at(off, 'go')))
  read(off, true, 0)
  assert.equal(read(off, true, 5000).bits, B.cross)
  off.up(1)
  assert.equal(read(off, true, 5100).bits, 0, 'off : GO is a plain button')
})

test('the hold never locks outside a race', () => {
  const h = createHold({ delay: 100 })
  h.update(0, { go: true, racing: false })
  h.update(500, { go: true, racing: false })
  assert.equal(h.state, 'idle')
  assert.equal(h.update(600, { go: false, racing: false }), false)
})

test('the hold : a long press again on a locked GO keeps it locked ; the delay is configurable', () => {
  const h = createHold({ delay: 400 })
  h.update(0, { go: true })
  h.update(400, { go: true })
  h.update(450, { go: false })
  h.update(1000, { go: true })
  assert.equal(h.state, 'retouched')
  h.update(1600, { go: false })
  assert.equal(h.state, 'held')
  h.configure({ delay: 1200 })
  h.reset()
  h.update(0, { go: true })
  h.update(1199, { go: true })
  assert.equal(h.state, 'pressing')
  h.update(1200, { go: true })
  assert.equal(h.state, 'held')
})

test('racing changes are told once', () => {
  const pad = make('a')
  const seen = []
  pad.onRacing = (r) => seen.push(r)
  read(pad, true)
  read(pad, true)
  read(pad, false)
  assert.deepEqual(seen, [true, false])
})

test('a tap shorter than one input update still reaches the game, once', () => {
  const pad = make('menu')
  pad.down(1, ...centre(at(pad, 'triangle')))
  pad.up(1)
  assert.equal(read(pad).bits, B.triangle, 'the tap, at the next pull')
  assert.equal(read(pad).bits, 0, 'and only that one')
})

test('a quick tap on a locked GO lets it go even between two pulls', () => {
  const pad = make('a')
  pad.down(1, ...centre(at(pad, 'go')))
  read(pad, true, 0)
  read(pad, true, HOLD_DELAY)
  pad.up(1)
  read(pad, true, HOLD_DELAY + 30)
  assert.equal(pad.hold.state, 'held')
  pad.down(1, ...centre(at(pad, 'go')))
  pad.up(1)
  read(pad, true, 2000)
  assert.equal(read(pad, true, 2030).bits, 0, 'tapped between two pulls : let go')
})

test('the analog id can be kept for a whole mode (menus included)', () => {
  const pad = make('menu')
  assert.equal(read(pad).id, PAD_DIGITAL)
  pad.analog = true
  assert.equal(read(pad).id, PAD_ANALOG)
})
