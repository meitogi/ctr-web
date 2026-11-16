// The measuring panel's numbers (dev/measure.js), from what it sampled : pure, so node --test reads it.
//   samples   [{ t (ms), fps (__ctr.fps), vblank (__ctr.vblank), frame (__ctr.frame) }], one a second
//             through the race
//   gaps      the intervals (ms) between two presents the page saw change __ctr.frame
// The game presents at most 30 frames a second ; its clock (VBlanks) runs at 59.82 Hz when it keeps
// real time.

export const SLOW_FPS = 28

/** The value at fraction p (0..1) of the sorted list, nearest rank ; null for an empty list. */
export function percentile(sorted, p) {
  const n = sorted.length
  if (!n) return null
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]
}

const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** { seconds, fps: { median, p5, min, slowShare }, vblankRate, framesPerSecond, worstGapMs, gapsOver50 } */
export function summarize(samples, gaps = []) {
  const n = samples.length
  if (n < 2) return { seconds: 0, fps: null, vblankRate: null, framesPerSecond: null, worstGapMs: null, gapsOver50: 0 }
  const first = samples[0]
  const last = samples[n - 1]
  const seconds = (last.t - first.t) / 1000
  // the first sample's fps is the second before the race : left out
  const fps = samples.slice(1).map((s) => s.fps).sort((a, b) => a - b)
  const slow = fps.filter((f) => f < SLOW_FPS).length
  let worst = 0
  let over50 = 0
  for (const g of gaps) {
    if (g > worst) worst = g
    if (g > 50) over50++
  }
  return {
    seconds: round(seconds),
    fps: { median: percentile(fps, 0.5), p5: percentile(fps, 0.05), min: fps[0], slowShare: round(slow / fps.length, 3) },
    vblankRate: round((last.vblank - first.vblank) / seconds, 2),
    framesPerSecond: round((last.frame - first.frame) / seconds, 2),
    worstGapMs: gaps.length ? round(worst, 0) : null,
    gapsOver50: over50,
  }
}

/**
 * The verdict the plan set (session 41) : the game runs on this phone when the median is at least
 * 29 fps, under 5 % of the seconds are below 28, the game clock keeps real time (≥ 59 VBlanks a
 * second), the sound ran, and no earlier run was killed. Returns { runs, reasons: [why not] }.
 */
export function verdict(summary, { audioRan, killed }) {
  const reasons = []
  const f = summary.fps
  if (!f) reasons.push('no race measured')
  else {
    if (f.median < 29) reasons.push(`median ${f.median} fps (under 29)`)
    if (f.slowShare >= 0.05) reasons.push(`${Math.round(f.slowShare * 100)} % of seconds under ${SLOW_FPS} fps`)
    if (summary.vblankRate < 59) reasons.push(`game clock ${summary.vblankRate} VBlanks/s (under 59 : the game runs slow)`)
  }
  if (!audioRan) reasons.push('the sound never ran')
  if (killed) reasons.push('an earlier run was killed (the page reloaded mid-race)')
  return { runs: reasons.length === 0, reasons }
}
