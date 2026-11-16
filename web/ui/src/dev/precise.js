// The precise start (debug builds only, loaded by dev/index.js) : what a test sets before it begins,
// beside fast.js's snapshots, direct start and turbo. Read by platform/ in the game
// (web_debug_bridge.c, native_platform.c) or by the page alone :
//   seed      ?seed=<n> or ctrDev.seed(n) : the game's random generators set from n on the first frame
//             of each race — the same race twice (items, the AI). globalThis.__ctrSeed.
//   replay    ctrDev.replay.record() / .stop() / .play(files) : upstream's input replay
//             (platform/native_replay_scheduler.c), its files kept by the harness in
//             web/test/player/.replays/ (ctr.mjs recordRace / playRace). globalThis.__ctrReplay.
//   card      ?card=<name> : the memory card web/test/player/.saves/<name>/ (served by serve.py,
//             /__saves) put in place of this browser's before the game reads it ; ?card=new : an
//             empty card. ctrDev.card.write(spec) / .ghost() : the game's progress set, then saved by
//             the game's own save (globalThis.__ctrCard) ; ctrDev.card.files() : the card's files.
//   frames    ?pause=1, ctrDev.pause() / .pauseAt(raceFrame) / .step(n) / .resume() : the game held after a frame, n frames
//             let through (globalThis.__ctrPause, platform/native_platform.c).
//   faults    ?fault=<a>[,<b>…] or ctrDev.fault(name, on) : disc-read (the disc's reads fail),
//             storage-full (the browser refuses to store a disc), card-full (the card refuses a
//             save), relay-silent (Share's relay never answers). The page alone.
// The settings presets (?preset=) are read earlier, by store.js (dev/presets.js).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frameOf = () => globalThis.__ctr?.frame ?? 0
const Module = () => globalThis.Module

async function waitFor(what, pred, timeout = 30_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) {
    const v = pred()
    if (v) return v
  }
  throw new Error(`${what} : nothing after ${timeout / 1000} s (is the game running ?)`)
}

/** Waits until the game has presented `n` more frames. */
const frames = async (n) => {
  const at = frameOf()
  await waitFor(`${n} frames`, () => frameOf() >= at + n)
}

// ---- the game's log lines of the replay (Module.print), kept for the tests ----
const replayLog = []
function captureLog() {
  const M = Module()
  if (!M || M.__ctrPrecisePrint) return
  const print = M.print
  M.print = (text) => {
    if (/^\[CTR (Replay|State)\]/.test(text)) replayLog.push(text)
    return print.call(M, text)
  }
  M.__ctrPrecisePrint = true
}

// ---- MEMFS helpers ----
const FS = () => {
  const fs = Module()?.FS
  if (!fs) throw new Error('the game is not loaded (Module.FS)')
  return fs
}
function mkdirs(path) {
  let at = ''
  for (const part of path.split('/').filter(Boolean)) {
    at += `${at || path.startsWith('/') ? '/' : ''}${part}`
    try { FS().mkdir(at) } catch { /* exists */ }
  }
}
/** Every file under `dir` : { 'relative/path': Uint8Array }. */
function readTree(dir, base = '') {
  const out = {}
  for (const name of FS().readdir(dir)) {
    if (name === '.' || name === '..') continue
    const path = `${dir}/${name}`
    const rel = base ? `${base}/${name}` : name
    if (FS().isDir(FS().stat(path).mode)) Object.assign(out, readTree(path, rel))
    else out[rel] = FS().readFile(path)
  }
  return out
}
function writeTree(dir, files) {
  for (const rel in files) {
    const path = `${dir}/${rel}`
    mkdirs(path.slice(0, path.lastIndexOf('/')))
    FS().writeFile(path, files[rel])
  }
}
/** The folder of the replay just recorded : upstream writes debug/reports/<date>/ctr-<time>/. */
function findReport(dir = 'debug/reports') {
  let found = null
  for (const name of FS().readdir(dir)) {
    if (name === '.' || name === '..') continue
    const path = `${dir}/${name}`
    if (name === 'input.ctrreplay') return dir
    if (FS().isDir(FS().stat(path).mode)) found = findReport(path) ?? found
  }
  return found
}

/** A kept folder's files through serve.py (/__saves/<name>/, /__replays/<name>/) : { file: Uint8Array }. */
async function fetchKept(kind, name, only = /./) {
  const base = `/__${kind}/${encodeURIComponent(name)}`
  const r = await fetch(`${base}/index.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`no ${kind.slice(0, -1)} « ${name} » (web/test/player/.${kind}/${name}/)`)
  const files = {}
  for (const file of (await r.json()).files) {
    if (!only.test(file)) continue
    const b = await fetch(`${base}/${file.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
    if (!b.ok) throw new Error(`${kind} « ${name} » : ${file} HTTP ${b.status}`)
    files[file] = new Uint8Array(await b.arrayBuffer())
  }
  return files
}

// ---- replay ----
// The files a replay plays from : input.ctrreplay (the pads, frame by frame, and what each frame
// gave), state.ctrstates (the checkpoint it starts from), memcard.seed/ (the card as it was).
const REPLAY_FILES = /^(input\.ctrreplay|state\.ctrstates|memcard\.seed\/.*)$/

const replay = {
  /** Records from the next race's first frame (after the seed) : resolves once it records. */
  async record() {
    captureLog()
    const from = replayLog.length
    globalThis.__ctrReplay = { op: 'record' }
    const state = await waitFor('the replay to start (a race to begin)', () => ['recording', 'failed'].includes(globalThis.__ctrReplay.state) && globalThis.__ctrReplay.state, 120_000)
    if (state === 'failed') throw new Error(`upstream's recorder refused : ${replayLog.slice(from).join(' | ') || 'no log line'}`)
    return { recording: true }
  },
  /**
   * Ends the recording : its files stay in the page (globalThis.__ctrReplayFiles, for the harness to
   * pull) ; returns { frames, files: { name: size }, samples }.
   */
  async stop() {
    const was = globalThis.__ctrReplay
    if (was?.state !== 'recording') throw new Error(`no replay is recording (${was?.state ?? 'none'})`)
    globalThis.__ctrReplay = { op: 'stop' }
    await waitFor('the replay to stop', () => globalThis.__ctrReplay.state === 'stopping')
    // RequestStop closes the files after the frame that was running
    await frames(2)
    const dir = findReport()
    if (!dir) throw new Error('no recorded replay in debug/reports')
    const files = {}
    const all = readTree(dir)
    for (const rel in all) if (REPLAY_FILES.test(rel)) files[rel] = all[rel]
    const frameCount = new DataView(files['input.ctrreplay'].buffer).getUint32(16, true)
    globalThis.__ctrReplayFiles = files
    const sizes = {}
    for (const rel in files) sizes[rel] = files[rel].length
    return { frames: frameCount, files: sizes, samples: was.samples ?? [], log: replayLog.slice() }
  },
  /**
   * Plays a replay : `files` (a name : web/test/player/.replays/<name>/ through serve.py's /__replays ;
   * or the files, globalThis.__ctrReplayFiles by default) written to MEMFS, then upstream's
   * playback from its first checkpoint, ended after its last frame. bypass : another build's
   * recording (upstream checks the build's identity). Resolves at the end :
   * { state, frames, samples, divergence (upstream's log lines, null when none), log }.
   */
  async play(files = globalThis.__ctrReplayFiles, { bypass = false, timeout = 600_000 } = {}) {
    captureLog()
    if (typeof files === 'string') files = await fetchKept('replays', files, REPLAY_FILES)
    const dir = 'debug/play'
    try { FS().unlink(`${dir}/input.ctrreplay`) } catch { /* none */ }
    writeTree(dir, files)
    // upstream's playback wants the card's seed folder, even an empty card's
    mkdirs(`${dir}/memcard.seed`)
    const frameCount = new DataView(files['input.ctrreplay'].buffer, files['input.ctrreplay'].byteOffset).getUint32(16, true)
    const from = replayLog.length
    globalThis.__ctrReplay = { op: 'play', path: `${dir}/input.ctrreplay`, frames: frameCount, bypass }
    const R = await waitFor('the replay to end', () => globalThis.__ctrReplay.done && globalThis.__ctrReplay, timeout)
    const log = replayLog.slice(from)
    const at = log.findIndex((l) => /divergence at replay frame/.test(l))
    return { state: R.state, frames: R.frame, of: frameCount, samples: R.samples, divergence: at < 0 ? null : log.slice(at, at + 5), log }
  },
  log: () => replayLog.slice(),
  /** A kept replay's files (web/test/player/.replays/<name>/, serve.py) : { file: Uint8Array }. */
  fetch: (name) => fetchKept('replays', name, REPLAY_FILES),
}

// ---- the memory card ----
const CARD = '/memcards/slot0'
const cardStamp = () => { try { return FS().stat(`${CARD}/BASCUS-94426-SLOTS`).mtime.getTime() } catch { return 0 } }
const card = {
  /** The card's files : { name: Uint8Array } (globalThis.__ctrCardFiles too, for the harness). */
  files() {
    let files = {}
    try { files = readTree(CARD) } catch { /* no card yet */ }
    globalThis.__ctrCardFiles = files
    const sizes = {}
    for (const name in files) sizes[name] = files[name].length
    return sizes
  },
  /**
   * The game's progress set from `spec`, then saved by the game (web_debug_bridge.c CardWrite), from
   * the main menu : { unlocks: [u32, u32], tt: [18 × timeTrialFlags], adv: { slot, rewards: [6 × u32],
   * name, character, hub }, version }. Resolves once the game has written the file.
   */
  async write(spec) {
    const before = cardStamp()
    globalThis.__ctrCard = { op: 'write', ...spec }
    const C = await waitFor('the card write request', () => globalThis.__ctrCard.done && globalThis.__ctrCard)
    if (C.state !== 'requested') throw new Error(C.state)
    await waitFor('the game to write the card', () => cardStamp() > before || globalThis.__ctr?.card?.screen === 6, 20_000)
    await frames(2)
    return { screen: globalThis.__ctr?.card?.screen, files: card.files() }
  },
  /** The Time Trial just finished saved as a ghost by the game (its end of race). */
  async ghost() {
    const ghosts = () => Object.keys(card.files()).filter((n) => /^BASCUS-94426G/.test(n)).length
    const before = ghosts()
    globalThis.__ctrCard = { op: 'ghost' }
    const C = await waitFor('the ghost save request', () => globalThis.__ctrCard.done && globalThis.__ctrCard)
    if (C.state !== 'requested') throw new Error(C.state)
    await waitFor('the game to write the ghost', () => ghosts() > before || globalThis.__ctr?.card?.screen === 6, 20_000)
    return { screen: globalThis.__ctr?.card?.screen, files: card.files() }
  },
}

/**
 * ?card=<name> : the card's files fetched (/__saves/<name>/, serve.py) before the game starts, and put
 * in place of this browser's once the game has read IndexedDB into /memcards (FS.syncfs at its boot,
 * platform/native_memcard.c) — then persisted like any save. ?card=new : no file.
 */
async function prepareCard(name) {
  const files = name === 'new' ? {} : await fetchKept('saves', name, /^BASCUS-94426/)
  const M = (globalThis.Module ??= {})
  M.preRun = [].concat(M.preRun ?? [], () => {
    const fs = M.FS
    const syncfs = fs.syncfs
    fs.syncfs = (populate, done) => syncfs.call(fs, populate, (err) => {
      fs.syncfs = syncfs
      if (populate) {
        mkdirs(CARD)
        for (const old of fs.readdir(CARD)) if (old !== '.' && old !== '..') fs.unlink(`${CARD}/${old}`)
        for (const file in files) fs.writeFile(`${CARD}/${file}`, files[file])
        globalThis.__ctrCardPut = { name, files: Object.keys(files) }
      }
      done(err)
    })
  })
}

// ---- frames ----
const pause = {
  /** Holds the game after the frame it is on ; resolves once held. */
  async pause() {
    globalThis.__ctrPause = { paused: true, steps: 0 }
    await waitFor('the game to hold', () => globalThis.__ctrPause.held)
    return { frame: frameOf(), frameCounter: globalThis.__ctr?.frameCounter }
  },
  /** Lets `n` game frames run, then holds again. */
  async step(n = 1) {
    const P = globalThis.__ctrPause
    if (!P?.paused) throw new Error('the game is not paused (ctrDev.pause())')
    const at = frameOf()
    P.held = false
    P.steps = n
    await waitFor(`${n} frames`, () => P.held && P.steps === 0 && frameOf() >= at + n)
    return { frames: frameOf() - at }
  },
  /** Holds the game on frame `n` of the race (__ctr.raceFrame : 0 is its first frame, the seed's). */
  async pauseAt(n) {
    globalThis.__ctrPause = { paused: false, steps: 0, at: n }
    await waitFor(`race frame ${n}`, () => globalThis.__ctrPause.held, 300_000)
    return { raceFrame: globalThis.__ctr?.raceFrame, frameCounter: globalThis.__ctr?.frameCounter }
  },
  resume() {
    if (globalThis.__ctrPause) globalThis.__ctrPause.paused = false
    return true
  },
}

// ---- faults ----
const faults = {}
const on = (name) => !!faults[name]
let installed = false
function installFaults() {
  if (installed) return
  installed = true
  // disc-read : a slice of the disc (the game's reads, platform/native_disc_image.c, and the page's
  // probe, disc.js) fails as a failing drive would. The disc is the only Blob this large.
  const DISC_MIN = 64 << 20
  const slice = Blob.prototype.slice
  Blob.prototype.slice = function (...a) {
    const part = slice.apply(this, a)
    if (this.size < DISC_MIN) return part
    const arrayBuffer = part.arrayBuffer
    part.arrayBuffer = function () {
      if (!on('disc-read')) return arrayBuffer.call(this)
      faults.discReads = (faults.discReads ?? 0) + 1
      return Promise.reject(new DOMException('A requested file or directory could not be found (fault)', 'NotReadableError'))
    }
    return part
  }
  // storage-full : storing a disc (disc.js storeDiscStream) refused as a full disk refuses it
  const W = globalThis.FileSystemWritableFileStream?.prototype
  if (W) {
    const write = W.write
    W.write = function (...a) {
      if (on('storage-full')) return Promise.reject(new DOMException('The quota has been exceeded (fault)', 'QuotaExceededError'))
      return write.apply(this, a)
    }
  }
  // relay-silent : Share's relay socket opens and never says a word (web/net/signaling.js)
  const Native = globalThis.WebSocket
  globalThis.WebSocket = class extends Native {
    constructor(url, ...rest) {
      super(url, ...rest)
      this.__silent = on('relay-silent')
    }
    addEventListener(type, fn, opts) {
      if (type === 'message' && this.__silent) return
      super.addEventListener(type, fn, opts)
    }
    set onmessage(fn) { super.onmessage = this.__silent ? null : fn }
    get onmessage() { return super.onmessage }
  }
}
// card-full : the card's folder read-only — the game's file open fails, which the native card
// reports as a full card (platform/native_memcard_adapter.c MEMCARD_Save)
function cardFull(full) {
  try {
    mkdirs(CARD)
    for (const name of FS().readdir(CARD)) if (name !== '.' && name !== '..') FS().chmod(`${CARD}/${name}`, full ? 0o444 : 0o666)
    FS().chmod(CARD, full ? 0o555 : 0o777)
    return true
  } catch {
    return false
  }
}
function fault(name, value = true) {
  if (!['disc-read', 'storage-full', 'card-full', 'relay-silent'].includes(name)) throw new Error(`fault « ${name} » : disc-read, storage-full, card-full or relay-silent`)
  installFaults()
  faults[name] = !!value
  if (name === 'card-full' && Module()?.FS) cardFull(!!value)
  return { ...faults }
}

/**
 * Installs the precise start from the URL ; returns ctrDev's `seed`, `replay`, `card`, `pause`,
 * `step`, `resume`, `fault` and `ready` (a promise : what must be in place before the game boots).
 */
export function installPrecise({ log = () => {} } = {}) {
  const q = new URLSearchParams(location.search)
  const seed = (n) => { globalThis.__ctrSeed = n == null ? null : Number(n) >>> 0; return globalThis.__ctrSeed }
  if (q.get('seed') != null) seed(q.get('seed')), log(`[CTR Dev] seed ${globalThis.__ctrSeed}`)
  if (q.get('pause') === '1') globalThis.__ctrPause = { paused: true, steps: 0 }
  const asked = (q.get('fault') || '').split(',').filter(Boolean)
  const ready = (async () => {
    captureLog()
    for (const f of asked) fault(f), log(`[CTR Dev] fault ${f}`)
    if (asked.includes('card-full')) {
      const M = (globalThis.Module ??= {})
      // once the card's folder exists (after the game's FS.syncfs) : the first frame
      const apply = () => (frameOf() > 0 ? cardFull(true) : setTimeout(apply, 100))
      M.preRun = [].concat(M.preRun ?? [], () => setTimeout(apply, 100))
    }
    const name = q.get('card')
    if (name) {
      await prepareCard(name).then(() => log(`[CTR Dev] card ${name}`), (e) => {
        globalThis.__ctrCardPut = { name, error: String(e?.message ?? e) }
        log(`[CTR Dev] card ${name} refused : ${e?.message ?? e}`)
      })
    }
  })()
  return { seed, replay, card, ...pause, fault, faults: () => ({ ...faults }), ready }
}
