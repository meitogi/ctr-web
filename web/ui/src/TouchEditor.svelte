<script>
  // « My pad » — the touch layout's editor (session 42b, the user : « laisser la possibilité au
  // joueur de faire sa propre manette » ; design : plans/…/proofs/42/design/11-my-pad-editor).
  // Over the game, paused if a race runs : each control of the layout in use is dragged where the
  // player wants it ; the picked one gets its size, its opacity and Remove ; « + Add » offers the
  // super buttons (lib/touch/custom.js PALETTE) then the pad's plain ones ; « Start from… » takes
  // another layout or the 3-finger preset ; Reset goes back to what the editor opened on ; Done
  // keeps it as the layout « Mine » (lib/settings.js touchCustom). Pause cannot be removed ; a pad
  // that cannot accelerate or steer is told, not refused.
  import { T } from './lib/strings.js'
  import { band } from './lib/touch/layouts.js'
  import { pauseGame } from './lib/touch/pause.js'
  import { OPACITY, PALETTE, SCALE, STARTS, centre, fromPalette, fromSpec, missing, moveTo, scaleTo, startFrom, toSpec } from './lib/touch/custom.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { pad, pause = true } = $props()

  const s = live.current
  const view = pad.view ?? { W: window.innerWidth, H: window.innerHeight }
  const size = s.touchSize
  const opened = s.touchLayout === 'mine' && s.touchCustom ? fromSpec(s.touchCustom, view, size) : startFrom(s.touchLayout === 'mine' ? 'e' : s.touchLayout, view, size)
  let from = s.touchLayout === 'mine' ? (s.touchCustom?.from ?? 'e') : s.touchLayout
  let controls = $state.raw(opened)
  let picked = $state(null)
  let tray = $state(null) // null · 'add' · 'from'
  const lacks = $derived(missing(controls))
  const sel = $derived(controls.find((c) => c.id === picked) ?? null)

  // the game paused while the pad is edited (the page's own Start, as the II button), resumed after
  $effect(() => {
    if (!pause) return
    const held = pauseGame(pad)
    return () => held.release()
  })

  const box = (c) => (c.type === 'button' || c.type === 'dpad'
    ? `left:${c.cx - c.r}px;top:${c.cy - c.r}px;width:${2 * c.r}px;height:${2 * c.r}px`
    : `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`)
  const name = (c) => (c.type === 'stick' ? 'STICK' : c.type === 'dpad' ? 'D-PAD' : c.gesture ? 'GESTURE' : c.label)
  const change = (id, fn) => { controls = controls.map((c) => (c.id === id ? fn(c) : c)) }

  let drag = null
  function down(e, c) {
    picked = c.id
    const [cx, cy] = centre(c)
    drag = { id: c.id, pointer: e.pointerId, dx: e.clientX - cx, dy: e.clientY - cy }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.pointer) return
    change(drag.id, (c) => moveTo(c, e.clientX - drag.dx, e.clientY - drag.dy, view))
  }
  function up(e) {
    if (drag && e.pointerId === drag.pointer) drag = null
  }
  function add(k) {
    // in the middle of where the controls go (in portrait, the band under the game)
    const b = band(view)
    const c = fromPalette(k, controls, view, size, view.W / 2, (b.y0 ?? 0) + b.H / 2)
    controls = [...controls, c]
    picked = c.id
    tray = null
  }
  function start(k) {
    controls = startFrom(k, view, size)
    from = k
    picked = null
    tray = null
  }
  function reset() {
    controls = opened
    picked = null
    tray = null
  }
  function remove() {
    controls = controls.filter((c) => c.id !== picked)
    picked = null
  }
  function done() {
    // the sticks' zones first, as fromSpec gives them back
    settings.patch({ touchCustom: toSpec(controls, view, size, from), touchLayout: 'mine' })
    ui.touchEditor = false
  }
  const supers = Object.keys(PALETTE).filter((k) => PALETTE[k].super)
  const plain = Object.keys(PALETTE).filter((k) => !PALETTE[k].super)
</script>

<div id="ctr-touch-editor" class="editor" role="application" aria-label={T.touchEdit} onpointermove={move} onpointerup={up} onpointercancel={up}
  onpointerdown={() => { picked = null }} oncontextmenu={(e) => e.preventDefault()}>
  {#each controls as c (c.id)}
    <div class={`ctl ${c.type}`} class:picked={c.id === picked} class:fixed={c.id === 'start'} data-id={c.id} style={`${box(c)};opacity:${c.opacity ?? 1}`}
      onpointerdown={(e) => down(e, c)}>
      <span>{name(c)}</span>
    </div>
  {/each}

  <div class="bar" onpointerdown={(e) => e.stopPropagation()}>
    <button type="button" id="ctr-edit-add" class="blue" onclick={() => { tray = tray === 'add' ? null : 'add' }}>{T.touchEditAdd}</button>
    <button type="button" id="ctr-edit-from" onclick={() => { tray = tray === 'from' ? null : 'from' }}>{T.touchEditFrom}</button>
    <button type="button" id="ctr-edit-reset" class="red" onclick={reset}>{T.touchEditReset}</button>
    <span class="warn" id="ctr-edit-warn">{#if lacks.go}{T.touchEditNoGo}{/if}{#if lacks.go && lacks.steer} · {/if}{#if lacks.steer}{T.touchEditNoSteer}{/if}</span>
    <button type="button" id="ctr-edit-done" class="done" onclick={done}>{T.touchEditDone}</button>
  </div>

  {#if sel && !tray}
    <div class="picked-bar" onpointerdown={(e) => e.stopPropagation()}>
      <label>{T.touchEditSize}<input id="ctr-edit-size" type="range" min={SCALE.min} max={SCALE.max} step="0.05" value={sel.scale ?? 1} oninput={(e) => change(sel.id, (c) => scaleTo(c, Number(e.currentTarget.value)))} /></label>
      <label>{T.touchEditOpacity}<input id="ctr-edit-opacity" type="range" min={OPACITY.min} max={OPACITY.max} step="0.05" value={sel.opacity ?? 1} oninput={(e) => change(sel.id, (c) => ({ ...c, opacity: Number(e.currentTarget.value) }))} /></label>
      {#if sel.id === 'start'}<span class="dim">{T.touchEditPause}</span>{:else}<button type="button" id="ctr-edit-remove" class="red" onclick={remove}>{T.touchEditRemove}</button>{/if}
    </div>
  {/if}

  {#if tray === 'add'}
    <div class="tray" id="ctr-edit-tray" onpointerdown={(e) => e.stopPropagation()}>
      <div class="head"><b>{T.touchEditAddTitle}</b><button type="button" class="red" onclick={() => { tray = null }}>{T.close}</button></div>
      <p class="gold">{T.touchEditSuper}</p>
      <div class="grid">
        {#each supers as k}<button type="button" data-add={k} onclick={() => add(k)}><b>{T.touchEditNames[k]}</b><small>{T.touchEditWhat[k]}</small></button>{/each}
      </div>
      <p class="dim">{T.touchEditPlain}</p>
      <div class="row">
        {#each plain as k}<button type="button" data-add={k} onclick={() => add(k)}>{PALETTE[k].label ?? 'D-pad'}</button>{/each}
      </div>
    </div>
  {:else if tray === 'from'}
    <div class="tray small" id="ctr-edit-starts" onpointerdown={(e) => e.stopPropagation()}>
      <div class="head"><b>{T.touchEditFrom}</b><button type="button" class="red" onclick={() => { tray = null }}>{T.close}</button></div>
      <div class="row">
        {#each STARTS as k}<button type="button" data-start={k} onclick={() => start(k)}>{k === 'three' ? T.touchEditThree : T.touchLayouts[k]}</button>{/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .editor { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.35); touch-action: none; font: 600 13px var(--text); color: #fff;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .ctl { position: absolute; display: grid; place-items: center; box-sizing: border-box; touch-action: none; cursor: grab;
    background: rgba(255, 255, 255, 0.18); border: 2px solid rgba(255, 255, 255, 0.75); font-size: 12px; letter-spacing: 0.04em; }
  .ctl.button, .ctl.dpad { border-radius: 50%; }
  .ctl.rect { border-radius: 10px; }
  .ctl.stick { border-radius: 14px; border-style: dashed; background: rgba(255, 255, 255, 0.05); }
  .ctl.picked { border-color: #4f8cff; border-width: 4px; background: rgba(79, 140, 255, 0.3); }
  .ctl.fixed { border-style: dotted; }
  .ctl span { pointer-events: none; }
  button { min-height: 34px; padding: 6px 12px; border-radius: 9px; border: 1px solid #3a3f52; background: #171a24; color: #f2f3f7; font: inherit; cursor: pointer; }
  button.blue { border-color: #4f8cff; }
  button.red { border-color: #e03131; color: #ff8787; }
  button.done { background: #fff; color: #111; border-color: #fff; }
  .bar { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 6px); left: calc(env(safe-area-inset-left, 0px) + 62px); right: calc(env(safe-area-inset-right, 0px) + 8px);
    display: flex; gap: 8px; align-items: center; }
  .warn { flex: 1; text-align: right; color: #ffd43b; font-size: 12px; }
  .picked-bar { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 8px); display: flex; gap: 14px; align-items: center;
    padding: 8px 12px; border-radius: 12px; background: #171a24; border: 1px solid #3a3f52; }
  .picked-bar label { display: flex; gap: 8px; align-items: center; font-size: 12px; }
  .picked-bar input { width: 96px; }
  .dim { color: #9a9fb2; font-size: 12px; font-weight: 400; }
  .gold { color: #ffb21e; font-size: 12px; margin: 8px 0 6px; }
  .tray { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 48px); left: calc(env(safe-area-inset-left, 0px) + 24px); right: calc(env(safe-area-inset-right, 0px) + 24px);
    max-height: calc(100% - 64px); overflow: auto; padding: 12px 14px; border-radius: 14px; background: #171a24; border: 1px solid #3a3f52; }
  .tray.small { right: auto; }
  .tray p.dim { margin: 10px 0 6px; }
  .head { display: flex; justify-content: space-between; align-items: center; font-size: 15px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .grid button { text-align: left; border-color: #4f8cff; display: grid; gap: 2px; }
  .grid small { color: #9a9fb2; font-weight: 400; font-size: 11px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
