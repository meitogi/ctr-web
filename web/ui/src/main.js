// The page's interface (web/index.html loads ui/ui.js) : boot screen and disc drop, the whole-window
// drop overlay, the speaker / Settings buttons, the Settings sidebar, toasts. Exposes
// globalThis.ctrUI for the other page modules :
//   ctrUI.settings            the settings store (settings.js) — name, volume, mappings…
//   ctrUI.adopt(id, title, el)  put another module's panel in a Settings tab (web/share/panel.js) ;
//                             returns { open(), close() }
//   ctrUI.toast(title, detail, family, { sticky, action, ms })
//   ctrUI.text                 the strings (lib/strings.js, EN / FR) — Share's join / leave toasts
//   ctrUI.players              couch mode (lib/players.js) : slots as the game reports them, swap(a, b)
//   ctrUI.share(state)         Share's state for the page's Share button (web/share/panel.js)
//   ctrUI.guestInput()         the player's mapping as web/share/protocol.js reads it (guest-input.js)
//   ctrUI.racing()             a race is driven (the game's word at its last input update) : Share tells
//                             its guests (their touch pads, session 42)
// Debug builds (__CTR_DEV__) load src/dev/ : the « Bot » switch and Settings › Dev with its second
// window ; a window opened as that second one (?dev=<mode>) boots by itself.
// and Module.ctrInput for the game (lib/input-hook.js, pulled by platform/native_input.c).
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { findCachedDisc, forgetDisc, probeDisc, storeDiscStream } from '../../disc.js'
import { resolveDisc } from './lib/discsource.js'
import { guestInput } from './lib/guest-input.js'
import { createInputHook } from './lib/input-hook.js'
import { createTouchPad } from './lib/touch/pad.js'
import { installSupport } from './lib/install.js'
import { createPlayers } from './lib/players.js'
import { LANG, T, errorText } from './lib/strings.js'
import { ui } from './state.svelte.js'
import { role, settings } from './store.js'

const Module = globalThis.Module

// ---- sound : index.html routes the game's Web Audio through window.ctrAudio's gain nodes ----
// A forced mute (player harness, ?mute) holds until the player touches the sound itself.
const audio = globalThis.ctrAudio
let heard = null
settings.subscribe((s) => {
  if (!audio) return
  if (heard && (heard.muted !== s.muted || heard.volume !== s.volume)) audio.forcedMute = false
  heard = { muted: s.muted, volume: s.volume }
  audio.set(s.muted || audio.forcedMute ? 0 : s.volume)
})
document.documentElement.lang = LANG

// ---- the game's input hook ----
// The game gets no local input while the player is in the Settings panel (its keyboard focus is
// there, a key is being bound, or a confirmation is up) ; with the panel open and the focus on the
// game (a click on it), the game plays — Settings stays open beside a race. With the Bot
// switch on (debug builds), the panel's focus does not stop the bot's keys.
const inPanel = () => !!document.activeElement?.closest?.('#ctr-settings')
// Couch mode : the game reports its four player slots, Settings › Players swaps them.
const players = createPlayers({
  onChange: (slots) => { ui.players = slots },
  onAnalog: (slot, pad) => toast(pad.analog ? T.analogOn(slot + 1) : T.analogOff(slot + 1), pad.analog ? '' : T.analogOffHelp, pad.family),
})
// a phone's on-screen pad (lib/touch/, TouchPad.svelte) : one more device, P1's
const touch = createTouchPad()
const input = createInputHook(settings, { blocked: () => ui.phase === 'running' && (ui.listening !== null || ui.confirm !== null || (ui.settingsOpen && inPanel() && !ui.bot)) }, { players, touch })
if (Module) Module.ctrInput = input

// ---- a phone's Home Screen (lib/install.js) : the install hint, what is kept, the screen kept awake ----
const install = installSupport(ui)

// ---- boot ----
function bootGame(serial) {
  ui.disc = ui.disc ?? { serial, size: 0 }
  ui.phase = 'starting'
  ui.status = T.booting
  const script = document.createElement('script')
  script.src = 'ctr_native.js'
  document.body.appendChild(script)
  const canvas = document.getElementById('canvas')
  canvas?.focus()
  // running once the game presents (the canvas gets its first frame) — or soon anyway
  const done = () => { if (ui.phase === 'starting') ui.phase = 'running' }
  setTimeout(done, 400)
}

async function storeAndBoot(found, { reload }) {
  ui.phase = 'preparing'
  ui.error = ''
  ui.status = ''
  ui.progress = { title: T.preparing, detail: T.preparingFrom(found.source, found.name), kind: found.kind, serial: found.serial, written: 0, total: found.size }
  let stored
  try {
    stored = await storeDiscStream(await found.open(), found.size, (written, total) => {
      ui.progress = { ...ui.progress, written, total }
    })
  } catch (e) {
    ui.progress = null
    ui.phase = reload ? 'running' : 'boot'
    // a zip's own error (lib/zip.js ZipError : a word) ; a DOMException has a numeric code too — a full
    // disk's QuotaExceededError (22) read as « zip-22 », « Something went wrong » (session 45b)
    const failure = typeof e?.code === 'string' ? { reason: `zip-${e.code}`, message: e.message } : { reason: 'storage', message: String(e) }
    ui.error = errorText(T, failure)
    if (reload) toast(ui.error)
    return
  }
  // what was written is checked again before anything boots from it ; a bad image is deleted
  const probe = await probeDisc(stored)
  if (!probe.ok) {
    await forgetDisc()
    ui.progress = null
    ui.phase = 'boot'
    ui.error = errorText(T, probe)
    return
  }
  ui.disc = { serial: probe.serial, size: stored.size }
  install.keep()
  if (reload) {
    location.reload()
    return
  }
  ui.progress = null
  globalThis.__ctrDisc = stored
  bootGame(probe.serial)
}

/** A file dropped or picked : checked, then stored and booted (or, over a running game, confirmed). */
export async function handleFile(file) {
  ui.error = ''
  const running = ui.phase === 'running' || ui.phase === 'starting'
  if (!running) ui.status = T.checking(file.name)
  let found
  try {
    found = await resolveDisc(file, probeDisc)
  } catch (e) {
    found = { ok: false, reason: 'unknown', message: String(e) }
  }
  if (!found.ok) {
    ui.error = errorText(T, found)
    if (!running) ui.status = ''
    if (running) toast(ui.error)
    return
  }
  if (running) {
    ui.confirm = {
      text: T.replaceAsk(found.serial.replace('_', '-').replace('.', '')),
      action: T.replace,
      run: () => storeAndBoot(found, { reload: true }),
    }
    return
  }
  await storeAndBoot(found, { reload: false })
}

/** The ready screen's press (a key, a pad button, the Play button) : boots the stored disc. */
export function startGame() {
  if (ui.phase === 'ready') bootGame(ui.disc.serial)
}

// « Restart now » (Settings › System, a change the running game cannot take : « Unlock everything ») :
// the page reloads and goes straight into the game, whatever « Start the game by itself » says
const RESTART_KEY = 'ctr-ui.restart'
export function restartGame() {
  try { sessionStorage.setItem(RESTART_KEY, '1') } catch {}
  location.reload()
}
const restarting = (() => {
  try {
    const was = sessionStorage.getItem(RESTART_KEY) === '1'
    sessionStorage.removeItem(RESTART_KEY)
    return was
  } catch { return false }
})()

export function forgetStoredDisc() {
  ui.confirm = {
    text: T.forgetAsk,
    action: T.forget,
    danger: true,
    run: async () => { await forgetDisc(); location.reload() },
  }
}

let toastSeq = 0
export function toast(title, detail = '', family = '', { sticky = false, action = null, ms = 4500 } = {}) {
  const id = ++toastSeq
  // a toast with an action is a button : a click (or Enter) runs it and dismisses the toast
  const run = action && (() => { dismissToast(id); action() })
  ui.toasts = [...ui.toasts, { id, title, detail, family, action: run }]
  if (!sticky) setTimeout(() => dismissToast(id), ms)
  return id
}
export function dismissToast(id) {
  ui.toasts = ui.toasts.filter((t) => t.id !== id)
}

// Adopted panels live in a hidden parking spot while their tab is not shown, so their elements
// stay in the document (scripts and suites reach them by id).
const parking = Object.assign(document.createElement('div'), { id: 'ctr-parked', hidden: true })
document.body.appendChild(parking)
function adopt(id, title, el) {
  parking.appendChild(el)
  ui.adopted = [...ui.adopted.filter((a) => a.id !== id), { id, title, el }]
  return {
    open: () => { ui.tab = 'multi'; ui.multi = id; ui.settingsOpen = true },
    close: () => { ui.settingsOpen = false },
  }
}

// Share's panel tells what the page's Share button shows (web/share/panel.js render)
const share = (s) => { if (JSON.stringify(ui.share) !== JSON.stringify(s)) ui.share = s }
globalThis.ctrUI = { settings, adopt, toast, dismissToast, handleFile, players, text: T, share, guestInput: () => guestInput(settings.get()), racing: () => touch.racing }

// Test-only hook (session 3) : the agent browser runs on another machine than the files, so CDP's
// DOM.setFileInputFiles cannot point at them ; suites fetch a same-origin fixture into the same
// handleFile() a drop or a pick calls.
globalThis.__ctrTestHandleFileFromUrl = async (url) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return handleFile(new File([blob], url.split('/').pop()))
}

// debug : the tests' precise start (dev/precise.js : a card, faults) is in place before the stored disc
// is read and the game boots
const devReady = __CTR_DEV__ ? import('./dev/index.js').then((dev) => dev.install({ toast, start: startGame, handleFile })).catch((e) => console.error('[CTR Dev]', e)) : null

mount(App, { target: document.getElementById('ctr-ui'), props: { input, touch, handleFile, forgetStoredDisc, startGame, restartGame, promptInstall: install.promptInstall } })

;(async () => {
  if (__CTR_DEV__) await devReady
  if (globalThis.__CTR_WEB_PRELOAD) {
    // Dev build with assets/ctr-u.bin baked into MEMFS (CTR_WEB_PRELOAD_DISC) : nothing to drop.
    ui.disc = { serial: 'preloaded (dev build)', size: 0 }
    bootGame('preloaded (dev build)')
    return
  }
  ui.status = T.checkingSaved
  const cached = await findCachedDisc()
  if (!cached) {
    ui.phase = 'boot'
    ui.status = ''
    return
  }
  ui.status = T.checking(cached.name || 'ctr-u.bin')
  let probe
  try {
    probe = await probeDisc(cached)
  } catch (e) {
    // the stored disc could not be read (the browser's storage failing) : said, and kept — it may be
    // whole (the page stayed on « Checking… » for good before ; session 45b's fault disc-read)
    probe = { ok: false, reason: 'read', message: String(e?.message ?? e) }
  }
  if (!probe.ok) {
    ui.error = errorText(T, probe)
    ui.phase = 'boot'
    ui.status = ''
    if (probe.reason !== 'read') await forgetDisc()
    return
  }
  // the boot screen stays : the game starts on the player's press (Boot.svelte, App.svelte), which
  // also lets the page's audio start with sound
  ui.disc = { serial: probe.serial, size: cached.size }
  install.keep()
  globalThis.__ctrDisc = cached
  ui.phase = 'ready'
  ui.status = ''
  // the second window of Settings › Dev (debug) : in the room already, nobody to press
  // or a test's fast or precise start (dev/fast.js : ?race=, ?state=, ?turbo= ; dev/precise.js : ?card=,
  // ?seed=, ?pause= ; dev/presets.js : ?preset=)
  // — but not ?measure (dev/measure.js) : its Start tap boots, so the sound's first resume is a touch
  if (__CTR_DEV__ && !/[?&]measure\b/.test(location.search) && (role.second || /[?&](race|state|turbo|card|seed|pause|preset)=/.test(location.search))) startGame()
  // « Start the game by itself » (Settings › System, on by default) : no press, so no gesture — the
  // sound waits for the first touch or key (index.html resumes the context then) ; the boot screen's
  // choices are skipped, Settings › System switches it off. A restart asked from Settings too.
  // Not a bot's page nor ?measure (its Start tap is the sound's first gesture).
  else if ((settings.get().autoStart || restarting) && !role.bot && !(__CTR_DEV__ && /[?&]measure\b/.test(location.search))) startGame()
})()
