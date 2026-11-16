// The tests' card images (web/test/player/memcard.mjs) : a card the game wrote, cut into a PS1 card
// image and back, comes back byte for byte ; another game's save is skipped ; a 3-icon save's data
// is found after its icon frames.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK, CARD_SIZE, CTR_PROFILE, cardImage, splitCardImage } from './player/memcard.mjs'

const file = (size, fill) => {
  const b = new Uint8Array(size)
  for (let i = 0; i < size; i++) b[i] = (i * 7 + fill) & 0xff
  b[0] = 0x53; b[1] = 0x43; b[2] = 0x11; b[3] = Math.ceil(size / BLOCK)
  return b
}

test('a profile and a ghost : to a card image and back, byte for byte', () => {
  const files = { [CTR_PROFILE]: file(0x100 + 0x1680, 1), 'BASCUS-94426GABCDEFG': file(0x100 + 0x3e00, 2) }
  const image = cardImage(files)
  assert.equal(image.length, CARD_SIZE)
  assert.equal(String.fromCharCode(image[0], image[1]), 'MC')
  const { files: back, others } = splitCardImage(image)
  assert.deepEqual(Object.keys(back).sort(), Object.keys(files).sort())
  for (const name in files) assert.deepEqual(back[name], files[name], name)
  assert.deepEqual(others, [])
})

test("another game's save is skipped, named", () => {
  const image = cardImage({ 'BESLES-12345GAME': file(0x2000, 3), [CTR_PROFILE]: file(0x1780, 4) })
  const { files, others } = splitCardImage(image)
  assert.deepEqual(Object.keys(files), [CTR_PROFILE])
  assert.deepEqual(others, ['BESLES-12345GAME'])
})

test("a save with three icon frames : its data after them, the native header's flag one frame", () => {
  const raw = file(0x200 + 0x1680, 5)
  raw[2] = 0x13
  const { files } = splitCardImage(cardImage({ [CTR_PROFILE]: raw }))
  const got = files[CTR_PROFILE]
  assert.equal(got.length, 0x100 + 0x1680)
  assert.equal(got[2], 0x11)
  assert.deepEqual(got.subarray(0x100), raw.subarray(0x200, 0x200 + 0x1680))
})

test('not a card : refused', () => {
  assert.throws(() => splitCardImage(new Uint8Array(1000)), /131072/)
  assert.throws(() => splitCardImage(new Uint8Array(CARD_SIZE)), /MC/)
})
