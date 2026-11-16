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
  import { ui } from './state.svelte.js'
  import { live } from './store.js'

  let { pad, enabled = true } = $props()

  const s = $derived(live.current)
  let racing = $state(false)
  let hold = $state('idle')
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
  const shown = $derived(enabled && mode !== 'pad' && touchScreen && !padHides && !ui.settingsOpen && !ui.confirm)
  const kind = $derived(mode === 'minimal' ? 'minimal' : racing ? s.touchLayout : 'menu')

  $effect(() => {
    racing = pad.racing
    pad.onRacing = (r) => { racing = r }
    pad.onHold = (h) => { hold = h }
    return () => { pad.onRacing = null; pad.onHold = null }
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
  $effect(() => {
    if (!probe) return
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure) }
  })
  $effect(() => {
    pad.hold.configure({ enabled: s.touchHold, delay: s.touchHoldMs })
  })
  $effect(() => {
    pad.show(shown)
    // the stick's analog id kept for the whole mode (A, B), menus included : the game never sees
    // the pad switch between analog and digital at a race's start or end
    pad.analog = mode === 'enhanced' && s.touchLayout !== 'c'
    if (!shown || !view) return
    pad.place(kind, view, s.touchSize)
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
    if (!pad.down(e.pointerId, e.clientX, e.clientY)) return
    e.target.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
    paint()
  }
  // a finger on the controls is the game's : its moves do not wake the page's HUD (Hud.svelte
  // listens on window) — no style write per move beyond the pad's own
  function move(e) {
    if (!pad.move(e.pointerId, e.clientX, e.clientY)) return
    e.stopPropagation()
    paint()
  }
  function up(e) {
    if (!pad.up(e.pointerId)) return
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
  <div id="ctr-touch" class="touch" data-kind={kind} data-hold={hold} style:--hold-ms={`${s.touchHoldMs}ms`} role="application" aria-label="Touch controls"
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
        <div class={`ctl ${c.type}`} class:go={c.go} class:back={c.back} data-id={c.id} style={box(c)} use:register={c.id}>
          {#if c.go && kind !== 'minimal'}<span class="ring"></span>{/if}
          <span class="label">{c.label}</span>
        </div>
      {/if}
    {/each}
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
  [data-hold='held'] .go::after, [data-hold='retouched'] .go::after { content: 'HELD'; position: absolute; top: -26px; padding: 2px 8px; border-radius: 8px; background: #f59f00; color: #111; font-size: 11px; }
  .stick-base, .stick-knob { left: 0; top: 0; border-radius: 50%; pointer-events: none !important; }
  .stick-base { width: 104px; height: 104px; margin: -52px 0 0 -52px; background: rgba(255, 255, 255, 0.12); border: 2px solid rgba(255, 255, 255, 0.6); }
  .stick-knob { width: 50px; height: 50px; margin: -25px 0 0 -25px; background: rgba(255, 255, 255, 0.55); }
</style>
