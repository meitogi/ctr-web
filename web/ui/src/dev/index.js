// The debug builds' tools (__CTR_DEV__ : vite.config.js), loaded by main.js and guest.js — never
// in a release bundle : the « Bot » switch (bot.js : on by itself in the second window),
// Settings › Dev (Dev.svelte) with its second window (second.js), the tests' fast start (fast.js :
// snapshots, the direct start, turbo) and precise start (precise.js : a seed, replay, the card, frames,
// faults), the measuring panel (measure.js, ?measure : a race measured on a phone), globalThis.ctrDev
// for scripts. install() resolves once what must precede the game's boot
// is in place (main.js waits for it).
import { ui } from '../state.svelte.js'
import { guestPage, role } from '../store.js'
import { startBot } from './bot.js'
import { D } from './strings.js'
import { SECOND } from '../lib/second-window.js'
import { openSecond, walkToRace } from './second.js'
import { installFast } from './fast.js'
import { installPrecise } from './precise.js'
import { installMeasure, measuring } from './measure.js'

export function install({ toast = () => {}, start = () => {}, handleFile = () => {} } = {}) {
  const log = (line) => { console.log(line); globalThis.Module?.print?.(line) }
  ui.bot = !!role.second || ui.bot
  startBot(ui, { log })
  // ?measure (measure.js) puts its race in the URL before the direct start reads it
  const measure = !guestPage && measuring()
  const fast = installFast({ log })
  const { ready, ...precise } = installPrecise({ log })
  globalThis.ctrDev = {
    // web/pages/guard.sh refuses a release site that carries this name
    tools: 'ctr-dev-tools',
    // the game page only (Share's guest page hosts nothing)
    second: guestPage ? null : (mode) => openSecond(mode, { ui }),
    // the player suites : this window's menus walked to the race of `mode` (after second(mode))
    walk: guestPage ? null : async (mode) => {
      ui.second = { mode, text: D.secondSteps.menus, error: false }
      try {
        await walkToRace(SECOND[mode])
        ui.second = { mode, text: D.secondSteps.racing, error: false }
      } catch (e) {
        ui.second = { mode, text: String(e?.message ?? e), error: true }
      }
      return ui.second
    },
    bot: (on) => { ui.bot = !!on; return ui.bot },
    // the second window's progress ({ mode, text, error }) : Settings closes on the click
    status: () => (ui.second ? { ...ui.second } : null),
    toast,
    // the tests' fast start (fast.js) : snapshots, the direct start, turbo
    ...fast,
    // the precise start (precise.js) : seed, replay, card, pause / step / resume, fault, hit, item
    ...precise,
  }
  if (measure) installMeasure({ start, handleFile, log })
  return ready
}
