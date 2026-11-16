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
  // the slide kept through a lift (session 42, the user : « lever le doigt puis recliquer pour
  // déclencher le boost sans arrêter le dérapage ») : the game ends a slide the frame its button
  // (R1) is let go, and a boost is a tap of L1 or R1 during it. A finger that lifts while holding R1
  // in a race leaves R1 held `slideMs` ms more ; touching a control with R1 again inside that time
  // taps L1 (the boost) and holds R1 on ; no touch → R1 let go, the slide ends.
  let slideUntil = 0
  let boostPending = false
  let boostUntil = 0
  // the rock (the user : « avec le haut du pouce je reste appuyé pour le slide, … j'abaisse le
  // pouce ») : one thumb is one touch point, but lowering it onto the screen moves that point down a
  // few mm (and widens the contact where the browser says so). A finger that started on an
  // `anchor` (R) and moves down `rockPx` from where it rests — or whose contact grows by half — taps
  // L1 (the boost) once ; raised back, it is armed again.
  // the held slide (the user : « après un temps ça fasse comme le hold, ça reste dessus ») : R
  // (an `anchor`) kept down `slideHoldMs` while the game says the kart slides locks R1 ; the thumb
  // can leave it. Locked, a tap on R taps L1 (the boost) ; two taps within 350 ms let it go (the
  // second one's R1 kept off) ; so do the brake, the menus and the game ending the slide.
  let slideLock = 'idle' // idle · pressing · held
  let slideTold = 'idle' // as last told (onSlide) : a double tap changes it between two pulls
  let slideSince = 0
  let lastRTap = -1e9
  let sliding = false
  let boostWindow = false
  // the slide from the stick (the user : « si on untap + tap ça le déclenche, si on est en train
  // d'être sur une direction ? En gardant la même direction / force ») : a steering thumb lifted
  // while turning leaves the stick where it was `retapMs` ms ; touching the zone again within it
  // starts the slide (R1, held while that thumb stays down) and the stick goes on from the same
  // direction and force — the new touch is not a new centre. Lifting it ends the slide.
  let stickMemo = null // { raw: [x, y] before the curve, until }
  const r1Elsewhere = () => {
    if (slideLock === 'held') return true
    for (const id in fingers) if (fingers[id].drift) return true
    return false
  }
  const rocked = (f, y, w) => (y - f.restY > self.rockPx) || (w > 0 && f.restW > 0 && w > f.restW * 1.5)
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
    down(id, x, y, t = 0, w = 0) {
      const start = hit(controls, x, y)
      if (!start) return false
      fingers[id] = { start, last: start, x, y, ox: x, oy: y, restY: y, restW: w, rock: false, noR1: false, drift: false, raw: null }
      if (start.type === 'stick' && stickMemo && t <= stickMemo.until) {
        const reach = start.reach * self.steer.reach
        fingers[id].ox = x - stickMemo.raw[0] * reach
        fingers[id].oy = y - stickMemo.raw[1] * reach
        fingers[id].drift = true
        stickMemo = null
        return true
      }
      stickMemo = null
      // R tapped while the slide's R1 is held from elsewhere (the stick's slide) : the boost
      if (start.anchor && slideLock !== 'held' && r1Elsewhere()) {
        fingers[id].noR1 = true
        boostPending = true
        return true
      }
      if (start.anchor && slideLock === 'held') {
        if (t - lastRTap < 350) {
          // a double tap : the held slide let go, this finger's R1 too
          slideLock = 'idle'
          fingers[id].noR1 = true
          landed &= ~B.r1
          boostPending = false
          boostUntil = 0
          lastRTap = -1e9
          return true
        }
        lastRTap = t
        boostPending = true
      }
      const r = self.read(id)
      landed |= r.bits
      landedGo = landedGo || r.go
      if (slideUntil && t <= slideUntil && (r.bits & B.r1)) {
        boostPending = true
        slideUntil = 0
      }
      return true
    },
    move(id, x, y, w = 0) {
      const f = fingers[id]
      if (!f) return false
      f.x = x
      f.y = y
      if (f.start.anchor && self.rockPx > 0) {
        if (!f.rock && rocked(f, y, w)) {
          f.rock = true
          boostPending = true
        } else if (f.rock && y - f.restY < self.rockPx * 0.4 && !(w > 0 && f.restW > 0 && w > f.restW * 1.2)) {
          f.rock = false
        }
        // at rest the thumb drifts : where it rests follows it up (never down : that is the rock)
        if (!f.rock && y < f.restY) f.restY = y
      }
      return true
    },
    up(id, t = 0) {
      const f = fingers[id]
      if (!f) return false
      const r = self.read(id)
      // a steering thumb lifted while turning : the stick kept for a re-touch (not after a slide)
      if (f.start.type === 'stick' && !f.drift && self.retapMs > 0 && racing && f.raw && Math.hypot(f.raw[0], f.raw[1]) >= 0.4) {
        stickMemo = { raw: f.raw, out: r.stick, until: t + self.retapMs }
      }
      delete fingers[id]
      if (self.slideMs > 0 && racing && (r.bits & B.r1)) slideUntil = t + self.slideMs
      return true
    },
    release() {
      for (const id in fingers) delete fingers[id]
      landed = 0
      landedGo = false
      slideUntil = 0
      boostPending = false
      boostUntil = 0
      slideLock = 'idle'
      stickMemo = null
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
          // the steering's sensitivity (the user : « le contrôle de la direction est lent ») : full
          // lock at a share of the zone's reach, and a curve that turns harder from small moves
          const reach = s.reach * self.steer.reach
          const dx = (f.x - f.ox) / reach
          const dy = (f.y - f.oy) / reach
          const len = Math.hypot(dx, dy)
          const k = len > 1 ? 1 / len : 1
          // in a slide the curve is off : the slide's angle is the stick's whole range (into the turn
          // tight, away wide — the user : « on peut déraper plus ou moins loin ? »)
          const curve = sliding ? 1 : self.steer.curve
          const curved = len > 0 ? Math.min(1, len) ** curve / Math.min(1, len) : 0
          stick = [dx * k * curved, dy * k * curved]
          f.raw = [dx * k, dy * k]
          at = { ox: f.ox, oy: f.oy, x: f.ox + dx * k * reach, y: f.oy + dy * k * reach }
          if (f.drift) {
            bits |= B.r1
            ids.push('steer-slide')
          }
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
          b = (f.noR1 ? s.bits & ~B.r1 : s.bits) | (under && under.boost ? under.bits : 0)
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
    packet(dst, at, race, now, slide = false, red = false, revving = false) {
      if (race !== racing) {
        racing = race
        self.onRacing?.(race)
      }
      sliding = !!slide
      // the boost's moment, as the game's red exhaust shows it : the boost controls light up
      if (!!red !== boostWindow) {
        boostWindow = !!red
        self.onWindow?.(boostWindow)
      }
      if (!shown) return 0
      const r = self.read()
      let bits = r.bits | landed
      const go = r.go || landedGo
      let stick = r.stick
      // between a steering thumb's lift and its re-touch, the stick stays where it was
      if (stickMemo && now > stickMemo.until) stickMemo = null
      if (!stick && stickMemo) stick = stickMemo.out
      landed = 0
      landedGo = false
      const brake = (bits & B.square) !== 0
      // the slide kept through a lift, its boost tapped (see slideUntil)
      if (brake || !racing) slideUntil = 0
      // the held slide : R down (a finger on an anchor, R1 its own) long enough in a slide → held
      let rDown = false
      for (const id in fingers) if (fingers[id].start.anchor && !fingers[id].noR1) rDown = true
      if (brake || !racing || (slideLock === 'held' && !sliding) || !(self.slideHoldMs > 0)) slideLock = 'idle'
      else if (slideLock === 'idle' && rDown && sliding) { slideLock = 'pressing'; slideSince = now }
      else if (slideLock === 'pressing' && (!rDown || !sliding)) slideLock = 'idle'
      else if (slideLock === 'pressing' && now - slideSince >= self.slideHoldMs) slideLock = 'held'
      if (slideLock === 'held') { bits |= B.r1; slideUntil = 0 }
      if (slideLock !== slideTold) {
        slideTold = slideLock
        self.onSlide?.(slideLock)
      }
      if (slideUntil && now > slideUntil) slideUntil = 0
      if (slideUntil) bits |= B.r1
      if (boostPending) {
        boostPending = false
        boostUntil = now + 100
      }
      if (boostUntil && now < boostUntil) bits |= B.l1
      else boostUntil = 0
      // put back after a fall, or the countdown : a timed press boosts there — GO plain, the hold off
      // (the user : « le auto accelerate se désactive quand on doit redémarrer après une chute »)
      cross = hold.update(now, { go, brake, racing: racing && !revving })
      if (hold.state !== held) {
        held = hold.state
        self.onHold?.(held)
      }
      const buttons = ~(bits | (cross ? B.cross : 0)) & 0xffff
      const analog = self.analog || kind === 'a' || kind === 'b' || kind === 'd'
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
    /** how long R1 outlives a lift in a race (the slide kept, a re-touch = a boost) ; 0 = off */
    slideMs: 0,
    /** how far down (CSS px) a thumb on R rocks to boost ; 0 = off */
    rockPx: 0,
    /** how long R is kept down in a slide before the slide holds itself ; 0 = off */
    slideHoldMs: 0,
    /** how long a steering thumb's lift waits for a re-touch that starts the slide ; 0 = off */
    retapMs: 0,
    /** the stick's sensitivity : full lock at `reach` × the zone's reach, |v| ** `curve` */
    steer: { reach: 1, curve: 1 },
    /** the held slide's state : idle · pressing · held */
    get slideLock() { return slideLock },
    /** called with the held slide's state when it changes (TouchPad.svelte) */
    onSlide: null,
    /** called when the slide's boost moment (the turbo meter's red) starts or ends */
    onWindow: null,
    /** R1 kept by a lift right now (TouchPad.svelte draws it) */
    get sliding() { return slideUntil > 0 },
    /** called with the new value when the game's « racing » changes (TouchPad.svelte) */
    onRacing: null,
    /** called with the hold's state when it changes (hold.js : idle, pressing, held, retouched) */
    onHold: null,
  }
  return self
}
