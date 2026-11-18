// The touch controls' places on a phone in landscape (session 42's design sheets,
// plans/…/proofs/42/design) : pure, from the viewport and its safe areas — no DOM.
//
// A layout is a list of controls in CSS px of the viewport :
//   { id, type: 'button', cx, cy, r, bits, label }       a round button
//   { id, type: 'rect', x, y, w, h, bits, label }        a rectangle (a D-pad arm, a shoulder, a pill)
//   { id, type: 'dpad', cx, cy, r }                      four directions, diagonals by angle
//   { id, type: 'stick', x, y, w, h, reach }             a zone : the stick is centred where the
//                                                        thumb lands, `reach` px = full deflection
// and, on a control, how a finger on it behaves (fingers.js) :
//   go       its Cross is the accelerator the hold can lock (hold.js)
//   anchor   a finger that started on it keeps its bits wherever it goes, plus a `boost` control's
//            under it (A : R kept, rolled onto BOOST adds L1)
//   group    a finger that started in a group has the bits of the group's control under it, the
//            last one's when off them all (B : GO → GO + R → + BOOST without lifting)
//   boost    added to an anchor's finger passing over it
//
// Kinds : 'minimal' (the pad 1:1), 'a' (floating stick), 'b' (glide), 'c' (left / right buttons),
// 'd' (one thumb a side : the stick left ; GO and R large side by side, held both, ITEM above,
// BRAKE below — the user, 2026-11-16 : « le plus pratique à 1 doigt à gauche et 1 doigt à droite »),
// 'e' (one gesture on the right : the stick left ; the right half one zone — hold = GO, a tap =
// a hop, turning a slide, in a slide a boost, swipes = item / brake ; pad.js `gesture`),
// 'menu' (the reduced pad of the game's menus : D-pad, OK, BACK, pause).
import { PSX_BIT as B } from '../guest-input.js'

export const KINDS = ['minimal', 'a', 'b', 'c', 'd', 'e', 'menu']
export const SIZES = { s: 0.88, m: 1, l: 1.14 }

/**
 * @param {string} kind
 * @param {{ W: number, H: number, left?: number, right?: number, top?: number, bottom?: number }} view
 *   the viewport and its safe-area insets (CSS px)
 * @param {{ size?: 's' | 'm' | 'l' }} [opts]
 */
export function layout(kind, view, { size = 'm' } = {}) {
  const { W, H } = view
  // nothing under the notch's band nor the home bar ; a minimum margin where there is none
  const L = Math.max(view.left ?? 0, 8)
  const R = Math.max(view.right ?? 0, 8)
  const bottom = Math.max(view.bottom ?? 0, 8)
  const top = Math.max(view.top ?? 0, 8)
  const u = (H / 375) * (SIZES[size] ?? 1)
  const lx = L + 64 * u
  const rx = W - R - 62 * u
  const by = H - bottom - 92 * u
  const pause = { id: 'start', type: 'rect', x: L + 4, y: top + 4, w: 46 * u, h: 28 * u, bits: B.start, label: 'II' }
  const dpad = { id: 'dpad', type: 'dpad', cx: lx, cy: by, r: 60 * u }
  const look = { id: 'look', type: 'rect', x: W - R - 8 - 54 * u, y: top + 62 * u, w: 54 * u, h: 28 * u, bits: B.r2, label: 'LOOK' }
  const zone = { id: 'steer', type: 'stick', x: L, y: H * 0.3, w: W / 2 - L - 60 * u, h: H * 0.7 - bottom, reach: 46 * u }

  if (kind === 'minimal') {
    const f = 40 * u
    const r = 21 * u
    return [
      dpad,
      { id: 'triangle', type: 'button', cx: rx, cy: by - f, r, bits: B.triangle, label: 'TRI', back: true },
      { id: 'cross', type: 'button', cx: rx, cy: by + f, r, bits: B.cross, label: 'X' },
      { id: 'square', type: 'button', cx: rx - f, cy: by, r, bits: B.square, label: 'SQ' },
      { id: 'circle', type: 'button', cx: rx + f, cy: by, r, bits: B.circle, label: 'O' },
      { id: 'l1', type: 'rect', x: L + 6, y: top + 62 * u, w: 64 * u, h: 32 * u, bits: B.l1, label: 'L1' },
      { id: 'l2', type: 'rect', x: L + 6 + 70 * u, y: top + 62 * u, w: 46 * u, h: 32 * u, bits: B.l2, label: 'L2' },
      { id: 'r1', type: 'rect', x: W - R - 6 - 64 * u, y: top + 62 * u, w: 64 * u, h: 32 * u, bits: B.r1, label: 'R1' },
      { id: 'r2', type: 'rect', x: W - R - 6 - 116 * u, y: top + 62 * u, w: 46 * u, h: 32 * u, bits: B.r2, label: 'R2' },
      { id: 'select', type: 'rect', x: L + 4, y: top + 4, w: 58 * u, h: 26 * u, bits: B.select, label: 'SELECT' },
      { id: 'start', type: 'rect', x: L + 10 + 58 * u, y: top + 4, w: 58 * u, h: 26 * u, bits: B.start, label: 'START' },
    ]
  }
  if (kind === 'menu') {
    return [
      dpad,
      { id: 'cross', type: 'button', cx: rx, cy: by + 30 * u, r: 34 * u, bits: B.cross, label: 'OK' },
      { id: 'triangle', type: 'button', cx: rx, cy: by - 54 * u, r: 30 * u, bits: B.triangle, label: 'BACK', back: true },
      pause,
    ]
  }
  if (kind === 'a') {
    const ax = W - R - 62 * u
    const ay = H - bottom - 66 * u
    return [
      zone,
      { id: 'go', type: 'button', cx: ax, cy: ay, r: 46 * u, bits: B.cross, label: 'GO', go: true },
      { id: 'slide', type: 'button', cx: ax - 96 * u, cy: ay - 34 * u, r: 36 * u, bits: B.r1, label: 'R', anchor: true },
      { id: 'boost', type: 'button', cx: ax - 118 * u, cy: ay - 110 * u, r: 26 * u, bits: B.l1, label: 'BOOST', boost: true },
      { id: 'item', type: 'button', cx: ax - 10 * u, cy: ay - 126 * u, r: 30 * u, bits: B.circle, label: 'ITEM' },
      { id: 'brake', type: 'button', cx: ax - 92 * u, cy: ay + 38 * u, r: 24 * u, bits: B.square, label: 'BRAKE' },
      look,
      pause,
    ]
  }
  if (kind === 'b') {
    const ax = W - R - 64 * u
    const ay = H - bottom - 58 * u
    return [
      zone,
      { id: 'go', type: 'button', cx: ax, cy: ay, r: 44 * u, bits: B.cross, label: 'GO', go: true, group: 'glide' },
      { id: 'slide', type: 'button', cx: ax - 70 * u, cy: ay - 66 * u, r: 38 * u, bits: B.cross | B.r1, label: 'GO + R', go: true, group: 'glide' },
      { id: 'boost', type: 'button', cx: ax - 128 * u, cy: ay - 138 * u, r: 32 * u, bits: B.cross | B.r1 | B.l1, label: '+ BOOST', go: true, group: 'glide' },
      { id: 'item', type: 'button', cx: ax + 4 * u, cy: ay - 122 * u, r: 28 * u, bits: B.circle, label: 'ITEM' },
      { id: 'brake', type: 'button', cx: ax - 132 * u, cy: ay + 6 * u, r: 24 * u, bits: B.square, label: 'BRAKE' },
      look,
      pause,
    ]
  }
  if (kind === 'e') {
    const x = W / 2 + 10
    const y = top + 100 * u
    return [
      { ...zone, brake: true },
      { id: 'right', type: 'rect', x, y, w: W - R - x, h: H - bottom - y, bits: 0, label: '', gesture: true, go: true, boosts: true },
      look,
      pause,
    ]
  }
  if (kind === 'd') {
    const gx = W - R - 58 * u
    const gy = H - bottom - 104 * u
    const sx = gx - 104 * u
    return [
      zone,
      { id: 'go', type: 'button', cx: gx, cy: gy, r: 50 * u, bits: B.cross, label: 'GO', go: true },
      { id: 'slide', type: 'button', cx: sx, cy: gy + 14 * u, r: 46 * u, bits: B.r1, label: 'R', anchor: true },
      { id: 'item', type: 'button', cx: gx - 30 * u, cy: gy - 86 * u, r: 30 * u, bits: B.circle, label: 'ITEM' },
      { id: 'brake', type: 'rect', x: sx - 30 * u, y: H - bottom - 38 * u, w: gx + 30 * u - (sx - 30 * u), h: 34 * u, bits: B.square, label: 'BRAKE' },
      look,
      pause,
    ]
  }
  if (kind === 'c') {
    const sy = H - bottom - 114 * u
    const cx = W - R - 20 * u
    const cy = H - bottom - 20 * u
    const at = (t, rad) => [cx + 112 * u * Math.cos(Math.PI + t * Math.PI / 2), cy + 112 * u * Math.sin(Math.PI + t * Math.PI / 2), rad * u]
    const [gx, gy, gr] = at(0.08, 34)
    const [sx, sy2, sr] = at(0.5, 30)
    const [ix, iy, ir] = at(0.92, 26)
    return [
      { id: 'left', type: 'rect', x: L + 4, y: sy, w: 60 * u, h: 86 * u, bits: B.left, label: '<' },
      { id: 'right', type: 'rect', x: L + 10 + 60 * u, y: sy, w: 60 * u, h: 86 * u, bits: B.right, label: '>' },
      { id: 'boost', type: 'rect', x: L + 4, y: top + 62 * u, w: 70 * u, h: 32 * u, bits: B.l1, label: 'L1' },
      { id: 'go', type: 'button', cx: gx, cy: gy, r: gr, bits: B.cross, label: 'GO', go: true },
      { id: 'slide', type: 'button', cx: sx, cy: sy2, r: sr, bits: B.r1, label: 'R' },
      { id: 'item', type: 'button', cx: ix, cy: iy, r: ir, bits: B.circle, label: 'ITEM' },
      { id: 'brake', type: 'button', cx: cx - 40 * u, cy: cy - 40 * u, r: 26 * u, bits: B.square, label: 'BRAKE' },
      look,
      pause,
    ]
  }
  throw new Error(`layout : no kind ${kind}`)
}

/** The control under (x, y) : the last drawn first (buttons over the stick's zone), or null. */
export function hit(controls, x, y) {
  for (let i = controls.length - 1; i >= 0; i--) {
    const c = controls[i]
    if (c.type === 'button' || c.type === 'dpad') {
      const dx = x - c.cx
      const dy = y - c.cy
      // a little more than drawn : a thumb is wider than its aim
      const r = c.r * 1.15
      if (dx * dx + dy * dy <= r * r) return c
    } else if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
      return c
    }
  }
  return null
}

/** The D-pad's bits at (x, y) : eight sectors of 45°, none near the centre. */
export function dpadBits(c, x, y) {
  const dx = x - c.cx
  const dy = y - c.cy
  if (dx * dx + dy * dy < (c.r * 0.22) ** 2) return 0
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7 // 0 right, 2 down, 4 left, 6 up
  return [B.right, B.right | B.down, B.down, B.down | B.left, B.left, B.left | B.up, B.up, B.up | B.right][sector]
}
