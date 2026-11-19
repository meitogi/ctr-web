<script>
  // The touch controls (session 42) : the on-screen pad a phone plays with — the minimal one (the
  // pad's own buttons) or the enhanced one (A, B, C : lib/touch/layouts.js), the menus' reduced pad
  // while no race is driven. Only draws and feeds the fingers : what they press is lib/touch/pad.js,
  // pulled by the game once per input update (Module.ctrInput.touch) or sent by Share's guest page.
  //
  // Shown when Settings › Controls › Touch says so (auto : on a touch screen), the game running,
  // Settings closed ; hidden while a pad is connected — a touch on the screen brings it back.
  // Cheap on a phone (session 41 : ~30 fps with little headroom) : the controls' places are
  // computed on a resize only ; a finger's move writes the stick's knob and the pressed classes,
  // nothing else ; the hold's ring is a CSS animation.
  import { TOUCH_BUFFER_MS, TOUCH_STEER, touchTraits } from './lib/settings.js'
  import { createCue } from './lib/touch/cue.js'
  import { ui } from './state.svelte.js'
  import { live } from './store.js'

  // `tutorial` : this page shows the first-race tutorial (the game's own page ; not Share's guest
  // page, whose Start would pause the host's game)
  let { pad, enabled = true, tutorial = false } = $props()

  const s = $derived(live.current)
  let racing = $state(false)
  let hold = $state('idle')
  let slideLock = $state('idle')
  let boostWindow = $state(false)
  // the slide's boosts made, as the game counts them, and where « 1 · 2 · 3 » is drawn : above the
  // thumb that last touched a boost control, else above the first of them
  let made = $state(0)
  let pipsAt = $state.raw(null)
  const cue = createCue()
  // a pad connected hides the controls until the screen is touched again
  let padHides = $state(ui.pads.length > 0)
  let touched = $state(false)
  let view = $state(null)
  let controls = $state.raw([])
  let probe = $state(null)
  let knob = $state(null)
  let base = $state(null)

  const mode = $derived(s.touchMode === 'auto' ? 'enhanced' : s.touchMode)
  const touchScreen = $derived(!!ui.install?.touch || touched)
  const shown = $derived(enabled && mode !== 'pad' && touchScreen && !padHides && !ui.settingsOpen && !ui.confirm && !ui.touchEditor)
  const has = $derived(touchTraits(s))
  const kind = $derived(mode === 'minimal' ? 'minimal' : racing ? s.touchLayout : 'menu')

  $effect(() => {
    racing = pad.racing
    pad.onRacing = (r) => { racing = r }
    pad.onHold = (h) => { hold = h }
    pad.onSlide = (h) => { slideLock = h }
    pad.onWindow = (w) => {
      boostWindow = w
      if (!w) return
      place()
      if (live.current.touchSound && pad.shown && mode === 'enhanced') cue.red()
    }
    pad.onBoosts = (n) => {
      if (n > made && live.current.touchSound && pad.shown && mode === 'enhanced') cue.made(n)
      if (n) place()
      made = n
    }
    return () => { pad.onRacing = null; pad.onHold = null; pad.onSlide = null; pad.onWindow = null; pad.onBoosts = null }
  })

  function place() {
    const at = pad.boostAt
    const c = at ? null : pad.controls.find((k) => k.boosts || k.anchor || k.boost)
    const x = at ? at.x : c ? (c.cx ?? c.x + c.w / 2) : 0
    const y = at ? at.y : c ? (c.cy ?? c.y + c.h / 2) : 0
    if (!at && !c) return
    pipsAt = { x: Math.max(60, Math.min(window.innerWidth - 60, x)), y: Math.max(24, y - 64) }
  }

  // the first race played with the touch controls : the tutorial, once (asked for again in
  // Settings : 'new') ; never by itself under the tests' harness
  $effect(() => {
    const fresh = s.touchTutorial === 'new' || (s.touchTutorial === null && !globalThis.__player)
    // (not with a pad connected : its player does not need the cards, and they would close at once)
    if (tutorial && racing && shown && fresh && !ui.pads.length) ui.touchTutorial = true
  })

  let pads = ui.pads.length
  $effect(() => {
    const n = ui.pads.length
    if (n > pads) padHides = true
    pads = n
  })
  $effect(() => {
    const onDown = (e) => {
      if (e.pointerType !== 'touch') return
      touched = true
      padHides = false
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  })

  // the viewport and its safe areas (env() read off a probe : no JS API for them)
  function measure() {
    if (!probe) return
    const cs = getComputedStyle(probe)
    const px = (v) => Number.parseFloat(v) || 0
    view = { W: window.innerWidth, H: window.innerHeight, left: px(cs.paddingLeft), right: px(cs.paddingRight), top: px(cs.paddingTop), bottom: px(cs.paddingBottom) }
  }
  // an iPhone opened straight in landscape gives its safe areas a moment after the first layout,
  // without always a resize : measured again a little later, and on the visual viewport's resize
  $effect(() => {
    if (!probe) return
    measure()
    const vv = window.visualViewport
    const later = [setTimeout(measure, 400), setTimeout(measure, 1500)]
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    vv?.addEventListener('resize', measure)
    return () => {
      for (const t of later) clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      vv?.removeEventListener('resize', measure)
    }
  })
  $effect(() => {
    pad.hold.configure({ enabled: s.touchHold, delay: s.touchHoldMs })
    // the slide kept through a lift : the enhanced pad's (the minimal one is the pad, 1:1)
    pad.slideMs = mode === 'enhanced' ? s.touchSlideMs : 0
    pad.rockPx = mode === 'enhanced' ? s.touchRockPx : 0
    pad.slideHoldMs = mode === 'enhanced' ? s.touchSlideHoldMs : 0
    pad.steer = mode === 'enhanced' ? TOUCH_STEER[s.touchSteer] : { reach: 1, curve: 1 }
    // the slide from the stick : a stick to re-touch (A, B, D)
    pad.retapMs = mode === 'enhanced' && has.retap ? s.touchRetapMs : 0
    pad.autoBoost = mode === 'enhanced' && has.gesture && s.touchAutoBoost
    pad.bufferMs = mode === 'enhanced' && s.touchBuffer ? TOUCH_BUFFER_MS : 0
  })
  $effect(() => {
    pad.show(shown)
    // the stick's analog id kept for the whole mode (A, B), menus included : the game never sees
    // the pad switch between analog and digital at a race's start or end
    pad.analog = mode === 'enhanced' && has.stick
    if (!shown || !view) return
    pad.place(kind, view, s.touchSize, kind === 'mine' ? s.touchCustom : null)
    if (controls !== pad.controls) controls = pad.controls
  })

  // ---- fingers ----
  const els = {}
  const pressed = {}
  function paint() {
    const r = pad.read()
    const on = {}
    for (const id of r.ids) on[id] = true
    for (const id in els) {
      const was = !!pressed[id]
      if (was !== !!on[id]) {
        els[id]?.classList.toggle('on', !!on[id])
        pressed[id] = !!on[id]
      }
    }
    if (r.at && knob && base) {
      base.classList.toggle('slide', r.ids.includes('steer-slide'))
      base.classList.toggle('brake', r.ids.includes('brake'))
      base.classList.toggle('gas', r.ids.includes('gas'))
      base.style.transform = `translate(${r.at.ox}px, ${r.at.oy}px)`
      knob.style.transform = `translate(${r.at.x}px, ${r.at.y}px)`
      base.hidden = false
      knob.hidden = false
    } else if (base && !base.hidden) {
      base.hidden = true
      knob.hidden = true
    }
  }
  function down(e) {
    if (!pad.down(e.pointerId, e.clientX, e.clientY, performance.now(), e.pointerType === 'touch' ? e.width : 0)) return
    e.target.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
    paint()
  }
  // a finger on the controls is the game's : its moves do not wake the page's HUD (Hud.svelte
  // listens on window) — no style write per move beyond the pad's own
  function move(e) {
    if (!pad.move(e.pointerId, e.clientX, e.clientY, e.pointerType === 'touch' ? e.width : 0)) return
    e.stopPropagation()
    paint()
  }
  function up(e) {
    if (!pad.up(e.pointerId, performance.now())) return
    e.stopPropagation()
    paint()
  }
  function register(node, id) {
    els[id] = node
    return { destroy() { if (els[id] === node) { delete els[id]; delete pressed[id] } } }
  }
  const box = (c) => (c.type === 'button' || c.type === 'dpad'
    ? `left:${c.cx - c.r}px;top:${c.cy - c.r}px;width:${2 * c.r}px;height:${2 * c.r}px`
    : `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`)
</script>

<div class="probe" bind:this={probe} aria-hidden="true"></div>
{#if shown && view}
  <div id="ctr-touch" class="touch" data-kind={kind} data-hold={hold} data-slide={slideLock} data-window={s.touchCue && boostWindow ? 'red' : null} style:--hold-ms={`${s.touchHoldMs}ms`} style:--slide-ms={`${s.touchSlideHoldMs}ms`} role="application" aria-label="Touch controls"
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onlostpointercapture={up}
    oncontextmenu={(e) => e.preventDefault()}>
    {#each controls as c (c.id)}
      {#if c.type === 'stick'}
        <div class="zone" data-id={c.id} style={box(c)} use:register={c.id}></div>
      {:else if c.type === 'dpad'}
        <div class="dpad" data-id={c.id} style={box(c)} use:register={c.id}>
          <span class="arm up"></span><span class="arm down"></span><span class="arm left"></span><span class="arm right"></span>
        </div>
      {:else}
        <div class={`ctl ${c.type}`} class:go={c.go} class:back={c.back} class:boosts={c.boosts || c.anchor || c.boost || (c.group && (c.bits & 0x400))} data-id={c.id} style={`${box(c)}${c.opacity < 1 ? `;opacity:${c.opacity}` : ''}`} use:register={c.id}>
          {#if c.go && kind !== 'minimal'}<span class="ring"></span>{/if}
          {#if c.anchor}<span class="ring slide-ring"></span>{/if}
          <span class="label">{c.label}</span>
        </div>
      {/if}
    {/each}
    {#if s.touchCue && mode === 'enhanced' && pipsAt && (made > 0 || boostWindow)}
      <div class="pips" data-made={made} style={`left:${pipsAt.x}px;top:${pipsAt.y}px`} aria-hidden="true">
        {#each [1, 2, 3] as n}<span class:made={n <= made} class:now={boostWindow && n === made + 1}>{n}</span>{/each}
      </div>
    {/if}
    <div class="stick-base" bind:this={base} hidden></div>
    <div class="stick-knob" bind:this={knob} hidden></div>
  </div>
{/if}

<style>
  .probe { position: fixed; visibility: hidden; pointer-events: none; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  /* the layer lets everything through but its controls (the page's speaker / gear stay reachable) */
  .touch { position: fixed; inset: 0; z-index: 15; pointer-events: none; touch-action: none;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  .touch > * { position: absolute; pointer-events: auto; touch-action: none; }
  .zone { background: transparent; }
  .ctl, .dpad { display: grid; place-items: center; color: #fff; font: 600 12px var(--text); letter-spacing: 0.04em;
    background: rgba(255, 255, 255, 0.16); border: 2px solid rgba(255, 255, 255, 0.7); box-sizing: border-box; }
  .ctl.button { border-radius: 50%; }
  .ctl.rect { border-radius: 10px; }
  /* E's right half : a faint frame, no label ; GO held, it turns gold at its edge only */
  .ctl.rect.go { background: rgba(255, 255, 255, 0.04); border: 1px dashed rgba(255, 255, 255, 0.35); }
  .ctl.rect .ring { display: none; }
  .ctl :global(.label) { pointer-events: none; }
  .ctl.back { border-color: #ff6b6b; }
  .ctl.go { border-color: #f59f00; border-width: 3px; font-size: 18px; }
  .ctl:global(.on) { background: rgba(255, 255, 255, 0.45); }
  .dpad { border-radius: 50%; background: transparent; border: 0; }
  .arm { position: absolute; width: 34%; height: 34%; border-radius: 8px; background: rgba(255, 255, 255, 0.16); border: 2px solid rgba(255, 255, 255, 0.7); box-sizing: border-box; pointer-events: none; }
  .arm.up { top: 0; left: 33%; } .arm.down { bottom: 0; left: 33%; } .arm.left { left: 0; top: 33%; } .arm.right { right: 0; top: 33%; }
  .dpad:global(.on) .arm { background: rgba(255, 255, 255, 0.3); }
  .ring { position: absolute; inset: -7px; border-radius: 50%; border: 5px solid #f59f00; opacity: 0; pointer-events: none;
    -webkit-mask: conic-gradient(#000 var(--fill, 0turn), transparent 0); mask: conic-gradient(#000 var(--fill, 0turn), transparent 0); }
  @property --fill { syntax: '<angle>'; inherits: false; initial-value: 0turn; }
  [data-hold='pressing'] .ring { opacity: 1; animation: fill var(--hold-ms) linear forwards; }
  @keyframes fill { from { --fill: 0turn; } to { --fill: 1turn; } }
  [data-hold='held'] .go, [data-hold='retouched'] .go { background: rgba(245, 159, 0, 0.75); color: #111; }
  /* the boost's moment (the game's red exhaust, Settings › Touch) : the controls that boost light up red */
  [data-window='red'] .ctl.boosts { background: rgba(255, 70, 50, 0.8); border-color: #ff4632; box-shadow: 0 0 18px rgba(255, 70, 50, 0.9); }
  /* E's right half is the boost control : the whole zone, fainter (the race shows through) */
  [data-window='red'] .ctl.rect.go.boosts { background: rgba(255, 70, 50, 0.3); border: 2px solid #ff4632; box-shadow: none; }
  /* « 1 · 2 · 3 » : gold = made, red = tap now, hollow = to come */
  .pips { display: flex; gap: 8px; transform: translateX(-50%); pointer-events: none !important; }
  .pips span { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; font: 700 13px var(--text);
    color: #fff; border: 2px solid rgba(255, 255, 255, 0.7); background: rgba(0, 0, 0, 0.25); }
  .pips span.made { background: #f59f00; border-color: #f59f00; color: #111; }
  .pips span.now { background: #ff4632; border-color: #fff; }
  /* the held slide (R) : its ring fills while R is kept down in a slide, then R turns blue, HELD */
  [data-hold] .slide-ring { border-color: #4dabf7; }
  [data-hold='pressing'] .slide-ring { opacity: 0; animation: none; }
  [data-slide='pressing'] .slide-ring { opacity: 1; animation: fill var(--slide-ms) linear forwards; }
  [data-slide='held'] .ctl:global([data-id='slide']) { background: rgba(77, 171, 247, 0.75); color: #111; }
  [data-slide='held'] .ctl:global([data-id='slide'])::after { content: 'HELD'; position: absolute; top: -26px; padding: 2px 8px; border-radius: 8px; background: #4dabf7; color: #111; font-size: 11px; }
  [data-hold='held'] .go::after, [data-hold='retouched'] .go::after { content: 'HELD'; position: absolute; top: -26px; padding: 2px 8px; border-radius: 8px; background: #f59f00; color: #111; font-size: 11px; }
  .stick-base, .stick-knob { left: 0; top: 0; border-radius: 50%; pointer-events: none !important; }
  .stick-base { width: 104px; height: 104px; margin: -52px 0 0 -52px; background: rgba(255, 255, 255, 0.12); border: 2px solid rgba(255, 255, 255, 0.6); }
  .stick-base:global(.slide) { border-color: #4dabf7; background: rgba(77, 171, 247, 0.3); }
  /* the stick pulled straight down : the brake */
  .stick-base:global(.brake) { border-color: #ff4632; background: rgba(255, 70, 50, 0.35); }
  /* pushed straight up : GO */
  .stick-base:global(.gas) { border-color: #f59f00; background: rgba(245, 159, 0, 0.3); }
  .stick-knob { width: 50px; height: 50px; margin: -25px 0 0 -25px; background: rgba(255, 255, 255, 0.55); }
</style>
