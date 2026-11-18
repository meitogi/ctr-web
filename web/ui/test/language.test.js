import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GAME_LANGUAGES, browserLanguage, chooseGame } from '../src/lib/language.js'

test('the browser\'s first language the game has, else English', () => {
  assert.equal(browserLanguage(['de-AT', 'fr']), 'de')
  assert.equal(browserLanguage(['pt-BR', 'nl-BE', 'en']), 'nl')
  assert.equal(browserLanguage(['ja']), 'en')
  assert.equal(browserLanguage(undefined), 'en')
  assert.deepEqual(GAME_LANGUAGES, ['en', 'fr', 'de', 'it', 'es', 'nl'])
})

test('a US disc alone : English by default (as it always played), another language on its text', () => {
  const us = { us: {} }
  assert.deepEqual(chooseGame('auto', us, ['fr-FR']), { language: 'en', region: 'us' })
  assert.deepEqual(chooseGame('es', us, ['fr-FR']), { language: 'es', region: 'us' })
})

test('a PAL disc alone : the browser\'s language by default, every language from it', () => {
  const pal = { pal: {} }
  assert.deepEqual(chooseGame('auto', pal, ['fr-FR']), { language: 'fr', region: 'pal' })
  assert.deepEqual(chooseGame('auto', pal, ['ja-JP']), { language: 'en', region: 'pal' })
  assert.deepEqual(chooseGame('en', pal, ['fr-FR']), { language: 'en', region: 'pal' })
})

test('both discs : English from the US disc, the others from the PAL disc', () => {
  const both = { us: {}, pal: {} }
  assert.deepEqual(chooseGame('auto', both, ['en-GB']), { language: 'en', region: 'us' })
  assert.deepEqual(chooseGame('auto', both, ['it-IT']), { language: 'it', region: 'pal' })
  assert.deepEqual(chooseGame('nl', both, ['en-US']), { language: 'nl', region: 'pal' })
  assert.deepEqual(chooseGame('bogus', both, ['de']), { language: 'de', region: 'pal' })
})
