// The page's settings as named presets (debug builds) : ?preset=<name>[,<name>…] starts the page on an
// in-memory store seeded with them, as a bot's window is (lib/second-window.js) — the player's own
// settings (localStorage) are neither read nor written. Read by store.js before the store exists.
import { KEYS } from '../lib/settings.js'
import { DEFAULT_KEYBOARD } from '../lib/mappings.js'

const J = JSON.stringify
// cross and circle exchanged on the keyboard (lib/mappings.js BUTTONS : square, circle, triangle,
// cross… — C is cross, V circle by default)
const REMAPPED = DEFAULT_KEYBOARD.map((key, i) => (i === 1 ? DEFAULT_KEYBOARD[3] : i === 3 ? DEFAULT_KEYBOARD[1] : key))

/** Each preset : the stored values it sets (lib/settings.js KEYS) ; `clean` is a first visit. */
export const PRESETS = {
  clean: {},
  named: { [KEYS.name]: 'Tester' },
  muted: { [KEYS.muted]: '1' },
  'unlock-off': { [KEYS.unlockAll]: '0' },
  duo: { [KEYS.duo]: '1' },
  'keyboard-only': { [KEYS.device]: J({ mode: 'keyboard', pad: null }) },
  'pad-only': { [KEYS.device]: J({ mode: 'gamepad', pad: null }) },
  remapped: { [KEYS.keyboard]: J(REMAPPED) },
}

/** The values of ?preset= (null when there is none) ; an unknown name throws. */
export function presetSeed(search) {
  const names = (new URLSearchParams(search).get('preset') ?? '').split(',').filter(Boolean)
  if (!names.length) return null
  const seed = {}
  for (const name of names) {
    if (!(name in PRESETS)) throw new Error(`preset « ${name} » : one of ${Object.keys(PRESETS).join(', ')}`)
    Object.assign(seed, PRESETS[name])
  }
  return seed
}
