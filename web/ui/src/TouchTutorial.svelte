<script>
  // The first-race tutorial (session 42b ; design : plans/…/proofs/42/design/12-first-race-tutorial).
  // The page's own, web only : a card over the page, never in the game's picture. Opened by
  // TouchPad.svelte on the first race played with the touch controls. The race runs under it (the
  // user, 2026-11-19 : « le tuto doit être en même temps et pas mettre en pause … détecter
  // automatiquement si les trucs sont faits pour passer au suivant ») : the touch controls stay live,
  // the card sits at the top, out of the thumbs' way, and lets every touch through but its own. One
  // card an action, for the pad in use (lib/touch/tutorial.js) : the controls it talks about are
  // ringed where they are ; done (the touch pad's `did`), it shows a tick and the next one comes. The
  // card itself takes no touch (it sits over the stick's zone, top left, the right thumb's half kept
  // clear) : its › skips that card ; Skip closes them all ; both mark it seen once the last is gone.
  // « Show the tutorial again » in Settings › Controls › Touch brings it back.
  import { T } from './lib/strings.js'
  import { fromSpec } from './lib/touch/custom.js'
  import { layout } from './lib/touch/layouts.js'
  import { cards, done } from './lib/touch/tutorial.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { pad } = $props()

  const s = live.current
  const view = pad.view ?? { W: window.innerWidth, H: window.innerHeight }
  // the race's controls (the pad may still show the menus' ones while the track flies in)
  const mode = s.touchMode === 'auto' ? 'enhanced' : s.touchMode
  const controls = mode === 'minimal' ? layout('minimal', view, { size: s.touchSize })
    : s.touchLayout === 'mine' && s.touchCustom ? fromSpec(s.touchCustom, view, s.touchSize)
    : layout(s.touchLayout, view, { size: s.touchSize })
  const list = cards(controls)
  let i = $state(0)
  let ticked = $state(false)
  const card = $derived(list[i])
  const lit = $derived(controls.filter((c) => card?.targets.includes(c.id)))

  // what the player does, from now on
  pad.resetDid()
  $effect(() => {
    let tickAt = 0
    const timer = setInterval(() => {
      const c = list[i]
      if (!c) return
      if (!ticked && done(c.id, pad.did)) {
        ticked = true
        tickAt = Date.now()
      } else if (ticked && Date.now() - tickAt >= 900) next()
    }, 100)
    return () => clearInterval(timer)
  })
  // a pad plugged in : its player does not need these cards (shown again at a later race by touch)
  $effect(() => { if (ui.pads.length) ui.touchTutorial = false })
  // a pad of the player's own with none of the six actions : nothing to say, and it is not asked again
  $effect(() => { if (!list.length) close() })

  function close() {
    settings.patch({ touchTutorial: 'seen' })
    ui.touchTutorial = false
  }
  function next() {
    ticked = false
    if (i < list.length - 1) i++
    else close()
  }
  const box = (c) => (c.type === 'button' || c.type === 'dpad'
    ? `left:${c.cx - c.r}px;top:${c.cy - c.r}px;width:${2 * c.r}px;height:${2 * c.r}px`
    : `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`)
</script>

{#if card}
  <div id="ctr-touch-tutorial" class="tutorial" data-card={card.id} data-index={i} data-done={ticked ? '1' : null}>
    {#each lit as c (c.id)}
      <div class={`lit ${c.type}`} data-lit={c.id} style={box(c)}></div>
    {/each}
    <button type="button" id="ctr-tutorial-skip" class="skip" onclick={close}>{T.tutorial.skip}</button>
    <div class="card" class:done={ticked} id="ctr-tutorial-card" aria-live="polite">
      <h3><span class="tick" aria-hidden="true">✓</span><span class="name">{T.tutorial.titles[card.id]}</span><span class="count">{i + 1}/{list.length}</span>
        <button type="button" id="ctr-tutorial-next" class="next" aria-label={T.tutorial.next} onclick={next} oncontextmenu={(e) => e.preventDefault()}>›</button></h3>
      <p>{card.parts.map((k) => T.tutorial.text[k]).join(' ')}</p>
      {#if i === 0}<p class="hint">{T.tutorial.hint}</p>{/if}
    </div>
  </div>
{/if}

<style>
  /* over the race, never in the way : only › and Skip take a touch */
  .tutorial { position: fixed; inset: 0; z-index: 40; pointer-events: none; font: 400 15px var(--text); color: #f2f3f7;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .lit { position: absolute; box-sizing: border-box; border: 3px solid #f59f00; box-shadow: 0 0 18px rgba(245, 159, 0, 0.55);
    animation: pulse 1.4s ease-in-out infinite; }
  .lit.button, .lit.dpad { border-radius: 50%; }
  .lit.rect { border-radius: 10px; }
  .lit.stick { border-radius: 14px; border-style: dashed; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  .skip { pointer-events: auto; position: absolute; top: calc(env(safe-area-inset-top, 0px) + 8px); right: calc(env(safe-area-inset-right, 0px) + 8px);
    min-height: 34px; padding: 5px 14px; border-radius: 9px; border: 1px solid #e03131; background: rgba(23, 26, 36, 0.92); color: #ff8787; font: 600 13px var(--text); cursor: pointer; }
  .card { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 48px); left: calc(env(safe-area-inset-left, 0px) + 12px); width: min(340px, 42vw);
    box-sizing: border-box; padding: 8px 12px 10px 14px; border-radius: 12px; background: rgba(23, 26, 36, 0.92); border: 1px solid #3a3f52; transition: border-color 0.2s; }
  .card.done { border-color: #40c057; }
  h3 { display: flex; align-items: baseline; gap: 6px; margin: 0 0 4px; color: #ffb21e; font-size: 16px; }
  .tick { display: none; color: #40c057; }
  .done .tick { display: inline; }
  .count { margin-left: auto; color: #8a90a6; font-size: 12px; font-weight: 400; }
  .next { pointer-events: auto; align-self: center; min-width: 36px; min-height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid #5a6078;
    background: none; color: #f2f3f7; font: 600 18px/1 var(--text); cursor: pointer; }
  p { margin: 0; line-height: 1.35; }
  .hint { margin-top: 6px; color: #a5abc0; font-size: 12px; }
</style>
