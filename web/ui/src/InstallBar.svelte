<script>
  // The install bar (session 41), at the bottom of the boot screen on a phone or a tablet not opened
  // from its Home Screen, inside the home bar's safe area. Its words follow the platform (lib/install.js) :
  //   iOS (any browser : no prompt there)   the Share glyph, then « Add to Home Screen »
  //   Chromium's prompt came                 « Install » runs the browser's own dialog
  //   Android without a prompt               the browser's ⋮ menu, then « Add to Home screen »
  // × hides it for 14 days (localStorage ctr-ui.install-later).
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'

  // shown : bound by Boot.svelte, which then keeps room below its content so the bar hides nothing
  let { promptInstall, shown = $bindable(false) } = $props()
  const KEY = 'ctr-ui.install-later'
  const DAYS = 14
  const later = () => { try { return Number(localStorage.getItem(KEY)) > Date.now() } catch { return false } }
  let hidden = $state(later())
  const close = () => {
    hidden = true
    try { localStorage.setItem(KEY, String(Date.now() + DAYS * 86_400_000)) } catch { /* private mode : this visit only */ }
  }
  const i = $derived(ui.install)
  const show = $derived(!hidden && !!i?.touch && !i.standalone && (i.ios || i.canPrompt || i.android))
  $effect(() => { shown = show })
</script>

{#if show}
  <div id="install-bar" class="bar" role="note">
    <img class="app" src="icons/icon-192.png" alt="" />
    <p class="txt">
      <b>{T.installTitle}</b>
      {#if i.ios}
        <span>{T.installIosA}<svg class="glyph" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>{T.installIosB}</span>
      {:else if i.canPrompt}
        <span>{T.installWhy}</span>
      {:else}
        <span>{T.installAndroidA}<svg class="glyph" viewBox="0 0 24 24" aria-label="Menu"><circle cx="12" cy="5" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="19" r="2" fill="currentColor" /></svg>{T.installAndroidB}</span>
      {/if}
    </p>
    {#if !i.ios && i.canPrompt}
      <button id="install-app" type="button" class="primary" onclick={promptInstall}>{T.installApp}</button>
    {/if}
    <button id="install-later" type="button" class="x" aria-label={T.installLater} onclick={close}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
    </button>
  </div>
{/if}

<style>
  .bar {
    position: fixed; z-index: 15; left: 50%; transform: translateX(-50%);
    /* above the build's version (Boot.svelte, bottom right) */
    bottom: calc(40px + env(safe-area-inset-bottom));
    width: min(560px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
    box-sizing: border-box; display: flex; align-items: center; gap: 12px; padding: 10px 8px 10px 12px;
    background: var(--panel); border: 1px solid var(--line-strong); border-radius: 16px;
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    animation: up 260ms ease-out;
  }
  @keyframes up { from { transform: translate(-50%, 16px); opacity: 0; } }
  .app { width: 40px; height: 40px; flex: none; border-radius: 9px; }
  .txt { margin: 0; flex: 1; min-width: 0; font-size: 13px; line-height: 1.35; color: var(--ink-dim); }
  .txt b { display: block; color: var(--ink); font-size: 14px; }
  .glyph { width: 17px; height: 17px; vertical-align: -3px; margin: 0 3px; color: var(--accent-2); }
  .primary { flex: none; padding: 9px 16px; border: 0; border-radius: 10px; background: #fff; color: #111; font: 700 14px var(--text); cursor: pointer; }
  .x { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 10px; background: none; color: var(--ink-dim); cursor: pointer; }
</style>
