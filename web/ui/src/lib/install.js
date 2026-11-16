// A phone's Home Screen (session 41) : what the page knows about being installed, what it keeps,
// and the screen kept awake. Sets ui.install = { ios, touch, standalone, canPrompt, persisted, kept } :
//   ios, touch     an iPhone / iPad's Safari (no install prompt there : Share › Add to Home Screen) ;
//                  a touch screen (the install hint is for phones and tablets only)
//   standalone     opened from the Home Screen (the manifest's display, or iOS's navigator.standalone)
//   canPrompt      Chromium's beforeinstallprompt came : promptInstall() shows its dialog
//   persisted      navigator.storage.persisted() : the browser promised not to evict this site's storage
//   kept           what the ready screen says about the stored disc : 'device' (persisted, or an
//                  installed iOS app — Apple exempts Home Screen apps from its 7-day eviction),
//                  'may-go' (iOS Safari in a tab : storage deleted after 7 days unused), null (say as before)
// The wake lock is held while the game runs and the page is visible (taken again on the way back :
// the browser drops it when the page hides).

let deferred = null

export function installSupport(ui, { g = globalThis } = {}) {
  const nav = g.navigator
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const standalone = () => g.matchMedia?.('(display-mode: standalone)').matches || g.matchMedia?.('(display-mode: fullscreen)').matches || nav.standalone === true
  const state = { ios, touch: !!g.matchMedia?.('(pointer: coarse)').matches, standalone: standalone(), canPrompt: false, persisted: null, kept: null }
  const publish = () => {
    state.kept = state.persisted || (ios && state.standalone) ? 'device' : ios ? 'may-go' : null
    ui.install = { ...state }
  }
  publish()

  g.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    state.canPrompt = true
    publish()
  })
  g.addEventListener('appinstalled', () => {
    deferred = null
    state.canPrompt = false
    publish()
  })

  const persisted = () => nav.storage?.persisted?.().then((p) => { state.persisted = p; publish() }, () => {})
  persisted()

  // the wake lock : held while the game runs, taken again when the page comes back
  let lock = null
  const want = () => ui.phase === 'running' && g.document.visibilityState === 'visible'
  const hold = async () => {
    if (!nav.wakeLock || lock || !want()) return
    try {
      lock = await nav.wakeLock.request('screen')
      lock.addEventListener('release', () => { lock = null })
    } catch { /* refused (battery saver, no gesture yet) : the next check tries again */ }
  }
  g.document.addEventListener('visibilitychange', hold)
  g.setInterval(hold, 2000)

  return {
    /** Asks the browser to keep this site's storage (no dialog : a heuristic grant) ; once a disc is stored. */
    async keep() {
      try { await nav.storage?.persist?.() } catch { /* not offered */ }
      await persisted()
    },
    /** Chromium's install dialog ; true when the player accepted. */
    async promptInstall() {
      if (!deferred) return false
      const e = deferred
      deferred = null
      state.canPrompt = false
      publish()
      await e.prompt()
      const { outcome } = await e.userChoice
      return outcome === 'accepted'
    },
  }
}
