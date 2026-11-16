// The touch pad : fingers on the controls (layouts.js) → one PSX pad, as a pad would send it.
// Pure apart from the time it is given : TouchPad.svelte feeds the pointer events, the game pulls
// the packet once per input update (input-hook.js touch(), platform/native_input.c
// NativeInput_WebApplyTouchPad) and Share's guest page sends it (web/share/guest-page.js).
//
// Each finger is its own pointer (pointerId). What a finger presses (layouts.js's flags) :
//   - on a plain control : the control under it now — a finger slides from one onto the next ;
//   - started on the stick's zone : the stick, centred where it landed, for as long as it is down ;
//   - started on an `anchor` : that control's bits wherever it goes, plus a `boost` under it ;
//   - started in a `group` : the group's control under it, the last one when off them all.
// GO (`go`) passes through the held accelerator (hold.js) on the race layouts.
import { PSX_BIT as B } from '../guest-input.js'
import { createHold } from './hold.js'
import { dpadBits, hit, layout } from './layouts.js'

export const PAD_DIGITAL = 0x41
export const PAD_ANALOG = 0x73

const byte = (v) => Math.max(0, Math.min(255, Math.round(0x80 + v * 127)))

/**
 * @param {{ hold?: { delay?: number, enabled?: boolean } }} [opts]
 */
export function createTouchPad({ hold: holdOpts = {} } = {}) {
  let controls = []
  let kind = null
  let view = null
  let size = 'm'
  const fingers = {} // pointerId → { start, last, x, y, ox, oy }
  const hold = createHold(holdOpts)
  let shown = false
  let racing = false
  let cross = false // the hold's Cross, at the last update
  let held = 'idle' // the hold's state, as last told (onHold)
  // what a finger pressed when it landed, until the next pull : a tap shorter than the game's input
  // update (~33 ms at 30 fps) still reaches it once
  let landed = 0
  let landedGo = false
  const self = {
    get controls() { return controls },
    get kind() { return kind },
    get hold() { return hold },
    get racing() { return racing },
    get shown() { return shown },
    /** Shown or not : hidden, the game gets nothing from it (the slot is left alone). */
    show(on) {
      shown = !!on
      if (!shown) self.release()
    },
    /** The layout for `kind` at this viewport (layouts.js) ; the fingers are let go. */
    place(k, v, s = size) {
      if (k === kind && s === size && v && view && v.W === view.W && v.H === view.H && v.left === view.left && v.right === view.right && v.bottom === view.bottom && v.top === view.top) return false
      kind = k
      view = v
      size = s
      controls = layout(k, v, { size: s })
      self.release()
      return true
    },
    down(id, x, y) {
      const start = hit(controls, x, y)
      if (!start) return false
      fingers[id] = { start, last: start, x, y, ox: x, oy: y }
      const r = self.read(id)
      landed |= r.bits
      landedGo = landedGo || r.go
      return true
    },
    move(id, x, y) {
      const f = fingers[id]
      if (!f) return false
      f.x = x
      f.y = y
      return true
    },
    up(id) {
      if (!fingers[id]) return false
      delete fingers[id]
      return true
    },
    release() {
      for (const id in fingers) delete fingers[id]
      landed = 0
      landedGo = false
      hold.reset()
      cross = false
    },
    /**
     * What the fingers press now : { bits (active high), go (GO's Cross), stick: [x, y] in -1..1 or
     * null, at: the stick's { ox, oy, x, y } in px (where it landed, where it is), ids: the controls
     * pressed (for drawing) }
     */
    read(only = null) {
      let bits = 0
      let go = false
      let stick = null
      let at = null
      const ids = []
      for (const id in fingers) {
        if (only !== null && id !== String(only)) continue
        const f = fingers[id]
        const s = f.start
        const under = hit(controls, f.x, f.y)
        if (s.type === 'stick') {
          const dx = (f.x - f.ox) / s.reach
          const dy = (f.y - f.oy) / s.reach
          const len = Math.hypot(dx, dy)
          const k = len > 1 ? 1 / len : 1
          stick = [dx * k, dy * k]
          at = { ox: f.ox, oy: f.oy, x: f.ox + dx * k * s.reach, y: f.oy + dy * k * s.reach }
          continue
        }
        let b = 0
        let fromGo = false
        if (s.group) {
          if (under && under.group === s.group) f.last = under
          b = f.last.bits
          fromGo = !!f.last.go
          ids.push(f.last.id)
        } else if (s.anchor) {
          b = s.bits | (under && under.boost ? under.bits : 0)
          ids.push(s.id)
          if (under && under.boost) ids.push(under.id)
        } else {
          const c = under ?? null
          if (c?.type === 'dpad') b = dpadBits(c, f.x, f.y)
          else if (c && c.type !== 'stick') b = c.bits
          fromGo = !!c?.go
          if (b && c) ids.push(c.id)
        }
        if (fromGo) {
          go = true
          b &= ~B.cross
        }
        bits |= b
      }
      return { bits, go, stick, at, ids }
    },
    /**
     * The pad now, as an 8-byte PSX packet at dst[at] (status, id, buttons lo / hi, right x y, left
     * x y) ; `race` : a race is driven (the game's word). Returns 0 while hidden.
     */
    packet(dst, at, race, now) {
      if (race !== racing) {
        racing = race
        self.onRacing?.(race)
      }
      if (!shown) return 0
      const r = self.read()
      const bits = r.bits | landed
      const go = r.go || landedGo
      const stick = r.stick
      landed = 0
      landedGo = false
      const brake = (bits & B.square) !== 0
      cross = hold.update(now, { go, brake, racing })
      if (hold.state !== held) {
        held = hold.state
        self.onHold?.(held)
      }
      const buttons = ~(bits | (cross ? B.cross : 0)) & 0xffff
      const analog = self.analog || kind === 'a' || kind === 'b'
      dst[at] = 0
      dst[at + 1] = analog ? PAD_ANALOG : PAD_DIGITAL
      dst[at + 2] = buttons & 0xff
      dst[at + 3] = buttons >> 8
      dst[at + 4] = 0x80
      dst[at + 5] = 0x80
      dst[at + 6] = stick ? byte(stick[0]) : 0x80
      dst[at + 7] = stick ? byte(stick[1]) : 0x80
      return 1
    },
    /** the packet says analog whatever the layout (TouchPad.svelte : the enhanced A / B mode) */
    analog: false,
    /** called with the new value when the game's « racing » changes (TouchPad.svelte) */
    onRacing: null,
    /** called with the hold's state when it changes (hold.js : idle, pressing, held, retouched) */
    onHold: null,
  }
  return self
}
