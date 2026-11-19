// The measuring panel (debug builds only, `?measure`, session 41) : does the game run on this phone ?
// A panel over the page leads the player through one measured race and keeps a report :
//   1. the disc picked (the boot screen's own picker, or « any file » : a picker with no type filter,
//      for a phone whose picker greys a .bin out) — the time it took to store it ;
//   2. Drive or Bot (a tap : the sound's first resume happens inside it) boots the direct start of
//      fast.js (Crash Cove, Arcade, 3 laps), the player or the Bot driving (the wheel can change
//      hands mid-race) ; the panel samples __ctr every second ; No panel : the page itself ;
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
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio, orientation: screen.orientation?.type ?? null, inner: [innerWidth, innerHeight], visual: globalThis.visualViewport ? [Math.round(visualViewport.width), Math.round(visualViewport.height)] : null, client: [document.documentElement.clientWidth, document.documentElement.clientHeight] },
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
#ctr-measure.small { left: 50%; transform: translateX(-50%); padding: 4px; border-radius: 0 0 10px 10px; top: env(safe-area-inset-top, 0px) }
#ctr-measure.small button { min-height: 32px; padding: 0 12px; font-size: 13px }
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
    // session 42 : the pads this phone hands the page (id, mapping, buttons, rumble), the buttons
    // seen pressed (which ones the system keeps for itself), the sound's state at the first press ;
    // the touch controls as set and drawn, the safe areas
    pads: { seen: [], pressed: {}, firstPress: null },
    touch: null,
    // each touch (the last 40) : the control it started on, how far it travelled down and up, and
    // the contact's size and pressure as this browser reports them (the rock on R reads them) ;
    // `late` : ms between the event's own time and its handler (the browser's delivery), `pull` :
    // ms from the handler to the game's next read of the touch pad — the page's share of the touch
    // latency (the screen's own, before the event's time, cannot be read from a page)
    touches: [],
  }
  storage().then((s) => { report.storage.atLoad = s })
  const padSeen = (gp, type) => {
    report.pads.seen.push({ t: now(), type, id: gp.id, index: gp.index, mapping: gp.mapping, buttons: gp.buttons.length, axes: gp.axes.length, rumble: gp.vibrationActuator ? (gp.vibrationActuator.effects ?? gp.vibrationActuator.type ?? true) : null, audio: g.ctrAudio?.context?.state ?? null })
    render()
  }
  const live = {}
  const r1 = (v) => Math.round(v * 10) / 10
  // the touches the game has not read yet : stamped at its next pull of the touch pad
  const unpulled = []
  let pullsWatched = false
  const watchPulls = () => {
    const input = g.Module?.ctrInput
    if (pullsWatched || !input?.touch) return
    pullsWatched = true
    const touch = input.touch
    input.touch = (...a) => {
      const ok = touch(...a)
      if (ok && unpulled.length) {
        const t = performance.now()
        for (const [l, t0] of unpulled) l.pull = r1(t - t0)
        unpulled.length = 0
      }
      return ok
    }
  }
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    watchPulls()
    const l = live[e.pointerId] = { t: now(), late: r1(performance.now() - e.timeStamp), pull: null, on: e.target?.closest?.('[data-id]')?.dataset.id ?? null, x0: Math.round(e.clientX), y0: e.clientY, dyMin: 0, dyMax: 0, w: [e.width, e.width], h: [e.height, e.height], p: [e.pressure, e.pressure] }
    unpulled.push([l, performance.now()])
  }, true)
  addEventListener('pointermove', (e) => {
    const l = live[e.pointerId]
    if (!l) return
    const dy = e.clientY - l.y0
    l.dyMin = Math.min(l.dyMin, dy); l.dyMax = Math.max(l.dyMax, dy)
    l.w = [Math.min(l.w[0], e.width), Math.max(l.w[1], e.width)]
    l.h = [Math.min(l.h[0], e.height), Math.max(l.h[1], e.height)]
    l.p = [Math.min(l.p[0], e.pressure), Math.max(l.p[1], e.pressure)]
  }, true)
  const touchEnd = (e) => {
    const l = live[e.pointerId]
    if (!l) return
    delete live[e.pointerId]
    // the same object : a tap shorter than the game's input update gets its `pull` after it ended
    report.touches.push(Object.assign(l, { ms: now() - l.t, dyMin: r1(l.dyMin), dyMax: r1(l.dyMax), w: l.w.map(r1), h: l.h.map(r1), p: l.p.map((v) => r1(v * 100) / 100) }))
    if (report.touches.length > 40) report.touches.shift()
  }
  addEventListener('pointerup', touchEnd, true)
  addEventListener('pointercancel', touchEnd, true)
  addEventListener('gamepadconnected', (e) => padSeen(e.gamepad, 'connected'))
  addEventListener('gamepaddisconnected', (e) => padSeen(e.gamepad, 'disconnected'))
  setInterval(() => {
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp) continue
      const seen = (report.pads.pressed[gp.id] ??= [])
      for (let b = 0; b < gp.buttons.length; b++) {
        if (!gp.buttons[b].pressed || seen.includes(b)) continue
        seen.push(b)
        report.pads.firstPress ??= { t: now(), button: b, audio: g.ctrAudio?.context?.state ?? null }
      }
    }
  }, 100)
  const touchNow = () => {
    const probe = document.querySelector('.probe')
    const cs = probe ? getComputedStyle(probe) : null
    const el = document.getElementById('ctr-touch')
    const st = g.ctrUI?.settings?.get?.() ?? {}
    return { mode: st.touchMode, layout: st.touchLayout, hold: st.touchHold, holdMs: st.touchHoldMs, size: st.touchSize, autoStart: st.autoStart,
      drawn: el ? el.dataset.kind : null, holds: g.ctrUI?.touchHolds?.() ?? [], insets: cs ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft] : null }
  }
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
          line = '<b>2 ·</b> Sound on (the side switch too). One Arcade race of Crash Cove, measured : <b>Drive</b> it yourself (the touch controls, or your pad), or let the <b>Bot</b> drive (do not touch the screen then). <b>No panel</b> : the game as it opens, menus and all, nothing measured.'
          button('Drive', () => onStart({ bot: false }))
          button('Bot', () => onStart({ bot: true }), true)
          button('No panel', () => { location.href = './' }, true)
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
        line = `Racing <b>${Math.round((now() - state.raceFrom) / 1000)} s</b> · <b>${c?.fps ?? '?'} fps</b> · lap ${(c?.kart?.lap ?? 0) + 1} / 3 · sound ${g.ctrAudio?.context?.state ?? '?'} · ${ui.bot ? 'the Bot drives' : 'you drive'}`
        // the wheel taken or given back mid-race
        button(ui.bot ? 'Take the wheel' : 'Bot drives', () => { g.ctrDev?.bot(!ui.bot); report.race.bot = [...(report.race.bot ?? []), { t: now(), on: ui.bot }]; render() }, true)
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
    // Less : the panel folds to one small button at the top's middle, out of the controls' way
    if (el.classList.contains('small')) buttons.length = 0
    button(el.classList.contains('small') ? 'Measure' : 'Less', () => { el.classList.toggle('small'); render() }, true)
    const tn = touchNow()
    more = `<div class="more line" style="opacity:.75;font-size:12px">${report.version ?? ''} · ${report.device.platform} · ${report.device.standalone ? 'installed' : 'in the browser'} · ${innerWidth} × ${innerHeight}${tn.insets ? ` · safe areas ${tn.insets.map((v) => Number.parseFloat(v) || 0).join(' ')}` : ''} · storage ${report.storage.atLoad ? `${report.storage.atLoad.usageMB} / ${report.storage.atLoad.quotaMB} MB, ${report.storage.atLoad.persisted ? 'persistent' : 'may be evicted'}` : '…'}</div>`
    // what Send / Copy did, in the small panel too (on the iPhone, « Less » hid it : Send tapped 4 times)
    const sent = state.sent ? `<div class="line"><b>Report ${state.sent}</b></div>` : ''
    // the same panel again is left as it is : a tap on a button rebuilt under the finger is lost
    const html = el.classList.contains('small') ? '<div class="row" style="margin:0"></div>'
      : `${killed}<div class="line">${line}</div>${more}${sent}<div class="row"></div>${state.text ? `<textarea readonly>${state.text}</textarea>` : ''}`
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

  function onStart({ started = false, bot = false } = {}) {
    state.step = 'loading'
    state.startTap = now()
    session.set({ step: 'loading', at: new Date().toISOString() })
    // who drives : the player (the touch controls, a pad) unless the Bot was asked for
    report.driver = bot ? 'bot' : 'player'
    g.ctrDev?.bot(bot)
    if (!started) start()
    render()
  }

  async function persist() {
    try { report.storage.persistAsked = { granted: await navigator.storage.persist(), t: now() } } catch (e) { report.storage.persistAsked = { error: String(e) } }
    report.storage.afterDisc = await storage()
    render()
  }

  const text = () => JSON.stringify({ ...report, memory: { ...report.memory, now: memory() }, audio: { ...report.audio, now: audioNow() }, device: { ...report.device, ...device() }, install: ui.install ? { ...ui.install } : null, touch: touchNow(), bot: (g.__ctrBotTrace ?? []).slice(-60) }, null, 1)
  async function send() {
    state.sent = 'sending…'
    render()
    report.storage.atSend = await storage()
    try {
      const r = await fetch('__report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text() })
      state.sent = r.ok ? `sent as ${(await r.json()).saved}` : `failed (HTTP ${r.status}) : use Copy`
    } catch (e) {
      state.sent = `failed (${e.message}) : use Copy`
    }
    render()
  }
  async function copy() {
    report.storage.atSend = await storage()
    const t = text()
    try { await navigator.clipboard.writeText(t); state.sent = 'copied' } catch { state.text = t; state.sent = 'not copied : select the text below' }
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
    // the disc stored : the page goes on to 'starting' (a direct start) or 'ready', or back to the
    // boot screen on an error — the first second out of 'preparing' times it
    if (state.discFrom && ui.phase !== 'preparing' && report.disc?.storedInS == null) {
      report.disc.storedInS = Math.round((now() - state.discFrom) / 100) / 10
      report.disc.error = ui.error || null
      storage().then((s) => { report.storage.afterDisc = s })
    }
    // the boot screen's own Play (or a key) started the game : measured all the same
    if (state.step === 'disc' && (ui.phase === 'starting' || ui.phase === 'running')) onStart({ started: true })
    if (state.step === 'disc') {
      if (ui.phase === 'preparing' && !state.discFrom) { state.discFrom = now(); report.disc = { ...(report.disc ?? {}), picker: report.disc?.picker ?? 'boot screen', bytes: ui.progress?.total ?? null } }
      if (ui.phase === 'ready' && !report.disc) report.disc = { alreadyStored: true, bytes: ui.disc?.size ?? null }
    }
    if (state.step === 'loading' && c?.kart && (c.screen === 'race' || c.screen === 'countdown')) {
      state.step = 'racing'
      state.raceFrom = now()
      report.race = { loadS: Math.round((now() - state.startTap) / 100) / 10 }
    }
    if (state.step === 'racing') {
      if (document.visibilityState === 'visible') report.samples.push({ t: now(), fps: c?.fps ?? 0, vblank: c?.vblank ?? 0, frame: c?.frame ?? 0, lap: c?.kart?.lap ?? null, speed: c?.kart?.speed ?? null, cp: c?.kart?.checkpoint ?? null, pos: c?.kart ? [c.kart.pos.x, c.kart.pos.z] : null, screen: c?.screen ?? null })
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
