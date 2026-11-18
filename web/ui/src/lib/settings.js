// The page's settings, one place : player name, volume / mute, « Unlock everything », starting the
// game by itself, the touch controls, keyboard and gamepad mappings, two players on one keyboard (duo) and its two key sets, who plays on this page
// (device : auto, keyboard only, gamepad only and which one). Persisted in localStorage ; a missing or blocked storage (private mode) only means
// nothing is remembered.
//
// The player name keeps the key the Online panel already used (`ctr-online.name`,
// web/online/page.js) : existing players keep their name, no migration. web/online/page.js
// reads it through globalThis.ctrUI (src/main.js). An empty name gets a random one (names.js),
// stored at once, so Share and Online start with the same name.
//
// The device choice is per page : the game page and Share's guest page share one origin, so one
// machine opening both keeps two keys (`deviceKey`) — the host on the keyboard, the guest on the
// gamepad, and one controller no longer drives both (« ça boucle », 2026-10-22).
//
// createSettings() returns a Svelte-compatible store (subscribe / set / update) usable from plain
// JS too — test/settings.test.js drives it with an in-memory storage.
import { GAME_LANGUAGES } from './language.js'
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, loadMapping, saveMapping } from './mappings.js'
import { randomName } from './names.js'

export const NAME_LEN = 9 // game/OnlineCTR/global.h
export const KEYS = {
  name: 'ctr-online.name',
  volume: 'ctr-ui.volume',
  muted: 'ctr-ui.muted',
  unlockAll: 'ctr-ui.unlock-all',
  keyboard: 'ctr-ui.keyboard',
  gamepad: 'ctr-ui.gamepad',
  duo: 'ctr-ui.duo',
  keyboardLeft: 'ctr-ui.keyboard-left',
  keyboardRight: 'ctr-ui.keyboard-right',
  device: 'ctr-ui.device',
  autoStart: 'ctr-ui.auto-start',
  touchMode: 'ctr-ui.touch-mode',
  touchLayout: 'ctr-ui.touch-layout',
  touchHold: 'ctr-ui.touch-hold',
  touchHoldMs: 'ctr-ui.touch-hold-ms',
  touchSize: 'ctr-ui.touch-size',
  touchSlideMs: 'ctr-ui.touch-slide-ms',
  touchRockPx: 'ctr-ui.touch-rock-px',
  touchSlideHoldMs: 'ctr-ui.touch-slide-hold-ms',
  touchSteer: 'ctr-ui.touch-steer',
  touchCue: 'ctr-ui.touch-cue',
  touchRetapMs: 'ctr-ui.touch-retap-ms',
  touchAutoBoost: 'ctr-ui.touch-auto-boost',
  touchBuffer: 'ctr-ui.touch-buffer',
  touchSound: 'ctr-ui.touch-sound',
  gameLanguage: 'ctr-ui.game-language',
}
/** The device key of Share's guest page. */
export const GUEST_DEVICE_KEY = 'ctr-share.guest-device'
export const DEVICE_MODES = ['auto', 'keyboard', 'gamepad']
/** The game's language (lib/language.js) : `auto`, or one the discs give ; applies at the next start. */
export const LANGUAGE_CHOICES = ['auto', ...GAME_LANGUAGES]
/** Auto : keyboard and gamepads, as before. `pad` : { id, nth } of the chosen gamepad, null = the first. */
export const DEFAULT_DEVICE = Object.freeze({ mode: 'auto', pad: null })
export const DEFAULT_VOLUME = 0.8
/**
 * The touch controls (lib/touch/, session 42) : `auto` = the enhanced pad on a touch screen, hidden
 * while a pad is connected ; `pad` = never drawn. The enhanced pad's layout (lib/touch/layouts.js),
 * its held accelerator (lib/touch/hold.js) and the controls' size.
 */
export const TOUCH_MODES = ['auto', 'pad', 'minimal', 'enhanced']
// the first one is the default : E, the one a new player gets (the user, 2026-11-18)
export const TOUCH_LAYOUTS = ['e', 'a', 'b', 'c', 'd']
/** how long a boost tapped before the meter's red waits for it (lib/touch/pad.js bufferMs) */
export const TOUCH_BUFFER_MS = 80
export const TOUCH_SIZES = ['s', 'm', 'l']
export const TOUCH_HOLD_MS = Object.freeze({ min: 400, max: 1500, default: 800 })
/** how long the slide (R1) outlives a lift of the thumb, for a re-touch to boost ; 0 = off */
export const TOUCH_SLIDE_MS = Object.freeze([0, 200, 300, 450])
const slideMs = (v) => (TOUCH_SLIDE_MS.includes(Number(v)) ? Number(v) : 300)
/** how far down (CSS px) the thumb on R rocks for a boost ; 0 = off */
export const TOUCH_ROCK_PX = Object.freeze([0, 6, 9, 14])
const rockPx = (v) => (TOUCH_ROCK_PX.includes(Number(v)) ? Number(v) : 9)
/** how long R is kept down in a slide before the slide holds itself ; 0 = off */
export const TOUCH_SLIDE_HOLD_MS = Object.freeze([0, 350, 500, 800])
const slideHoldMs = (v) => (TOUCH_SLIDE_HOLD_MS.includes(Number(v)) ? Number(v) : 500)
/** the stick's sensitivity : full lock at `reach` × the zone's reach, |v| ** `curve` (lib/touch/pad.js steer) */
/** how long a steering thumb's lift waits for the re-touch that starts the slide ; 0 = off */
export const TOUCH_RETAP_MS = Object.freeze([0, 200, 250, 350])
const retapMs = (v) => (TOUCH_RETAP_MS.includes(Number(v)) ? Number(v) : 250)
export const TOUCH_STEER = Object.freeze({ low: { reach: 0.85, curve: 0.9 }, medium: { reach: 0.65, curve: 0.7 }, high: { reach: 0.5, curve: 0.55 } })
const pick = (v, list) => (list.includes(v) ? v : list[0])
const holdMs = (v) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= TOUCH_HOLD_MS.min && n <= TOUCH_HOLD_MS.max ? n : TOUCH_HOLD_MS.default
}

/** Printable ASCII only (the game's font), at most NAME_LEN characters. */
export function cleanName(name) {
  return String(name ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN)
}

/** A valid device choice from anything (a stored JSON value, a patch). */
export function cleanDevice(d) {
  const mode = DEVICE_MODES.includes(d?.mode) ? d.mode : 'auto'
  const pad = mode === 'gamepad' && typeof d?.pad?.id === 'string' ? { id: d.pad.id, nth: Number.isInteger(d.pad.nth) && d.pad.nth >= 0 ? d.pad.nth : 0 } : null
  return { mode, pad }
}

const read = (storage, key) => { try { return storage?.getItem(key) ?? null } catch { return null } }
const write = (storage, key, value) => {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, String(value))
  } catch { /* private mode */ }
}

function loadDevice(storage, key) {
  try {
    return cleanDevice(JSON.parse(read(storage, key) ?? 'null'))
  } catch {
    return cleanDevice(null)
  }
}

export function loadSettings(storage, { deviceKey = KEYS.device } = {}) {
  const volume = Number.parseFloat(read(storage, KEYS.volume))
  return {
    name: cleanName(read(storage, KEYS.name) ?? ''),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME,
    muted: read(storage, KEYS.muted) === '1',
    // the home page's box, checked by default (include/platform/native_web_ui.h)
    unlockAll: read(storage, KEYS.unlockAll) !== '0',
    keyboard: loadMapping(storage, KEYS.keyboard, DEFAULT_KEYBOARD),
    gamepad: loadMapping(storage, KEYS.gamepad, DEFAULT_GAMEPAD),
    duo: read(storage, KEYS.duo) === '1',
    keyboardLeft: loadMapping(storage, KEYS.keyboardLeft, DEFAULT_KEYBOARD_LEFT),
    keyboardRight: loadMapping(storage, KEYS.keyboardRight, DEFAULT_KEYBOARD_RIGHT),
    device: loadDevice(storage, deviceKey),
    // with the game data stored, the page boots the game on load, no boot screen press (on by default)
    autoStart: read(storage, KEYS.autoStart) !== '0',
    touchMode: pick(read(storage, KEYS.touchMode), TOUCH_MODES),
    touchLayout: pick(read(storage, KEYS.touchLayout), TOUCH_LAYOUTS),
    touchHold: read(storage, KEYS.touchHold) !== '0',
    touchHoldMs: holdMs(read(storage, KEYS.touchHoldMs) ?? TOUCH_HOLD_MS.default),
    touchSize: pick(read(storage, KEYS.touchSize), ['m', 's', 'l']),
    touchSlideMs: slideMs(read(storage, KEYS.touchSlideMs) ?? 300),
    touchRockPx: rockPx(read(storage, KEYS.touchRockPx) ?? 9),
    touchSlideHoldMs: slideHoldMs(read(storage, KEYS.touchSlideHoldMs) ?? 500),
    touchSteer: pick(read(storage, KEYS.touchSteer), ['medium', 'low', 'high']),
    // the boost controls light up at the boost's moment (the game's red exhaust)
    touchCue: read(storage, KEYS.touchCue) !== '0',
    touchRetapMs: retapMs(read(storage, KEYS.touchRetapMs) ?? 250),
    // layout E : the page taps the slide's first boost at the meter's red (as Mario Kart Tour's automatic drift)
    touchAutoBoost: read(storage, KEYS.touchAutoBoost) !== '0',
    // a boost tapped a little before the red is kept for it
    touchBuffer: read(storage, KEYS.touchBuffer) !== '0',
    // the page's own sounds : a tick at the red, a chime on a boost made
    touchSound: read(storage, KEYS.touchSound) !== '0',
    gameLanguage: pick(read(storage, KEYS.gameLanguage), LANGUAGE_CHOICES),
  }
}

function saveSettings(storage, s, deviceKey) {
  write(storage, KEYS.name, s.name)
  write(storage, KEYS.volume, s.volume)
  write(storage, KEYS.muted, s.muted ? '1' : null)
  write(storage, KEYS.unlockAll, s.unlockAll ? null : '0')
  saveMapping(storage, KEYS.keyboard, s.keyboard, DEFAULT_KEYBOARD)
  saveMapping(storage, KEYS.gamepad, s.gamepad, DEFAULT_GAMEPAD)
  write(storage, KEYS.duo, s.duo ? '1' : null)
  saveMapping(storage, KEYS.keyboardLeft, s.keyboardLeft, DEFAULT_KEYBOARD_LEFT)
  saveMapping(storage, KEYS.keyboardRight, s.keyboardRight, DEFAULT_KEYBOARD_RIGHT)
  write(storage, deviceKey, s.device.mode === 'auto' ? null : JSON.stringify(s.device))
  write(storage, KEYS.autoStart, s.autoStart ? null : '0')
  write(storage, KEYS.touchMode, s.touchMode === 'auto' ? null : s.touchMode)
  write(storage, KEYS.touchLayout, s.touchLayout === TOUCH_LAYOUTS[0] ? null : s.touchLayout)
  write(storage, KEYS.touchHold, s.touchHold ? null : '0')
  write(storage, KEYS.touchHoldMs, s.touchHoldMs === TOUCH_HOLD_MS.default ? null : s.touchHoldMs)
  write(storage, KEYS.touchSize, s.touchSize === 'm' ? null : s.touchSize)
  write(storage, KEYS.touchSlideMs, s.touchSlideMs === 300 ? null : s.touchSlideMs)
  write(storage, KEYS.touchRockPx, s.touchRockPx === 9 ? null : s.touchRockPx)
  write(storage, KEYS.touchSlideHoldMs, s.touchSlideHoldMs === 500 ? null : s.touchSlideHoldMs)
  write(storage, KEYS.touchSteer, s.touchSteer === 'medium' ? null : s.touchSteer)
  write(storage, KEYS.touchCue, s.touchCue ? null : '0')
  write(storage, KEYS.touchRetapMs, s.touchRetapMs === 250 ? null : s.touchRetapMs)
  write(storage, KEYS.touchAutoBoost, s.touchAutoBoost ? null : '0')
  write(storage, KEYS.touchBuffer, s.touchBuffer ? null : '0')
  write(storage, KEYS.touchSound, s.touchSound ? null : '0')
  write(storage, KEYS.gameLanguage, s.gameLanguage === 'auto' ? null : s.gameLanguage)
}

/** The key sets the game gets : [first keyboard, second keyboard] — the two halves in duo. */
export function keyboardSets(s) {
  return s.duo ? [s.keyboardLeft, s.keyboardRight] : [s.keyboard, s.keyboardRight]
}

/**
 * A store over the settings. `storage` : localStorage, or anything with getItem / setItem / removeItem.
 * `deviceKey` : where this page keeps its device choice (KEYS.device, GUEST_DEVICE_KEY) ; `random`
 * draws the default name (tests).
 */
export function createSettings(storage, { deviceKey = KEYS.device, random } = {}) {
  let value = loadSettings(storage, { deviceKey })
  const subs = []
  const set = (next) => {
    value = {
      ...next, name: cleanName(next.name), device: cleanDevice(next.device),
      touchMode: pick(next.touchMode, TOUCH_MODES), touchLayout: pick(next.touchLayout, TOUCH_LAYOUTS),
      touchSize: pick(next.touchSize, ['m', 's', 'l']), touchHoldMs: holdMs(next.touchHoldMs), touchSlideMs: slideMs(next.touchSlideMs), touchRockPx: rockPx(next.touchRockPx), touchSlideHoldMs: slideHoldMs(next.touchSlideHoldMs), touchSteer: pick(next.touchSteer, ['medium', 'low', 'high']), touchRetapMs: retapMs(next.touchRetapMs),
      gameLanguage: pick(next.gameLanguage, LANGUAGE_CHOICES),
    }
    saveSettings(storage, value, deviceKey)
    for (const fn of subs.slice()) fn(value)
  }
  if (!value.name) set({ ...value, name: randomName(random) })
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    patch: (p) => set({ ...value, ...p }),
    subscribe(fn) {
      subs.push(fn)
      fn(value)
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1) }
    },
  }
}
