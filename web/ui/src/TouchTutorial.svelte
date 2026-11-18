<script>
  // The first-race tutorial (session 42b ; design : plans/…/proofs/42/design/12-first-race-tutorial).
  // The page's own, web only : cards over the page, never in the game's picture. Opened by
  // TouchPad.svelte on the first race played with the touch controls ; the game is paused under it
  // (the page's own Start, as the II button) and resumed when it closes. One card an action, for
  // the pad in use (lib/touch/tutorial.js) : the controls it talks about are lit where they are on
  // the player's screen. Skip (always) and Play (the last card) close it and mark it seen ;
  // « Show the tutorial again » in Settings › Controls › Touch brings it back.
  import { T } from './lib/strings.js'
  import { centre, fromSpec } from './lib/touch/custom.js'
  import { layout } from './lib/touch/layouts.js'
  import { pauseGame } from './lib/touch/pause.js'
  import { cards } from './lib/touch/tutorial.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { pad } = $props()

  const s = live.current
  const view = pad.view ?? { W: window.innerWidth, H: window.innerHeight }
  // the race's controls (the pad itself shows the menus' ones while the game is paused)
  const mode = s.touchMode === 'auto' ? 'enhanced' : s.touchMode
  const controls = mode === 'minimal' ? layout('minimal', view, { size: s.touchSize })
    : s.touchLayout === 'mine' && s.touchCustom ? fromSpec(s.touchCustom, view, s.touchSize)
    : layout(s.touchLayout, view, { size: s.touchSize })
  const list = cards(controls)
  let i = $state(0)
  const card = $derived(list[i])
  const lit = $derived(controls.filter((c) => card?.targets.includes(c.id)))
  // the card on the side its controls are not
  const side = $derived(lit.length && lit.reduce((sum, c) => sum + centre(c)[0], 0) / lit.length > view.W / 2 ? 'left' : 'right')

  $effect(() => {
    const pause = pauseGame(pad)
    return () => pause.release()
  })
  // a pad plugged in : its player does not need these cards (shown again at a later race by touch)
  $effect(() => { if (ui.pads.length) ui.touchTutorial = false })
  // a pad of the player's own with none of the six actions : nothing to say, and it is not asked again
  $effect(() => { if (!list.length) close() })

  function close() {
    settings.patch({ touchTutorial: 'seen' })
    ui.touchTutorial = false
  }
  const next = () => { if (i < list.length - 1) i++; else close() }
  const box = (c) => (c.type === 'button' || c.type === 'dpad'
    ? `left:${c.cx - c.r}px;top:${c.cy - c.r}px;width:${2 * c.r}px;height:${2 * c.r}px`
    : `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`)
</script>

{#if card}
  <div id="ctr-touch-tutorial" class="tutorial" role="dialog" aria-label={T.tutorial.titles[card.id]} data-card={card.id} data-index={i} oncontextmenu={(e) => e.preventDefault()}>
    {#each lit as c (c.id)}
      <div class={`lit ${c.type}`} data-lit={c.id} style={box(c)}><span>{c.type === 'stick' || c.gesture ? '' : (c.label ?? '')}</span></div>
    {/each}
    <button type="button" id="ctr-tutorial-skip" class="skip" onclick={close}>{T.tutorial.skip}</button>
    <div class={`card ${side}`} id="ctr-tutorial-card" role="button" tabindex="-1" onclick={next} onkeydown={(e) => { if (e.key === 'Enter') next() }}>
      <h3>{T.tutorial.titles[card.id]}</h3>
      <p>{card.parts.map((k) => T.tutorial.text[k]).join(' ')}</p>
      <div class="foot">
        <span class="dots" aria-hidden="true">{#each list as _, k}<i class:on={k === i}></i>{/each}</span>
        {#if i > 0}<button type="button" id="ctr-tutorial-back" onclick={(e) => { e.stopPropagation(); i-- }}>{T.tutorial.back}</button>{/if}
        <button type="button" id="ctr-tutorial-next" class="next" onclick={(e) => { e.stopPropagation(); next() }}>{i === list.length - 1 ? T.tutorial.play : T.tutorial.next}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tutorial { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.55); font: 400 14px var(--text); color: #f2f3f7;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
  .lit { position: absolute; box-sizing: border-box; display: grid; place-items: center; pointer-events: none; color: #fff; font: 600 12px var(--text);
    border: 3px solid #f59f00; background: rgba(245, 159, 0, 0.22); box-shadow: 0 0 22px rgba(245, 159, 0, 0.6); }
  .lit.button, .lit.dpad { border-radius: 50%; }
  .lit.rect { border-radius: 10px; }
  .lit.stick { border-radius: 14px; border-style: dashed; }
  button { min-height: 36px; padding: 6px 14px; border-radius: 9px; border: 1px solid #5a6078; background: none; color: #f2f3f7; font: 600 13px var(--text); cursor: pointer; }
  .skip { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 8px); right: calc(env(safe-area-inset-right, 0px) + 8px); border-color: #e03131; color: #ff8787; }
  .card { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 54px); width: min(320px, 44vw); padding: 14px 16px; border-radius: 14px; background: #171a24; border: 1px solid #3a3f52; cursor: pointer; }
  .card.left { left: calc(env(safe-area-inset-left, 0px) + 20px); }
  .card.right { right: calc(env(safe-area-inset-right, 0px) + 20px); }
  h3 { margin: 0 0 6px; color: #ffb21e; font-size: 18px; }
  p { margin: 0 0 12px; line-height: 1.4; }
  .foot { display: flex; align-items: center; gap: 8px; }
  .dots { flex: 1; display: flex; gap: 6px; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 255, 255, 0.25); }
  .dots i.on { background: #fff; }
  .next { background: #fff; color: #111; border-color: #fff; }
</style>
