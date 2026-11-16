// A phone's Home Screen (src/lib/install.js) : what the page says about the stored disc, the install
// prompt, the wake lock — on fake browsers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installSupport } from '../src/lib/install.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1'
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

function browser({ ua, standalone = false, persisted = false, grant = false, touch = true, wakeLock = true } = {}) {
  const listeners = {}
  const locks = []
  let stored = persisted
  const g = {
    navigator: {
      userAgent: ua, platform: '', maxTouchPoints: 5, standalone: ua === IPHONE ? standalone : undefined,
      storage: { persisted: async () => stored, persist: async () => { if (grant) stored = true; return stored } },
      wakeLock: wakeLock ? { request: async () => { const l = { released: false, addEventListener: () => {} }; locks.push(l); return l } } : undefined,
    },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? touch : q.includes('display-mode') ? standalone && ua !== IPHONE : false }),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
    document: { visibilityState: 'visible', addEventListener: () => {} },
    setInterval: () => 0,
  }
  return { g, fire: (type, e) => listeners[type]?.forEach((fn) => fn(e)), locks }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

test('iPhone Safari in a tab : the disc may go, the hint is iOS’s, no prompt', async () => {
  const ui = { phase: 'boot' }
  const { g } = browser({ ua: IPHONE })
  installSupport(ui, { g })
  await tick()
  assert.deepEqual({ ios: ui.install.ios, touch: ui.install.touch, standalone: ui.install.standalone, canPrompt: ui.install.canPrompt, kept: ui.install.kept }, { ios: true, touch: true, standalone: false, canPrompt: false, kept: 'may-go' })
})

test('iPhone, opened from the Home Screen : kept on the device', async () => {
  const ui = { phase: 'boot' }
  installSupport(ui, { g: browser({ ua: IPHONE, standalone: true }).g })
  await tick()
  assert.equal(ui.install.standalone, true)
  assert.equal(ui.install.kept, 'device')
})

test('Android Chrome : the prompt comes, kept once persist() is granted, nothing said before', async () => {
  const ui = { phase: 'boot' }
  const b = browser({ ua: PIXEL, grant: true })
  const install = installSupport(ui, { g: b.g })
  await tick()
  assert.equal(ui.install.kept, null)
  let prompted = false
  b.fire('beforeinstallprompt', { preventDefault() {}, prompt: async () => { prompted = true }, userChoice: Promise.resolve({ outcome: 'accepted' }) })
  assert.equal(ui.install.canPrompt, true)
  assert.equal(await install.promptInstall(), true)
  assert.equal(prompted, true)
  assert.equal(ui.install.canPrompt, false)
  await install.keep()
  assert.equal(ui.install.persisted, true)
  assert.equal(ui.install.kept, 'device')
})

test('the wake lock : only while the game runs', async () => {
  const ui = { phase: 'boot' }
  const b = browser({ ua: PIXEL })
  let check
  b.g.setInterval = (fn) => { check = fn; return 0 }
  installSupport(ui, { g: b.g })
  await check()
  assert.equal(b.locks.length, 0)
  ui.phase = 'running'
  await check()
  await check()
  assert.equal(b.locks.length, 1)
})
