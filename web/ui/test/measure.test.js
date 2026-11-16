// The measuring panel's numbers (src/dev/measure-summary.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarize, verdict } from '../src/dev/measure-summary.js'

const race = (fpsList, { vblankPerS = 59.82, framesPerS = 30 } = {}) =>
  fpsList.map((fps, i) => ({ t: i * 1000, fps, vblank: Math.round(i * vblankPerS), frame: Math.round(i * framesPerS) }))

test('percentile : nearest rank, empty → null', () => {
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
  assert.equal(percentile([1, 2, 3, 4], 0.05), 1)
  assert.equal(percentile([1, 2, 3, 4], 1), 4)
})

test('a race at 30 fps : median 30, no slow second, the clock in real time, the gaps', () => {
  const s = summarize(race([0, 30, 30, 30, 29.9, 30, 30, 30, 30, 30, 30]), [33, 34, 33, 70])
  assert.equal(s.seconds, 10)
  assert.deepEqual(s.fps, { median: 30, p5: 29.9, min: 29.9, slowShare: 0 })
  assert.equal(s.vblankRate, 59.8)
  assert.equal(s.framesPerSecond, 30)
  assert.equal(s.worstGapMs, 70)
  assert.equal(s.gapsOver50, 1)
  assert.deepEqual(verdict(s, { audioRan: true, killed: false }), { runs: true, reasons: [] })
})

test('a slow phone : the reasons say each number', () => {
  const s = summarize(race([0, 24, 25, 22, 30, 26], { vblankPerS: 50, framesPerS: 25 }))
  assert.equal(s.fps.median, 25)
  assert.equal(s.fps.slowShare, 0.8)
  assert.equal(s.vblankRate, 50)
  const v = verdict(s, { audioRan: false, killed: true })
  assert.equal(v.runs, false)
  assert.deepEqual(v.reasons, [
    'median 25 fps (under 29)',
    '80 % of seconds under 28 fps',
    'game clock 50 VBlanks/s (under 59 : the game runs slow)',
    'the sound never ran',
    'an earlier run was killed (the page reloaded mid-race)',
  ])
})

test('nothing sampled : no numbers, the verdict says so', () => {
  const s = summarize([{ t: 0, fps: 0, vblank: 0, frame: 0 }])
  assert.equal(s.fps, null)
  assert.deepEqual(verdict(s, { audioRan: true, killed: false }).reasons, ['no race measured'])
})
