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

test('the slide kept through a lift : a re-touch on R inside the window taps L1 (the boost), R1 never let go', () => {
  const pad = make('a')
  pad.slideMs = 300
  const r = centre(at(pad, 'slide'))
  pad.down(1, ...r, 0)
  assert.equal(read(pad, true, 0).bits, B.r1)
  pad.up(1, 100)
  assert.equal(read(pad, true, 150).bits, B.r1, 'lifted : R1 still held')
  pad.down(1, ...r, 250)
  assert.equal(read(pad, true, 260).bits, B.r1 | B.l1, 'touched again inside the window : the boost')
  assert.equal(read(pad, true, 400).bits, B.r1, 'the boost a tap ; R1 held by the finger')
  pad.up(1, 500)
  assert.equal(read(pad, true, 700).bits, B.r1)
  assert.equal(read(pad, true, 801).bits, 0, 'no touch inside the window : R1 let go, the slide ends')
})

test('the slide kept through a lift : the brake, the menus or off end it at once ; never outside a race', () => {
  const pad = make('a')
  pad.slideMs = 300
  const r = centre(at(pad, 'slide'))
  pad.down(1, ...r, 0)
  read(pad, true, 0)
  pad.up(1, 50)
  pad.down(2, ...centre(at(pad, 'brake')), 60)
  assert.equal(read(pad, true, 70).bits, B.square, 'the brake : R1 let go')
  pad.up(2, 80)
  pad.down(1, ...r, 100)
  assert.equal(read(pad, true, 110).bits, B.r1, 'R again after the brake : a new hop, no boost')
  pad.up(1, 120)
  assert.equal(read(pad, false, 130).bits, 0, 'not racing : let go')
  const off = make('a')
  off.down(1, ...r, 0)
  read(off, true, 0)
  off.up(1, 50)
  assert.equal(read(off, true, 60).bits, 0, 'slideMs 0 : off')
})

test('B : the glide lifted on GO + R keeps the slide ; back on GO + R = the boost', () => {
  const pad = make('b', MINI, { hold: { enabled: false } })
  pad.slideMs = 300
  pad.down(1, ...centre(at(pad, 'slide')), 0)
  assert.equal(read(pad, true, 0).bits, B.cross | B.r1)
  pad.up(1, 100)
  assert.equal(read(pad, true, 120).bits & B.r1, B.r1)
  pad.down(1, ...centre(at(pad, 'slide')), 200)
  assert.equal(read(pad, true, 210).bits, B.cross | B.r1 | B.l1)
})

test('the rock : a thumb on R lowered (its point moves down) taps L1 once ; raised, armed again', () => {
  const pad = make('a')
  pad.rockPx = 9
  const [x, y] = centre(at(pad, 'slide'))
  pad.down(1, x, y, 0)
  assert.equal(read(pad, true, 0).bits, B.r1)
  pad.move(1, x, y - 4)
  pad.move(1, x, y + 4)
  assert.equal(read(pad, true, 30).bits, B.r1, 'rests higher, then 8 px down from there : nothing yet')
  pad.move(1, x, y + 6)
  assert.equal(read(pad, true, 60).bits, B.r1 | B.l1, '10 px : the boost')
  assert.equal(read(pad, true, 200).bits, B.r1, 'a tap, R kept')
  pad.move(1, x, y + 12)
  assert.equal(read(pad, true, 230).bits, B.r1, 'still down : no second boost')
  pad.move(1, x, y - 3)
  pad.move(1, x, y + 8)
  assert.equal(read(pad, true, 260).bits, B.r1 | B.l1, 'raised then lowered : the next boost')
})

test('the rock by the contact\'s width (where the browser gives one), and off at 0', () => {
  const pad = make('a')
  pad.rockPx = 9
  const [x, y] = centre(at(pad, 'slide'))
  pad.down(1, x, y, 0, 20)
  pad.move(1, x, y + 2, 32)
  assert.equal(read(pad, true, 10).bits, B.r1 | B.l1)
  const off = make('a')
  off.down(1, x, y, 0)
  off.move(1, x, y + 30)
  assert.equal(read(off, true, 10).bits, B.r1)
})

test('the held slide : R kept 0.5 s in a slide holds R1 ; a tap boosts ; a double tap lets go', () => {
  const pad = make('d')
  pad.slideHoldMs = 500
  const r = centre(at(pad, 'slide'))
  const pk = (t, slide = true) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, slide); return ~(p[2] | (p[3] << 8)) & 0xffff }
  pad.down(1, ...r, 0)
  pk(0, false)
  pk(100, true)
  assert.equal(pad.slideLock, 'pressing')
  pk(599, true)
  assert.equal(pad.slideLock, 'pressing')
  pk(600, true)
  assert.equal(pad.slideLock, 'held')
  pad.up(1, 650)
  assert.equal(pk(700), B.r1, 'lifted : R1 held')
  pad.down(1, ...r, 1000)
  assert.equal(pk(1010), B.r1 | B.l1, 'a tap : the boost')
  pad.up(1, 1080)
  assert.equal(pk(1200), B.r1, 'still held')
  pad.down(1, ...r, 1500)
  pad.up(1, 1560)
  pad.down(1, ...r, 1700)
  assert.equal(pk(1710) & B.r1, 0, 'a double tap : R1 let go, even with the finger on R')
  assert.equal(pad.slideLock, 'idle')
  pad.up(1, 1760)
})

test('the held slide ends with the game\'s slide, the brake, and never locks outside a slide', () => {
  const pad = make('d')
  pad.slideHoldMs = 500
  const r = centre(at(pad, 'slide'))
  const pk = (t, slide = true) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, slide); return ~(p[2] | (p[3] << 8)) & 0xffff }
  pad.down(1, ...r, 0)
  pk(0, false)
  pk(900, false)
  assert.equal(pad.slideLock, 'idle', 'no slide (a hop) : never held')
  pk(1000, true)
  pk(1600, true)
  assert.equal(pad.slideLock, 'held')
  pad.up(1, 1700)
  assert.equal(pk(1800, false), 0, 'the game ended the slide : R1 let go')
  pad.down(1, ...r, 2000)
  pk(2000, true)
  pk(2600, true)
  pad.up(1, 2650)
  pad.down(2, ...centre(at(pad, 'brake')), 2700)
  assert.equal(pk(2710) & B.r1, 0, 'the brake lets go')
})

test('the held slide tells its state, a double tap\'s « idle » included', () => {
  const pad = make('d')
  pad.slideHoldMs = 500
  const seen = []
  pad.onSlide = (s) => seen.push(s)
  const r = centre(at(pad, 'slide'))
  const pk = (t) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, true) }
  pad.down(1, ...r, 0)
  pk(0)
  pk(600)
  pad.up(1, 650)
  pad.down(1, ...r, 1000)
  pad.up(1, 1050)
  pad.down(1, ...r, 1150)
  pk(1160)
  pad.up(1, 1200)
  assert.deepEqual(seen, ['pressing', 'held', 'idle'])
})

test('the boost\'s moment (the game\'s red meter) is told once each way', () => {
  const pad = make('a')
  const seen = []
  pad.onWindow = (w) => seen.push(w)
  const pk = (t, red) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, true, red) }
  pk(0, false)
  pk(10, true)
  pk(20, true)
  pk(30, false)
  assert.deepEqual(seen, [true, false])
})

test('the steering\'s sensitivity : full lock sooner, small moves turn harder', () => {
  const pad = make('a')
  const z = at(pad, 'steer')
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(1, ox, oy)
  pad.move(1, ox + z.reach * 0.2, oy)
  const plain = read(pad).lx
  pad.steer = { reach: 0.65, curve: 0.7 }
  const medium = read(pad).lx
  assert.ok(medium > plain + 20, `a small move turns harder : ${plain} → ${medium}`)
  pad.move(1, ox + z.reach * 0.65, oy)
  assert.equal(read(pad).lx, 255, 'full lock at 0.65 of the reach')
})

test('the slide from the stick : lift while turning, touch again → R1, the same direction and force', () => {
  const pad = make('a')
  pad.retapMs = 250
  const z = at(pad, 'steer')
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(1, ox, oy, 0)
  pad.move(1, ox + z.reach * 0.8, oy)
  const before = read(pad, true, 10)
  assert.equal(before.bits, 0)
  pad.up(1, 100)
  assert.equal(read(pad, true, 150).lx, before.lx, 'lifted : the stick stays where it was')
  pad.down(1, ox + 30, oy + 20, 200)
  const slide = read(pad, true, 210)
  assert.equal(slide.bits, B.r1, 'touched again : the slide (R1)')
  assert.equal(slide.lx, before.lx, 'the same direction and force, not a new centre')
  pad.move(1, ox + 30 - z.reach * 0.3, oy + 20)
  assert.ok(read(pad, true, 260).lx < before.lx, 'and it steers on from there')
  pad.up(1, 300)
  assert.equal(read(pad, true, 310).bits, 0, 'lifted : the slide ends')
})

test('the slide from the stick : not after the window, not from a centred stick ; R tapped meanwhile = the boost', () => {
  const pad = make('a')
  pad.retapMs = 250
  const z = at(pad, 'steer')
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(1, ox, oy, 0)
  pad.move(1, ox + z.reach * 0.8, oy)
  read(pad, true, 10)
  pad.up(1, 100)
  assert.equal(read(pad, true, 400).lx, 0x80, 'the window over : centred')
  pad.down(1, ox, oy, 450)
  assert.equal(read(pad, true, 460).bits, 0, 'a late touch : steering, no slide')
  pad.up(1, 500)
  pad.down(1, ox, oy, 550)
  assert.equal(read(pad, true, 560).bits, 0, 'lifted centred : no slide')
  pad.move(1, ox - z.reach, oy)
  read(pad, true, 570)
  pad.up(1, 600)
  pad.down(1, ox, oy, 650)
  assert.equal(read(pad, true, 660).bits, B.r1)
  pad.down(2, ...centre(at(pad, 'slide')), 700)
  assert.equal(read(pad, true, 710).bits, B.r1 | B.l1, 'R tapped in the stick\'s slide : the boost')
  pad.up(2, 760)
  assert.equal(read(pad, true, 900).bits, B.r1, 'the slide on')
})

test('the held accelerator lets go while the kart is put back (or about to start) : GO plain there', () => {
  const pad = make('a')
  const go = centre(at(pad, 'go'))
  const pk = (t, revving = false) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, false, false, revving); return ~(p[2] | (p[3] << 8)) & 0xffff }
  pad.down(1, ...go, 0)
  pk(0)
  pk(900)
  pad.up(1, 950)
  assert.equal(pk(1000), B.cross, 'locked')
  assert.equal(pk(1100, true), 0, 'put back after a fall : let go')
  pad.down(1, ...go, 1500)
  assert.equal(pk(1500, true), B.cross, 'a plain press, timed by the player')
  pk(2500, true)
  pad.up(1, 2550)
  assert.equal(pk(2600, true), 0, 'never locked while revving')
})

// ---- E : one gesture on the right ----
function eRace() {
  const pad = make('e')
  const right = at(pad, 'right')
  const z = at(pad, 'steer')
  const R = [right.x + right.w / 2, right.y + right.h / 2]
  const pk = (t, { slide = false, red = false, made = 0 } = {}) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, slide, red, false, made); return { bits: ~(p[2] | (p[3] << 8)) & 0xffff, lx: p[6] } }
  // GO held by the right thumb until it holds itself, then lifted
  pad.down(9, ...R, 0)
  pk(0)
  pk(900)
  pad.up(9, 950)
  pk(1000)
  return { pad, R, z, pk }
}

test('E : a touch while GO is not held is GO ; held, it holds itself', () => {
  const { pad, pk } = eRace()
  assert.equal(pad.hold.state, 'held')
  assert.equal(pk(1100).bits, B.cross)
})

test('E : a tap with the stick centred = a hop (R1, brief) ; GO stays held', () => {
  const { pad, R, pk } = eRace()
  pad.down(1, ...R, 2000)
  pk(2050)
  pad.up(1, 2100)
  assert.equal(pk(2110).bits, B.cross | B.r1, 'the hop')
  assert.equal(pk(2300).bits, B.cross, 'brief')
  assert.equal(pad.hold.state, 'held')
})

test('E : a tap turning = hop + slide kept while the game slides ; a tap in it = the boost ; the stick centred 0.3 s ends it', () => {
  const { pad, R, z, pk } = eRace()
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(2, ox, oy, 2000)
  pad.move(2, ox + z.reach, oy)
  pk(2010)
  pad.down(1, ...R, 2050)
  pad.up(1, 2120)
  assert.equal(pk(2130).bits, B.cross | B.r1, 'the hop and the slide')
  assert.equal(pk(2300, { slide: true }).bits, B.cross | B.r1, 'kept while the game slides')
  pad.down(1, ...R, 2400)
  assert.equal(pk(2410, { slide: true }).bits, B.cross | B.r1 | B.l1, 'a tap in the slide : the boost')
  pad.up(1, 2450)
  assert.equal(pk(2600, { slide: true }).bits, B.cross | B.r1)
  pad.move(2, ox, oy)
  pk(2700, { slide: true })
  assert.equal(pk(2850, { slide: true }).bits & B.r1, B.r1, 'centred less than 0.3 s : still sliding (a wide slide crosses the centre)')
  assert.equal(pk(3010, { slide: true }).bits & B.r1, 0, 'centred 0.3 s : the slide ends')
})

test('E : the slide ends with the game\'s ; a hold turning starts it after 200 ms', () => {
  const { pad, R, z, pk } = eRace()
  const [ox, oy] = [z.x + 60, z.y + z.h - 80]
  pad.down(2, ox, oy, 2000)
  pad.move(2, ox - z.reach, oy)
  pk(2010)
  pad.down(1, ...R, 2050)
  assert.equal(pk(2100).bits & B.r1, 0, 'not yet : a tap or a swipe ?')
  assert.equal(pk(2260).bits & B.r1, B.r1, 'still 200 ms : the slide')
  pk(2400, { slide: true })
  assert.equal(pk(2500, { slide: false }).bits & B.r1, 0, 'the game ended it')
})

test('E : swipe up = the item with Up (a potion ahead), swipe down = the item with Down (a bomb backward)', () => {
  const { pad, R, pk } = eRace()
  pad.down(1, ...R, 2000)
  pad.move(1, R[0], R[1] - 40)
  assert.equal(pk(2050).bits, B.cross | B.circle | B.up, 'the item, forward')
  pad.up(1, 2100)
  assert.equal(pk(2300).bits, B.cross, 'brief ; no hop after a swipe')
  pad.down(1, ...R, 3000)
  pad.move(1, R[0], R[1] + 40)
  assert.equal(pk(3050).bits, B.cross | B.circle | B.down, 'the item, behind ; GO stays held')
  pad.up(1, 3100)
  assert.equal(pk(3300).bits, B.cross, 'brief ; the direction let go with it')
})

test('E : the stick pulled straight down brakes (GO let go) ; a turn does not, nor a slide', () => {
  const { pad, R, z, pk } = eRace()
  const [ox, oy] = [z.x + 60, z.y + 40]
  const r = z.reach
  pad.down(2, ox, oy, 2000)
  pad.move(2, ox, oy + r * 0.7)
  assert.equal(pk(2010).bits, B.cross, 'not far enough')
  pad.move(2, ox, oy + r * 0.9)
  assert.equal(pk(2020).bits, B.square, 'the brake ; Cross let go')
  pad.move(2, ox + r * 0.3, oy + r * 0.7)
  assert.equal(pk(2030).bits, B.square, 'kept until it comes back above 0.6')
  pad.move(2, ox, oy + r * 0.5)
  assert.equal(pk(2040).bits & B.square, 0, 'released')
  pad.move(2, ox + r * 0.75, oy + r * 0.85)
  assert.equal(pk(2050).bits & B.square, 0, 'a turn pulled back : outside the cone')
  pad.move(2, ox + r, oy)
  assert.equal(pk(2060).bits & B.square, 0, 'a turn')
  // in a slide the stick is the slide's angle
  pad.down(1, ...R, 2100)
  pk(2110)
  pad.up(1, 2120)
  pad.down(1, ...R, 2130)
  pk(2140)
  pk(3100)
  pad.up(1, 3110)
  pad.move(2, ox + r, oy)
  pk(3200)
  pad.down(1, ...R, 3300)
  pad.up(1, 3350)
  pk(3360)
  pad.move(2, ox, oy + r)
  assert.equal(pk(3400, { slide: true }).bits & B.square, 0, 'no brake while sliding')
})

test('the brake on the stick is E\'s : A\'s stick pulled down does not brake', () => {
  const pad = make('a')
  const z = at(pad, 'steer')
  pad.down(2, z.x + 60, z.y + 40, 0)
  pad.move(2, z.x + 60, z.y + 40 + z.reach)
  assert.equal(read(pad, true, 10).bits & B.square, 0)
})

test('E : the auto boost taps only a slide\'s first boost ; the second and third are the player\'s', () => {
  const { pad, pk } = eRace()
  pad.autoBoost = true
  const seen = []
  pad.onBoosts = (n) => seen.push(n)
  pk(2000, { slide: true })
  assert.equal(pk(2010, { slide: true, red: true }).bits & B.l1, B.l1, 'the first red : tapped')
  assert.equal(pk(2200, { slide: true, red: true }).bits & B.l1, 0, 'once')
  pk(2300, { slide: true, made: 1 })
  assert.equal(pk(2400, { slide: true, red: true, made: 1 }).bits & B.l1, 0, 'the second red : not tapped')
  pk(2500, { slide: true, made: 2 })
  assert.equal(pk(2600, { slide: true, red: true, made: 2 }).bits & B.l1, 0, 'nor the third')
  pk(2700, {})
  assert.deepEqual(seen, [1, 2, 0], 'the count told as it changes, 0 once the slide is over')
  pk(2800, { slide: true })
  assert.equal(pk(2810, { slide: true, red: true }).bits & B.l1, B.l1, 'the next slide\'s first')
})

test('E : a boost tapped before the red waits for it (bufferMs) ; without the red it is sent as it was', () => {
  const { pad, R, pk } = eRace()
  pad.bufferMs = 80
  pk(2000, { slide: true })
  pad.down(1, ...R, 2010)
  assert.equal(pk(2020, { slide: true }).bits & B.l1, 0, 'early : kept')
  assert.equal(pk(2050, { slide: true }).bits & B.l1, 0)
  assert.equal(pk(2080, { slide: true, red: true }).bits & B.l1, B.l1, 'sent as the red starts')
  pad.up(1, 2090)
  pk(2300, { slide: true })
  pad.down(1, ...R, 2400)
  assert.equal(pk(2410, { slide: true }).bits & B.l1, 0, 'early again')
  assert.equal(pk(2500, { slide: true }).bits & B.l1, B.l1, 'no red within 80 ms : sent')
  pad.up(1, 2510)
  pk(2700, { slide: true, red: true })
  pad.down(1, ...R, 2800)
  assert.equal(pk(2810, { slide: true, red: true }).bits & B.l1, B.l1, 'in the red : at once')
  pad.up(1, 2820)
  pad.bufferMs = 0
  pk(3000, { slide: true })
  pad.down(1, ...R, 3100)
  assert.equal(pk(3110, { slide: true }).bits & B.l1, B.l1, 'off : every tap at once')
})

test('where the last finger landed on a boost control (the place of « 1 · 2 · 3 »)', () => {
  const { pad, R, pk } = eRace()
  pad.down(1, R[0] + 12, R[1] - 7, 2000)
  pk(2010)
  assert.deepEqual(pad.boostAt, { x: R[0] + 12, y: R[1] - 7 })
})

test('the cue : a tick at the red, a chime on a boost, a buzz where there is one ; silent while the sound sleeps', async () => {
  const { createCue } = await import('../src/lib/touch/cue.js')
  const played = []
  const node = () => ({ type: '', frequency: { value: 0 }, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start(t) { played.push(t) }, stop() {} })
  const ctx = { state: 'running', currentTime: 5, destination: {}, createOscillator: node, createGain: node }
  const buzz = []
  const cue = createCue({ context: () => ctx, vibrate: (ms) => buzz.push(ms) })
  assert.equal(cue.red(), true)
  assert.equal(played.length, 1)
  assert.equal(cue.made(2), true)
  assert.equal(played.length, 3, 'two notes')
  assert.deepEqual(buzz, [10, 25])
  ctx.state = 'suspended'
  assert.equal(cue.red(), false)
  assert.equal(played.length, 3)
  assert.equal(createCue({ context: () => null, vibrate: null }).made(1), false, 'no sound, no buzz (iOS before the first touch)')
})

test('a double tap on a held slide forgets a boost that was waiting for the red', () => {
  const pad = make('a')
  pad.slideHoldMs = 500
  pad.bufferMs = 80
  const r = at(pad, 'slide')
  const pk = (t, slide, red = false) => { const p = new Uint8Array(8); pad.packet(p, 0, true, t, slide, red); return ~(p[2] | (p[3] << 8)) & 0xffff }
  pad.down(1, r.cx, r.cy, 0)
  pk(10, true)
  pk(600, true)
  assert.equal(pad.slideLock, 'held')
  pad.up(1, 610)
  pk(1000, true)
  pad.down(1, r.cx, r.cy, 1100) // a tap before the red : it waits
  assert.equal(pk(1110, true) & B.l1, 0)
  pad.up(1, 1120)
  pad.down(1, r.cx, r.cy, 1150) // the double tap : the slide let go, the wait with it
  pk(1160, true)
  pad.up(1, 1170)
  pk(1400, false)
  // a later slide : an early tap waits its own 80 ms
  pad.down(1, r.cx, r.cy, 2000)
  pk(2010, true)
  pk(2600, true)
  pad.up(1, 2610)
  pk(2700, true)
  pad.down(1, r.cx, r.cy, 3000)
  assert.equal(pk(3010, true) & B.l1, 0, 'kept for the red')
  assert.equal(pk(3040, true, true) & B.l1, B.l1, 'sent at the red')
})
