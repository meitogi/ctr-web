// The boost's feedback, the page's own (session 42b, the user : « des feedback à faire en plus ? ») :
// a short tick when the slide's meter turns red, a rising chime on a boost made — played on the
// game's AudioContext, so through the page's volume and mute (index.html routes every source to
// the speakers through `ctrMute`) ; and a buzz where the browser has one (Android ; iOS has no web
// vibration). Nothing while the context is not running : a cue never wakes the sound by itself.
const tone = (ctx, freq, at, ms, level) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(level, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(at)
  osc.stop(at + ms / 1000)
}

/**
 * @param {{ context?: () => any, vibrate?: ((ms: number) => any) | null }} [opts] the AudioContext
 *   to play on (the game's, once open) ; the buzz (navigator.vibrate, absent on iOS)
 */
export function createCue({ context = () => globalThis.ctrAudio?.context, vibrate = globalThis.navigator?.vibrate?.bind(globalThis.navigator) ?? null } = {}) {
  const running = () => {
    const ctx = context()
    return ctx && ctx.state === 'running' ? ctx : null
  }
  return {
    /** the meter turns red : tap now */
    red() {
      vibrate?.(10)
      const ctx = running()
      if (!ctx) return false
      tone(ctx, 1760, ctx.currentTime, 45, 0.1)
      return true
    },
    /** the slide's n-th boost made (1 to 3) : two notes, higher each time */
    made(n) {
      vibrate?.(25)
      const ctx = running()
      if (!ctx) return false
      const base = 660 * 2 ** ((n - 1) / 6)
      tone(ctx, base, ctx.currentTime, 90, 0.14)
      tone(ctx, base * 1.5, ctx.currentTime + 0.07, 130, 0.14)
      return true
    },
  }
}
