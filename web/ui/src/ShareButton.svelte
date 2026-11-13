<script>
  // « Share », over the game beside the speaker and the gear (Hud.svelte's `extra`) : one press
  // opens the room (web/share/panel.js, globalThis.ctrShareApi), copies the guest link and shows it
  // in a card under the button — selectable, with a Copy button, since a pad press is no gesture
  // for the clipboard. Pressed again : stop. What went wrong (no answer from the relay, a key it
  // asks for) is said in the same card.
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'

  const api = () => globalThis.ctrShareApi
  const s = $derived(ui.share ?? { sharing: false, starting: false, link: '', error: '', guests: 0 })
  let copied = $state(false)
  let field = $state()

  async function press() {
    if (s.sharing) { api()?.stop(); ui.shareCard = false; return }
    if (s.starting) return
    ui.shareCard = true
    copied = false
    const r = await api()?.start()
    copied = !!r?.copied
  }
  async function copy() {
    field?.select()
    copied = !!(await api()?.copy())
  }
</script>

<button type="button" id="ctr-share-btn" class="hbtn share" class:on={s.sharing} aria-pressed={s.sharing} disabled={s.starting}
  title={s.sharing ? T.shareStop : T.share} onclick={press}>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
  <span>{s.sharing ? T.shareStop : T.share}</span>
</button>

{#if ui.shareCard && (s.sharing || s.starting || s.error)}
  <div id="ctr-share-card" class="card" role="dialog" aria-label={T.shareLinkTitle}>
    <button type="button" class="x" aria-label={T.close} title={T.close} onclick={() => { ui.shareCard = false }}>✕</button>
    {#if s.sharing && s.link}
      <b>{T.shareLinkTitle}</b>
      <div class="row">
        <input id="ctr-share-link" type="text" readonly value={s.link} bind:this={field} onfocus={(e) => e.currentTarget.select()} />
        <button type="button" id="ctr-share-copy" class="copy" onclick={copy}>{copied ? T.shareCopiedShort : T.shareCopy}</button>
      </div>
      <small>{T.shareLinkHelp}</small>
      <small id="ctr-share-guests">{T.shareGuests(s.guests)}</small>
    {:else if s.starting}
      <b>{T.shareStarting}</b>
    {/if}
    {#if s.error}<p id="ctr-share-error" class="error">{s.error}</p>{/if}
  </div>
{/if}

<style>
  .hbtn { height: 44px; display: grid; place-items: center; cursor: pointer; color: #fff; background: rgba(20, 22, 30, 0.6); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(12px); }
  .hbtn:hover { background: rgba(40, 44, 58, 0.8); }
  .share { width: auto; padding: 0 14px 0 12px; border-radius: 22px; display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; }
  .share.on { background: rgba(79, 140, 255, 0.55); }
  .share:disabled { opacity: 0.6; cursor: progress; }
  .card { position: absolute; top: 54px; right: 0; width: min(420px, calc(100vw - 28px)); box-sizing: border-box; display: grid; gap: 8px;
    padding: 14px 16px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
  .card b { font-size: 15px; }
  .card small { color: var(--ink-dim); font-size: 12px; }
  .row { display: flex; gap: 8px; }
  .row input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line-strong); background: rgba(0, 0, 0, 0.3); color: var(--ink); font: 12px ui-monospace, monospace; }
  .copy { padding: 8px 14px; border: 0; border-radius: 10px; background: #fff; color: #111; font-weight: 700; cursor: pointer; }
  .x { position: absolute; top: 6px; right: 8px; border: 0; background: none; color: var(--ink-dim); cursor: pointer; font-size: 14px; }
  .error { margin: 0; color: #ff8a8a; white-space: pre-wrap; font-size: 13px; }
</style>
