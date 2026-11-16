// The settings presets of the tests (src/dev/presets.js, ?preset=) : the values a name sets, several
// names combined, an unknown name refused, no query no preset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, presetSeed } from '../src/dev/presets.js'
import { KEYS, createSettings } from '../src/lib/settings.js'
import { memoryStorage } from '../src/lib/second-window.js'

const settingsOf = (search) => {
  let v
  createSettings(memoryStorage(presetSeed(search)), { deviceKey: KEYS.device }).subscribe((s) => { v = s })()
  return v
}

test('no ?preset : none', () => {
  assert.equal(presetSeed(''), null)
  assert.equal(presetSeed('?race=crash-cove'), null)
})

test('each preset sets what it says', () => {
  assert.equal(settingsOf('?preset=duo').duo, true)
  assert.equal(settingsOf('?preset=muted').muted, true)
  assert.equal(settingsOf('?preset=unlock-off').unlockAll, false)
  assert.equal(settingsOf('?preset=pad-only').device.mode, 'gamepad')
  assert.equal(settingsOf('?preset=keyboard-only').device.mode, 'keyboard')
  assert.equal(settingsOf('?preset=named').name, 'Tester')
  const clean = settingsOf('?preset=clean')
  assert.deepEqual([clean.duo, clean.muted, clean.unlockAll, clean.device.mode], [false, false, true, 'auto'])
  const k = settingsOf('?preset=remapped').keyboard
  const d = settingsOf('?preset=clean').keyboard
  assert.deepEqual([k[1], k[3]], [d[3], d[1]])
})

test('presets combine, the later one winning', () => {
  const v = settingsOf('?preset=duo,unlock-off,muted')
  assert.deepEqual([v.duo, v.unlockAll, v.muted], [true, false, true])
})

test('an unknown preset is refused, the names listed', () => {
  assert.throws(() => presetSeed('?preset=nope'), new RegExp(Object.keys(PRESETS).join('.*')))
})
