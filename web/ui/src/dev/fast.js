// The tests' fast start (debug builds only, loaded by dev/index.js) : the game put where a test
// begins instead of walked there. Three pieces, each read by platform/ in the game :
//   snapshots   ctrDev.state.save() / .load(name) : upstream's quick state (F5 / F8). The harness
//               keeps the bytes (web/test/player/ctr.mjs saveState) in web/test/player/.states/
//               <build>/, one folder per build (the SHA-256 of ctr_native.wasm, /__build), served
//               by web/test/player/serve.py (/__states) — local, never in a site (web/pages/guard.sh).
//               globalThis.__ctrState, platform/web_debug_bridge.c.
//   direct start ?race=<track>&char=<name>[,<name>…]&mode=tt|arcade|vs&players=<n>[&laps=<n>][&diff=<0-2>] :
//               a race from the main menu through the game's own load, set as the menus set it.
//               globalThis.__ctrStart, platform/web_debug_bridge.c.
//   turbo       ?turbo=1 or ctrDev.turbo(true) : frames back to back (platform/native_platform.c),
//               never while Share runs (the guests watch in real time).
// ?state=<name> loads a snapshot at the game's first frame. Any of these starts the game without the
// boot screen's press.
import { ui } from '../state.svelte.js'

// include/namespace_Level.h (enum LevelID)
export const TRACKS = {
  'dingo-canyon': 0, 'dragon-mines': 1, 'blizzard-bluff': 2, 'crash-cove': 3, 'tiger-temple': 4,
  'papu-pyramid': 5, 'roo-tubes': 6, 'hot-air-skyway': 7, 'sewer-speedway': 8, 'mystery-caves': 9,
  'cortex-castle': 10, 'n-gin-labs': 11, 'polar-pass': 12, 'oxide-station': 13, 'coco-park': 14,
  'tiny-arena': 15, 'slide-coliseum': 16, 'turbo-track': 17,
}
// include/namespace_Vehicle.h (enum Characters)
export const CHARACTERS = {
  crash: 0, cortex: 1, tiny: 2, coco: 3, ngin: 4, dingodile: 5, polar: 6, pura: 7, pinstripe: 8,
  papu: 9, roo: 10, joe: 11, tropy: 12, penta: 13, 'fake-crash': 14,
}

const id = (table, v, what) => {
  if (v == null || v === '') return undefined
  if (/^\d+$/.test(v)) return Number(v)
  const n = table[String(v).toLowerCase()]
  if (n == null) throw new Error(`${what} « ${v} » : one of ${Object.keys(table).join(', ')}`)
  return n
}

/** The direct start's request from URL parameters (null when there is no `race`). */
export function startFromParams(q) {
  if (!q.get('race')) return null
  const mode = q.get('mode') || 'tt'
  if (!['tt', 'arcade', 'vs'].includes(mode)) throw new Error(`mode « ${mode} » : tt, arcade or vs`)
  const players = mode === 'tt' ? 1 : Number(q.get('players') || (mode === 'vs' ? 2 : 1))
  const characters = (q.get('char') || '').split(',').filter(Boolean).map((c) => id(CHARACTERS, c, 'character'))
  // the others keep their places in the default order, as on the character select
  for (let i = characters.length; i < 4; i++) characters.push([0, 1, 2, 3, 4, 5, 6, 7].find((c) => !characters.includes(c)))
  return {
    mode, players, characters,
    level: id(TRACKS, q.get('race'), 'track'),
    laps: Number(q.get('laps') || 3),
    difficulty: Number(q.get('diff') || 0),
  }
}

let build = null
/**
 * This build's id : the first 16 hex digits of ctr_native.wasm's SHA-256, as the test server
 * (web/test/player/serve.py, /__build) reads it — the page need not fetch the 6 MB game to hash it.
 */
async function buildId() {
  if (!build) {
    const r = await fetch('/__build', { cache: 'no-store' })
    if (!r.ok) throw new Error(`/__build : HTTP ${r.status} (served by web/test/player/serve.py ?)`)
    build = (await r.text()).trim()
  }
  return build
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frameOf = () => globalThis.__ctr?.frame ?? 0

/** One request to the game (platform/web_debug_bridge.c), resolved with the state after it. */
async function request(op, timeout = 20_000) {
  globalThis.__ctrState = { op }
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) {
    const S = globalThis.__ctrState
    if (S.done) return S
  }
  throw new Error(`the game took no ${op} in ${timeout / 1000} s (is it running ?)`)
}

// The fields a restored frame must give back as they were saved
const summary = (c) => c && JSON.stringify({ levelID: c.levelID, gameMode1: c.gameMode1, menu: c.menu && { title: c.menu.title, row: c.menu.row }, kart: c.kart && c.screen !== 'menu' ? c.kart.pos : null })

const statesUrl = async (name) => `/__states/${await buildId()}/${encodeURIComponent(name)}`

/**
 * Saves the game's state : the bytes stay in the page, globalThis.__ctrSaved = { bytes, at }, for the
 * harness to fetch over the devtools connection and keep (web/test/player/ctr.mjs saveState).
 * Returns { bytes : the size, at : __ctr's summary of the frame after the save, build }.
 */
export async function save() {
  const S = await request('save')
  if (S.error) throw new Error(S.error)
  globalThis.__ctrSaved = { bytes: S.bytes, at: summary(S.after) }
  return { bytes: S.bytes.length, at: globalThis.__ctrSaved.at, build: await buildId() }
}

/**
 * Loads the state saved as `name` : { ok, missing, expected, got }. ok : the frame after the load
 * is the one after the save (level, mode, menu row, kart). missing : no such state for this build.
 */
export async function load(name) {
  const url = await statesUrl(name)
  const [bin, meta] = await Promise.all([fetch(`${url}.ctrstate`, { cache: 'no-store' }), fetch(`${url}.json`, { cache: 'no-store' })])
  if (!bin.ok || !meta.ok) return { ok: false, missing: true }
  const bytes = new Uint8Array(await bin.arrayBuffer())
  const { at } = await meta.json()
  const FS = globalThis.Module.FS
  for (const dir of ['debug', 'debug/states']) try { FS.mkdir(dir) } catch { /* exists */ }
  FS.writeFile('debug/states/quick.ctrstates', bytes)
  const S = await request('load')
  const got = summary(S.after)
  return { ok: got === at, missing: false, expected: at, got }
}

/** Waits for the game's first published frame (window.__ctr). */
export async function firstFrame(timeout = 180_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(50)) if (frameOf() > 0) return
  throw new Error('the game never published a frame')
}

/** Installs the fast start from the URL ; returns ctrDev's `state`, `turbo` and `start`. */
export function installFast({ log = () => {} } = {}) {
  const q = new URLSearchParams(location.search)
  let turbo = q.get('turbo') === '1'
  Object.defineProperty(globalThis, '__ctrTurbo', { configurable: true, get: () => turbo && !ui.share?.sharing })
  const start = (s) => { globalThis.__ctrStart = s; return s }
  try {
    const s = startFromParams(q)
    if (s) log(`[CTR Dev] direct start : ${JSON.stringify(s)}`), start(s)
  } catch (e) {
    log(`[CTR Dev] direct start refused : ${e.message}`)
    globalThis.__ctrStartError = e.message
  }
  const name = q.get('state')
  if (name) {
    firstFrame().then(() => load(name)).then((r) => {
      globalThis.__ctrStateLoaded = { name, ...r }
      log(`[CTR Dev] state ${name} : ${r.missing ? 'none saved for this build' : r.ok ? 'loaded' : `loaded, not the saved frame (${r.got} vs ${r.expected})`}`)
    }, (e) => { globalThis.__ctrStateLoaded = { name, ok: false, error: String(e?.message ?? e) } })
  }
  return {
    state: { save, load, build: buildId },
    turbo: (on) => { turbo = !!on; return turbo },
    start,
  }
}
