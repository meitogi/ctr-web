// « My pad » (session 42b, the user : « laisser la possibilité au joueur de faire sa propre
// manette … repositionner, ajouter des boutons ») : a layout the player builds in the editor
// (TouchEditor.svelte) from any of the built-in ones and from the palette below. Pure, no DOM.
//
// A spec is what the browser keeps : { from, controls: [...] }, each control a layouts.js control
// (type, bits, label and its flags : go, anchor, boost, boosts, gesture, brake, group, back) whose
// place is written from the nearest corner of the safe area, in the layouts' own unit (u = the
// viewport's height / 375 × the size setting) :
//   ax 'l' | 'r', ay 't' | 'b'   the corner
//   dx, dy                       the control's centre from that corner
//   r, or w and h, and `reach` for a stick
//   s                            its scale (0.6 to 1.6), o its opacity (0.2 to 1)
// so a pad follows a rotation, another phone or another size. `fromSpec` gives layouts.js controls
// in CSS px ; `toSpec` reads them back.
import { PSX_BIT as B } from '../guest-input.js'
import { layout, SIZES } from './layouts.js'

export const SCALE = Object.freeze({ min: 0.6, max: 1.6 })
export const OPACITY = Object.freeze({ min: 0.2, max: 1 })
/** as many controls as a spec keeps (a stored value is not trusted) */
export const MAX_CONTROLS = 24

/**
 * What « + Add » offers. `super` : the controls that do more than a pad's button (the actions
 * built in session 42) ; the others are the pad's own buttons, 1:1. Sizes in the layouts' unit.
 */
export const PALETTE = Object.freeze({
  stick: { super: true, type: 'stick', w: 300, h: 220, reach: 46 },
  go: { super: true, type: 'button', r: 46, bits: B.cross, label: 'GO', go: true },
  slide: { super: true, type: 'button', r: 38, bits: B.r1, label: 'SLIDE', anchor: true },
  boost: { super: true, type: 'button', r: 30, bits: B.l1, label: 'BOOST', boost: true },
  gesture: { super: true, type: 'rect', w: 300, h: 230, bits: 0, label: '', gesture: true, go: true, boosts: true },
  itemUp: { super: true, type: 'button', r: 28, bits: B.circle | B.up, label: 'ITEM ^' },
  itemDown: { super: true, type: 'button', r: 28, bits: B.circle | B.down, label: 'ITEM v' },
  brake: { super: true, type: 'button', r: 26, bits: B.square, label: 'BRAKE' },
  cross: { type: 'button', r: 24, bits: B.cross, label: 'X' },
  circle: { type: 'button', r: 24, bits: B.circle, label: 'O' },
  square: { type: 'button', r: 24, bits: B.square, label: 'SQ' },
  triangle: { type: 'button', r: 24, bits: B.triangle, label: 'TRI' },
  l1: { type: 'button', r: 24, bits: B.l1, label: 'L1' },
  r1: { type: 'button', r: 24, bits: B.r1, label: 'R1' },
  l2: { type: 'button', r: 24, bits: B.l2, label: 'L2' },
  r2: { type: 'button', r: 24, bits: B.r2, label: 'R2' },
  dpad: { type: 'dpad', r: 60 },
  look: { type: 'rect', w: 54, h: 28, bits: B.r2, label: 'LOOK' },
})

const FLAGS = ['go', 'anchor', 'boost', 'boosts', 'gesture', 'brake', 'back']
const TYPES = ['button', 'rect', 'dpad', 'stick']
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

const frame = (view, size) => {
  const L = Math.max(view.left ?? 0, 8)
  const R = Math.max(view.right ?? 0, 8)
  const top = Math.max(view.top ?? 0, 8)
  const bottom = Math.max(view.bottom ?? 0, 8)
  return { L, R, top, bottom, u: (view.H / 375) * (SIZES[size] ?? 1) }
}

/** The centre of a layouts.js control, in px. */
export const centre = (c) => (c.type === 'button' || c.type === 'dpad' ? [c.cx, c.cy] : [c.x + c.w / 2, c.y + c.h / 2])

/** layouts.js controls (CSS px, at this view) → a spec's controls. */
export function toSpec(controls, view, size = 'm', from = null) {
  const { W, H } = view
  const { L, R, top, bottom, u } = frame(view, size)
  const out = []
  for (const c of controls) {
    const [cx, cy] = centre(c)
    const s = c.scale ?? 1
    const ax = cx < W / 2 ? 'l' : 'r'
    const ay = cy < H / 2 ? 't' : 'b'
    const k = { id: c.id, type: c.type, ax, ay, dx: (ax === 'l' ? cx - L : W - R - cx) / u, dy: (ay === 't' ? cy - top : H - bottom - cy) / u, s, o: c.opacity ?? 1 }
    if (c.type === 'button' || c.type === 'dpad') k.r = c.r / u / s
    else { k.w = c.w / u / s; k.h = c.h / u / s }
    if (c.type === 'stick') k.reach = c.reach / u / s
    if (c.type !== 'stick' && c.type !== 'dpad') { k.bits = c.bits; k.label = c.label }
    for (const f of FLAGS) if (c[f]) k[f] = true
    if (c.group) k.group = c.group
    out.push(k)
  }
  return { from, controls: out }
}

/** A spec → layouts.js controls at this view (each with its `scale` and `opacity`). */
export function fromSpec(spec, view, size = 'm') {
  const { W, H } = view
  const { L, R, top, bottom, u } = frame(view, size)
  const out = []
  for (const k of spec.controls) {
    const cx = k.ax === 'l' ? L + k.dx * u : W - R - k.dx * u
    const cy = k.ay === 't' ? top + k.dy * u : H - bottom - k.dy * u
    const s = k.s
    const c = { id: k.id, type: k.type, scale: s, opacity: k.o }
    if (k.type === 'button' || k.type === 'dpad') Object.assign(c, { cx, cy, r: k.r * u * s })
    else Object.assign(c, { x: cx - (k.w * u * s) / 2, y: cy - (k.h * u * s) / 2, w: k.w * u * s, h: k.h * u * s })
    if (k.type === 'stick') c.reach = k.reach * u * s
    if (k.type !== 'stick' && k.type !== 'dpad') { c.bits = k.bits; c.label = k.label }
    for (const f of FLAGS) if (k[f]) c[f] = true
    if (k.group) c.group = k.group
    out.push(c)
  }
  // the sticks' zones under the buttons : a button dragged onto a zone stays touchable (hit()
  // reads the list from its end)
  return out.sort((a, b) => (b.type === 'stick') - (a.type === 'stick'))
}

/** A valid spec from anything (a stored JSON value, a patch) ; null when there is nothing to keep. */
export function cleanSpec(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!v || !Array.isArray(v.controls)) return null
  const controls = []
  const ids = {}
  for (const k of v.controls.slice(0, MAX_CONTROLS)) {
    if (!k || !TYPES.includes(k.type) || typeof k.id !== 'string' || !/^[a-z0-9-]{1,24}$/i.test(k.id) || ids[k.id]) continue
    ids[k.id] = true
    const c = { id: k.id, type: k.type, ax: k.ax === 'r' ? 'r' : 'l', ay: k.ay === 't' ? 't' : 'b', dx: clamp(num(k.dx), 0, 2000), dy: clamp(num(k.dy), 0, 2000), s: clamp(num(k.s, 1), SCALE.min, SCALE.max), o: clamp(num(k.o, 1), OPACITY.min, OPACITY.max) }
    if (c.type === 'button' || c.type === 'dpad') c.r = clamp(num(k.r, 24), 10, 120)
    else { c.w = clamp(num(k.w, 60), 20, 900); c.h = clamp(num(k.h, 30), 20, 600) }
    if (c.type === 'stick') c.reach = clamp(num(k.reach, 46), 20, 120)
    if (c.type !== 'stick' && c.type !== 'dpad') { c.bits = num(k.bits) & 0xffff; c.label = String(k.label ?? '').slice(0, 12) }
    for (const f of FLAGS) if (k[f] === true) c[f] = true
    if (typeof k.group === 'string') c.group = k.group.slice(0, 12)
    controls.push(c)
  }
  if (!controls.some((c) => c.id === 'start')) return null
  return { from: typeof v.from === 'string' ? v.from.slice(0, 12) : null, controls }
}

/** An id no control of the list has : `boost`, then `boost-2`, … */
export function freeId(controls, name) {
  const taken = {}
  for (const c of controls) taken[c.id] = true
  if (!taken[name]) return name
  for (let n = 2; ; n++) if (!taken[`${name}-${n}`]) return `${name}-${n}`
}

/** A palette entry as a control at (cx, cy), in px at this view. */
export function fromPalette(name, controls, view, size, cx, cy) {
  const p = PALETTE[name]
  const { u } = frame(view, size)
  const c = { id: freeId(controls, name), type: p.type, scale: 1, opacity: 1 }
  if (p.type === 'button' || p.type === 'dpad') Object.assign(c, { cx, cy, r: p.r * u })
  else Object.assign(c, { x: cx - (p.w * u) / 2, y: cy - (p.h * u) / 2, w: p.w * u, h: p.h * u })
  if (p.type === 'stick') c.reach = p.reach * u
  if (p.type !== 'stick' && p.type !== 'dpad') { c.bits = p.bits; c.label = p.label }
  for (const f of FLAGS) if (p[f]) c[f] = true
  return c
}

/**
 * « 3 fingers » (research, 42b : the claw of Rush+ and Sideswipe) : the thumbs steer and
 * accelerate, the index fingers have the boost (right) and the item (left) at the top.
 */
function threeFingers(view, size) {
  const { W, H } = view
  const { L, R, top, bottom, u } = frame(view, size)
  const e = layout('e', view, { size })
  const pick = (id) => e.find((c) => c.id === id)
  return [
    { ...pick('steer'), brake: false },
    { id: 'go', type: 'button', cx: W - R - 70 * u, cy: H - bottom - 76 * u, r: 50 * u, bits: B.cross, label: 'GO', go: true },
    { id: 'slide', type: 'button', cx: W - R - 176 * u, cy: H - bottom - 58 * u, r: 36 * u, bits: B.r1, label: 'SLIDE', anchor: true },
    { id: 'brake', type: 'button', cx: W - R - 172 * u, cy: H - bottom - 138 * u, r: 24 * u, bits: B.square, label: 'BRAKE' },
    { id: 'boost', type: 'button', cx: W - R - 60 * u, cy: top + 96 * u, r: 38 * u, bits: B.l1, label: 'BOOST', boost: true },
    { id: 'item', type: 'button', cx: L + 60 * u, cy: top + 96 * u, r: 32 * u, bits: B.circle, label: 'ITEM' },
    { id: 'look', type: 'rect', x: W - R - 190 * u, y: top + 6 * u, w: 54 * u, h: 28 * u, bits: B.r2, label: 'LOOK' },
    pick('start'),
  ]
}

/** What « Start from… » offers : the built-in layouts, and the presets that exist only here. */
export const STARTS = ['e', 'a', 'b', 'c', 'd', 'three']

/** The controls of a start point, in px at this view. */
export function startFrom(name, view, size = 'm') {
  return name === 'three' ? threeFingers(view, size) : layout(name, view, { size })
}

/**
 * What a pad cannot do, for the editor's warning (it warns, it does not forbid) :
 * { go: no accelerator, steer: no way to steer }.
 */
export function missing(controls) {
  let go = false
  let steer = false
  let left = false
  let right = false
  for (const c of controls) {
    if (c.go || (c.bits & B.cross)) go = true
    if (c.type === 'stick' || c.type === 'dpad') steer = true
    if (c.bits & B.left) left = true
    if (c.bits & B.right) right = true
  }
  return { go: !go, steer: !(steer || (left && right)) }
}

/** A control moved so that its centre stays inside the safe area. */
export function moveTo(c, cx, cy, view) {
  const { L, R, top, bottom } = frame(view, 'm')
  const x = clamp(cx, L, view.W - R)
  const y = clamp(cy, top, view.H - bottom)
  if (c.type === 'button' || c.type === 'dpad') return { ...c, cx: x, cy: y }
  return { ...c, x: x - c.w / 2, y: y - c.h / 2 }
}

/** A control at another scale (its centre kept). */
export function scaleTo(c, scale) {
  const s = clamp(scale, SCALE.min, SCALE.max)
  const k = s / (c.scale ?? 1)
  if (c.type === 'button' || c.type === 'dpad') return { ...c, r: c.r * k, scale: s }
  const [cx, cy] = centre(c)
  const out = { ...c, w: c.w * k, h: c.h * k, x: cx - (c.w * k) / 2, y: cy - (c.h * k) / 2, scale: s }
  if (c.type === 'stick') out.reach = c.reach * k
  return out
}
