<script>
  // Settings › Controls › Touch (session 42) : the way to play on a touch screen (a pad / the minimal
  // on-screen pad / the enhanced one), the enhanced one's layout, the held accelerator and its delay,
  // the controls' size. Kept by the browser (lib/settings.js) ; TouchPad.svelte follows at once.
  import { TOUCH_HOLD_MS, TOUCH_LAYOUTS, TOUCH_ROCK_PX, TOUCH_SIZES, TOUCH_RETAP_MS, TOUCH_SLIDE_HOLD_MS, TOUCH_SLIDE_MS, TOUCH_STEER, touchTraits } from './lib/settings.js'
  import { ui } from './state.svelte.js'
  import { T } from './lib/strings.js'
  import { live, settings } from './store.js'

  const s = $derived(live.current)
  const way = $derived(s.touchMode === 'auto' ? 'enhanced' : s.touchMode)
  const DELAYS = [500, TOUCH_HOLD_MS.default, 1200]
  // what the layout in use has : the settings that only make sense with it
  const has = $derived(touchTraits(s))
  // « mine » is offered once it exists
  const layouts = $derived(TOUCH_LAYOUTS.filter((l) => l !== 'mine' || s.touchCustom))
  // the editor works over the game : Settings closes
  const edit = () => { ui.settingsOpen = false; ui.touchEditor = true }
</script>

<div class="touch-settings">
  <div class="label">{T.touchWay}</div>
  <div class="seg" role="radiogroup" aria-label={T.touchWay}>
    {#each ['pad', 'minimal', 'enhanced'] as m}
      <button type="button" role="radio" data-touch-mode={m} aria-checked={way === m} class:on={way === m} onclick={() => settings.patch({ touchMode: m })}>{T.touchWays[m]}</button>
    {/each}
  </div>
  <p class="help">{T.touchWayHelp[way]}{#if s.touchMode === 'auto'} {T.touchAuto}{/if}</p>

  {#if way === 'enhanced'}
    <div class="label">{T.touchLayout}</div>
    <div class="seg" role="radiogroup" aria-label={T.touchLayout}>
      {#each layouts as l}
        <button type="button" role="radio" data-touch-layout={l} aria-checked={s.touchLayout === l} class:on={s.touchLayout === l} onclick={() => settings.patch({ touchLayout: l })}>{T.touchLayouts[l]}</button>
      {/each}
    </div>
    <p class="help">{T.touchLayoutHelp[s.touchLayout]}</p>
    <div class="row">
      <button type="button" id="ctr-touch-edit" class="act" onclick={edit}>{T.touchEdit}</button>
      {#if s.touchCustom}<button type="button" id="ctr-touch-edit-clear" class="act back" onclick={() => settings.patch({ touchCustom: null })}>{T.touchEditClear}</button>{/if}
    </div>
    <p class="help">{T.touchEditHelp}</p>

    <label class="setrow">
      <span>{T.touchHold}<small>{T.touchHoldHelp((s.touchHoldMs / 1000).toFixed(1))}</small></span>
      <input id="ctr-touch-hold" type="checkbox" role="switch" class="switch" checked={s.touchHold} onchange={(e) => settings.patch({ touchHold: e.currentTarget.checked })} />
    </label>
    {#if s.touchHold}
      <div class="row">
        <span class="dim">{T.touchHoldAfter}</span>
        <div class="seg small" role="radiogroup" aria-label={T.touchHoldAfter}>
          {#each DELAYS as ms}
            <button type="button" role="radio" data-hold-ms={ms} aria-checked={s.touchHoldMs === ms} class:on={s.touchHoldMs === ms} onclick={() => settings.patch({ touchHoldMs: ms })}>{(ms / 1000).toFixed(1)} s</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if has.stick}
      <div class="label">{T.touchSteer}</div>
      <div class="seg" role="radiogroup" aria-label={T.touchSteer}>
        {#each Object.keys(TOUCH_STEER) as k}
          <button type="button" role="radio" data-steer={k} aria-checked={s.touchSteer === k} class:on={s.touchSteer === k} onclick={() => settings.patch({ touchSteer: k })}>{T.touchSteers[k]}</button>
        {/each}
      </div>
    {/if}

    {#if has.gesture}
      <label class="setrow">
        <span>{T.touchAutoBoost}<small>{T.touchAutoBoostHelp}</small></span>
        <input id="ctr-touch-auto-boost" type="checkbox" role="switch" class="switch" checked={s.touchAutoBoost} onchange={(e) => settings.patch({ touchAutoBoost: e.currentTarget.checked })} />
      </label>
    {/if}

    {#if has.retap}
      <div class="label">{T.touchRetap}</div>
      <div class="seg" role="radiogroup" aria-label={T.touchRetap}>
        {#each TOUCH_RETAP_MS as ms}
          <button type="button" role="radio" data-retap-ms={ms} aria-checked={s.touchRetapMs === ms} class:on={s.touchRetapMs === ms} onclick={() => settings.patch({ touchRetapMs: ms })}>{ms ? `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s` : T.off}</button>
        {/each}
      </div>
      <p class="help">{T.touchRetapHelp}</p>
    {/if}

    <label class="setrow">
      <span>{T.touchCue}<small>{T.touchCueHelp}</small></span>
      <input id="ctr-touch-cue" type="checkbox" role="switch" class="switch" checked={s.touchCue} onchange={(e) => settings.patch({ touchCue: e.currentTarget.checked })} />
    </label>
    <label class="setrow">
      <span>{T.touchSound}<small>{T.touchSoundHelp}</small></span>
      <input id="ctr-touch-sound" type="checkbox" role="switch" class="switch" checked={s.touchSound} onchange={(e) => settings.patch({ touchSound: e.currentTarget.checked })} />
    </label>
    <label class="setrow">
      <span>{T.touchBuffer}<small>{T.touchBufferHelp}</small></span>
      <input id="ctr-touch-buffer" type="checkbox" role="switch" class="switch" checked={s.touchBuffer} onchange={(e) => settings.patch({ touchBuffer: e.currentTarget.checked })} />
    </label>

    {#if has.slideHold}
      <div class="label">{T.touchSlideHold}</div>
      <div class="seg" role="radiogroup" aria-label={T.touchSlideHold}>
        {#each TOUCH_SLIDE_HOLD_MS as ms}
          <button type="button" role="radio" data-slide-hold-ms={ms} aria-checked={s.touchSlideHoldMs === ms} class:on={s.touchSlideHoldMs === ms} onclick={() => settings.patch({ touchSlideHoldMs: ms })}>{ms ? `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s` : T.off}</button>
        {/each}
      </div>
      <p class="help">{T.touchSlideHoldHelp}</p>
    {/if}

    {#if has.slide}
    <div class="label">{T.touchSlide}</div>
    <div class="seg" role="radiogroup" aria-label={T.touchSlide}>
      {#each TOUCH_SLIDE_MS as ms}
        <button type="button" role="radio" data-slide-ms={ms} aria-checked={s.touchSlideMs === ms} class:on={s.touchSlideMs === ms} onclick={() => settings.patch({ touchSlideMs: ms })}>{ms ? `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s` : T.off}</button>
      {/each}
    </div>
    <p class="help">{T.touchSlideHelp}</p>

    {/if}

    {#if has.rock}
      <div class="label">{T.touchRock}</div>
      <div class="seg" role="radiogroup" aria-label={T.touchRock}>
        {#each TOUCH_ROCK_PX as px}
          <button type="button" role="radio" data-rock-px={px} aria-checked={s.touchRockPx === px} class:on={s.touchRockPx === px} onclick={() => settings.patch({ touchRockPx: px })}>{px ? T.touchRockLevels[px] : T.off}</button>
        {/each}
      </div>
      <p class="help">{T.touchRockHelp}</p>
    {/if}
  {/if}

  {#if way !== 'pad'}
    <div class="row">
      <span class="dim">{T.touchSize}</span>
      <div class="seg small" role="radiogroup" aria-label={T.touchSize}>
        {#each TOUCH_SIZES as z}
          <button type="button" role="radio" data-touch-size={z} aria-checked={s.touchSize === z} class:on={s.touchSize === z} onclick={() => settings.patch({ touchSize: z })}>{T.touchSizes[z]}</button>
        {/each}
      </div>
    </div>
  {/if}
  <p class="help">{T.touchPadHides}</p>
</div>

<style>
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 16px 2px 8px; }
  .seg { display: flex; padding: 4px; border-radius: 12px; gap: 4px; background: rgba(255, 255, 255, 0.06); }
  .seg button { flex: 1; min-height: 40px; padding: 8px 10px; border: 0; border-radius: 9px; background: none; font-weight: 600; font-size: 13px; cursor: pointer; color: var(--ink-dim); }
  .seg button.on { background: #fff; color: #111; }
  .seg.small { flex: 1; }
  .help { font-size: 12.5px; color: var(--ink-dim); margin: 8px 2px 0; }
  .row { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  .dim { color: var(--ink-dim); font-size: 13px; min-width: 52px; }
  .act { min-height: 40px; padding: 8px 16px; border-radius: 10px; border: 0; background: #fff; color: #111; font-weight: 600; font-size: 13px; cursor: pointer; }
  .act.back { background: none; border: 1px solid #e03131; color: #ff8787; }
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); margin-top: 14px; cursor: pointer; }
  .setrow small { display: block; color: var(--ink-dim); font-size: 12.5px; margin-top: 2px; }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; transition: background 150ms; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
</style>
