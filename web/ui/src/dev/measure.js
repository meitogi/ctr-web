// The measuring panel (debug builds only, `?measure`, session 41) : does the game run on this phone ?
// A panel over the page leads the player through one measured race and keeps a report :
//   1. the disc picked (the boot screen's own picker, or « any file » : a picker with no type filter,
//      for a phone whose picker greys a .bin out) — the time it took to store it ;
//   2. Start (a tap : the sound's first resume happens inside it) boots the direct start of
//      fast.js (Crash Cove, Arcade, 3 laps), the Bot driving ; the panel samples __ctr every second ;
//   3. after the race : lock the phone, unlock ; another app, back — the lifecycle log says what the
//      page and the game did meanwhile ;
//   Send (POST /__report : serve.py --phone keeps it in web/test/player/.reports/) or Copy.
// What it reads : __ctr (platform/web_debug_bridge.c : frame, vblank, fps, screen, kart), ctrAudio
// (web/audio/audio.js : context, stats), the storage API, the canvas's WebGL context. A run that
// never reached its report (the page killed mid-race) is found on the next load (sessionStorage).
import { ui } from '../state.svelte.js'
import { summarize, verdict } from './measure-summary.js'

const RACE = { race: 'crash-cove', char: 'crash', mode: 'arcade', laps: '3' }
const RACE_TIMEOUT_MS = 300_000
const MARK = 'ctr-measure.running'
const g = globalThis

const now = () => Math.round(performance.now())
const mb = (bytes) => (bytes == null ? null : Math.round(bytes / 1048576))
const session = {
  get: () => { try { return JSON.parse(sessionStorage.getItem(MARK)) } catch { return null } },
  set: (v) => { try { v ? sessionStorage.setItem(MARK, JSON.stringify(v)) : sessionStorage.removeItem(MARK) } catch { /* private mode */ } },
}

/** True when the page was opened with ?measure : the URL gets the direct start's race (before fast.js reads it). */
export function measuring() {
  const q = new URLSearchParams(location.search)
  if (!q.has('measure')) return false
  if (!q.get('race')) {
    for (const k in RACE) q.set(k, RACE[k])
    history.replaceState(null, '', `${location.pathname}?${q}`)
  }
  return true
}

function device() {
  let gl = null
  try {
    const c = document.getElementById('canvas')
    const ctx = c?.getContext('webgl2') || c?.getContext('webgl')
    const info = ctx?.getExtension('WEBGL_debug_renderer_info')
    gl = ctx ? { version: ctx.getParameter(ctx.VERSION), renderer: info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER) } : null
  } catch { /* no context yet */ }
  const nav = navigator
  return {
    userAgent: nav.userAgent,
    platform: nav.userAgentData?.platform || (/iPhone|iPad/.test(nav.userAgent) ? 'iOS' : /Android/.test(nav.userAgent) ? 'Android' : nav.platform),
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio, orientation: screen.orientation?.type ?? null, inner: [innerWidth, innerHeight] },
    standalone: matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || nav.standalone === true,
    cores: nav.hardwareConcurrency ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    gl,
    apis: {
      opfs: !!nav.storage?.getDirectory,
      createWritable: typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype,
      audioWorklet: typeof AudioWorkletNode !== 'undefined',
      wakeLock: 'wakeLock' in nav,
      audioSession: nav.audioSession?.type ?? null,
      gamepads: 'getGamepads' in nav,
      vibrate: 'vibrate' in nav,
    },
  }
}

async function storage() {
  const s = navigator.storage
  if (!s) return null
  const [est, persisted] = await Promise.all([s.estimate?.().catch(() => null), s.persisted?.().catch(() => null)])
  return { usageMB: mb(est?.usage), quotaMB: mb(est?.quota), persisted: persisted ?? null }
}

function memory() {
  const heap = g.wasmMemory?.buffer?.byteLength ?? g.HEAPU8?.buffer?.byteLength ?? g.Module?.HEAPU8?.buffer?.byteLength
  const pm = performance.memory
  return { wasmHeapMB: mb(heap), jsHeapMB: pm ? mb(pm.usedJSHeapSize) : null, jsHeapLimitMB: pm ? mb(pm.jsHeapSizeLimit) : null }
}

const audioNow = () => {
  const a = g.ctrAudio
  const c = a?.context
  return c ? { state: c.state, sampleRate: c.sampleRate, baseLatencyMs: Math.round((c.baseLatency ?? 0) * 1000), outputLatencyMs: Math.round((c.outputLatency ?? 0) * 1000), stats: a.stats ? { ...a.stats } : null } : null
}

const css = `
#ctr-measure { position: fixed; z-index: 9999; left: max(8px, env(safe-area-inset-left)); top: max(8px, env(safe-area-inset-top));
  max-width: min(440px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-height: calc(100vh - 16px); overflow: auto; padding: 10px 12px; border-radius: 10px;
  background: rgba(10, 12, 20, 0.9); color: #f2f2f2; font: 14px/1.4 system-ui, sans-serif; -webkit-user-select: none; user-select: none }
#ctr-measure.small { max-width: 220px }
#ctr-measure.small .more { display: none }
#ctr-measure b { color: #ffd34d }
#ctr-measure .line { margin: 4px 0 }
#ctr-measure .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px }
#ctr-measure button { font: 600 15px system-ui, sans-serif; min-height: 44px; padding: 0 14px; border: 0; border-radius: 8px; background: #ffd34d; color: #111 }
#ctr-measure button.quiet { background: #333a4d; color: #eee }
#ctr-measure textarea { width: 100%; height: 120px; font: 11px monospace; -webkit-user-select: text; user-select: text }
`

/** Installs the panel ; `start` is main.js's startGame (the boot press). */
export function installMeasure({ start, handleFile, log = () => {} }) {
  const previous = session.get()
  session.set(null)
  const report = {
    kind: 'ctr-measure',
    version: g.__CTR_VERSION ?? null,
    at: new Date().toISOString(),
    killedRun: previous,
    device: device(),
    disc: null,
    race: null,
    audio: { first: null, changes: [] },
    memory: { atLoad: memory(), peak: null },
    storage: { atLoad: null, afterDisc: null, persistAsked: null },
    lifecycle: [],
    samples: [],
    errors: [],
  }
  storage().then((s) => { report.storage.atLoad = s })
  const gaps = []
  const state = { step: 'disc', raceFrom: 0, startTap: 0, discFrom: 0, lastFrame: 0, lastFrameAt: 0 }

  const event = (type, extra = {}) => {
    const c = g.__ctr
    report.lifecycle.push({ t: now(), type, visible: document.visibilityState, frame: c?.frame ?? null, vblank: c?.vblank ?? null, screen: c?.screen ?? null, audio: g.ctrAudio?.context?.state ?? null, ...extra })
    render()
  }
  document.addEventListener('visibilitychange', () => event('visibility'))
  for (const type of ['pagehide', 'pageshow', 'freeze', 'resume', 'blur', 'focus']) (type === 'freeze' || type === 'resume' ? document : window).addEventListener(type, () => event(type))
  const canvas = document.getElementById('canvas')
  canvas?.addEventListener('webglcontextlost', () => event('webglcontextlost'))
  canvas?.addEventListener('webglcontextrestored', () => event('webglcontextrestored'))
  addEventListener('error', (e) => report.errors.push({ t: now(), message: String(e.message) }))
  addEventListener('unhandledrejection', (e) => report.errors.push({ t: now(), message: String(e.reason) }))
  let watchedContext = null

  // the presents, seen from the page : every display refresh, has __ctr.frame moved ?
  const watch = () => {
    const f = g.__ctr?.frame ?? 0
    const t = performance.now()
    if (f !== state.lastFrame) {
      if (state.step === 'racing' && state.lastFrameAt && document.visibilityState === 'visible') gaps.push(Math.round(t - state.lastFrameAt))
      state.lastFrame = f
      state.lastFrameAt = t
    }
    requestAnimationFrame(watch)
  }
  requestAnimationFrame(watch)

  // ---- the panel ----
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.id = 'ctr-measure'
  document.body.appendChild(el)
  const any = Object.assign(document.createElement('input'), { type: 'file', hidden: true })
  any.onchange = () => { if (any.files[0]) { report.disc = { ...(report.disc ?? {}), picker: 'any file' }; handleFile(any.files[0]) } any.value = '' }
  el.after(any)

  const buttons = []
  const button = (label, run, quiet = false) => buttons.push({ label, run, quiet })
  let line = ''
  let more = ''
  function render() {
    buttons.length = 0
    const c = g.__ctr
    const s = report.race?.summary
    const killed = report.killedRun ? `<div class="line"><b>The last run never reached its report</b> (the page was reloaded or killed at ${report.killedRun.step}, ${report.killedRun.seconds ?? 0} s into it) — kept in this report.</div>` : ''
    switch (state.step) {
      case 'disc':
        if (ui.phase === 'preparing') {
          const p = ui.progress
          line = `Storing the disc : <b>${mb(p?.written) ?? 0} / ${mb(p?.total) ?? '?'} MB</b> · ${Math.round((now() - state.discFrom) / 1000)} s. Keep this page in front.`
        } else if (ui.phase === 'ready') {
          line = '<b>2 ·</b> Sound on (the side switch too). Tap <b>Start</b> : the Bot drives one Arcade race of Crash Cove, about 2 min. Do not touch the screen until it ends.'
          button('Start', onStart)
        } else if (ui.phase === 'checking') line = 'Looking for the disc in this browser…'
        else {
          line = `<b>1 ·</b> Pick the disc (<code>ctr-u.bin</code> or its .zip) with the button of this screen. If the picker greys the file out, use « Any file ».${ui.error ? `<br><b>Error :</b> ${ui.error}` : ''}`
          button('Any file', () => any.click(), true)
        }
        break
      case 'loading':
        line = `Loading the race… ${Math.round((now() - state.startTap) / 1000)} s · sound <b>${g.ctrAudio?.context?.state ?? 'not yet'}</b>`
        break
      case 'racing':
        line = `Racing <b>${Math.round((now() - state.raceFrom) / 1000)} s</b> · <b>${c?.fps ?? '?'} fps</b> · lap ${(c?.kart?.lap ?? 0) + 1} / 3 · sound ${g.ctrAudio?.context?.state ?? '?'}`
        break
      case 'after': {
        const hides = report.lifecycle.filter((e) => e.type === 'visibility' && e.visible === 'hidden' && e.t > state.raceEnd).length
        const v = report.race.verdict
        line = `Race measured : <b>median ${s.fps?.median ?? '?'} fps</b>, ${Math.round((s.fps?.slowShare ?? 0) * 100)} % of seconds under 28, clock ${s.vblankRate} VBlanks/s → <b>${v.runs ? 'it runs' : 'it does not run well'}</b>${v.runs ? '' : ` (${v.reasons.join(' ; ')})`}.<br>` +
          `<b>3 ·</b> Lock the phone, wait 10 s, unlock${hides >= 1 ? ' ✓' : ''}. Then the Home Screen (or another app) for 10 s, and back${hides >= 2 ? ' ✓' : ''}. Then <b>Send</b>.`
        break
      }
    }
    if (state.step !== 'racing' && state.step !== 'loading') {
      button('Send', send)
      button('Copy', copy, true)
      if (navigator.storage?.persist) button('Keep storage', persist, true)
    }
    button(el.classList.contains('small') ? 'More' : 'Less', () => { el.classList.toggle('small'); render() }, true)
    more = `<div class="more line" style="opacity:.75;font-size:12px">${report.version ?? ''} · ${report.device.platform} · ${report.device.standalone ? 'installed' : 'in the browser'} · storage ${report.storage.atLoad ? `${report.storage.atLoad.usageMB} / ${report.storage.atLoad.quotaMB} MB, ${report.storage.atLoad.persisted ? 'persistent' : 'may be evicted'}` : '…'}${state.sent ? ` · sent ${state.sent}` : ''}</div>`
    // the same panel again is left as it is : a tap on a button rebuilt under the finger is lost
    const html = `${killed}<div class="line">${line}</div>${more}<div class="row"></div>${state.text ? `<textarea readonly>${state.text}</textarea>` : ''}`
    const key = html + buttons.map((b) => b.label).join()
    if (key === state.html) return
    state.html = key
    el.innerHTML = html
    const row = el.querySelector('.row')
    for (const b of buttons) {
      const n = Object.assign(document.createElement('button'), { textContent: b.label, className: b.quiet ? 'quiet' : '' })
      n.onclick = b.run
      row.appendChild(n)
    }
  }

  function onStart({ started = false } = {}) {
    state.step = 'loading'
    state.startTap = now()
    session.set({ step: 'loading', at: new Date().toISOString() })
    g.ctrDev?.bot(true)
    if (!started) start()
    render()
  }

  async function persist() {
    try { report.storage.persistAsked = { granted: await navigator.storage.persist(), t: now() } } catch (e) { report.storage.persistAsked = { error: String(e) } }
    report.storage.afterDisc = await storage()
    render()
  }

  const text = () => JSON.stringify({ ...report, memory: { ...report.memory, now: memory() }, audio: { ...report.audio, now: audioNow() }, device: { ...report.device, ...device() } }, null, 1)
  async function send() {
    state.sent = 'sending…'
    render()
    try {
      const r = await fetch('__report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text() })
      state.sent = r.ok ? `as ${(await r.json()).saved}` : `failed (HTTP ${r.status}) : use Copy`
    } catch (e) {
      state.sent = `failed (${e.message}) : use Copy`
    }
    render()
  }
  async function copy() {
    const t = text()
    try { await navigator.clipboard.writeText(t); state.sent = 'copied' } catch { state.text = t; state.sent = 'select the text below' }
    render()
  }

  // ---- the clock of the panel : one sample a second ----
  setInterval(() => {
    const c = g.__ctr
    const ctx = g.ctrAudio?.context
    if (ctx && ctx !== watchedContext) {
      watchedContext = ctx
      report.audio.first = { t: now(), state: ctx.state, sinceStart: state.startTap ? now() - state.startTap : null }
      ctx.addEventListener('statechange', () => report.audio.changes.push({ t: now(), state: ctx.state, visible: document.visibilityState }))
    }
    // the boot screen's own Play (or a key) started the game : measured all the same
    if (state.step === 'disc' && (ui.phase === 'starting' || ui.phase === 'running')) onStart({ started: true })
    if (state.step === 'disc') {
      if (ui.phase === 'preparing' && !state.discFrom) { state.discFrom = now(); report.disc = { ...(report.disc ?? {}), picker: report.disc?.picker ?? 'boot screen', bytes: ui.progress?.total ?? null } }
      if (state.discFrom && ui.phase === 'ready' && !report.disc.storedInS) {
        report.disc.storedInS = Math.round((now() - state.discFrom) / 100) / 10
        storage().then((s) => { report.storage.afterDisc = s })
      }
      if (ui.phase === 'ready' && !report.disc) report.disc = { alreadyStored: true, bytes: ui.disc?.size ?? null }
    }
    if (state.step === 'loading' && c?.kart && (c.screen === 'race' || c.screen === 'countdown')) {
      state.step = 'racing'
      state.raceFrom = now()
      report.race = { loadS: Math.round((now() - state.startTap) / 100) / 10 }
    }
    if (state.step === 'racing') {
      if (document.visibilityState === 'visible') report.samples.push({ t: now(), fps: c?.fps ?? 0, vblank: c?.vblank ?? 0, frame: c?.frame ?? 0, lap: c?.kart?.lap ?? null })
      const m = memory()
      if (!report.memory.peak || m.wasmHeapMB > report.memory.peak.wasmHeapMB) report.memory.peak = m
      const seconds = Math.round((now() - state.raceFrom) / 1000)
      session.set({ step: 'racing', seconds, at: new Date().toISOString() })
      if (c?.kart?.finished || c?.screen === 'finished' || now() - state.raceFrom > RACE_TIMEOUT_MS) {
        state.step = 'after'
        state.raceEnd = now()
        session.set(null)
        const summary = summarize(report.samples, gaps)
        Object.assign(report.race, { summary, finished: !!c?.kart?.finished, rank: c?.kart?.rank ?? null, verdict: verdict(summary, { audioRan: report.audio.changes.some((a) => a.state === 'running') || report.audio.first?.state === 'running', killed: !!report.killedRun }) })
        log(`[CTR Measure] ${JSON.stringify(report.race)}`)
      }
    }
    render()
  }, 1000)
  render()
  g.ctrMeasure = { report, text }
}
