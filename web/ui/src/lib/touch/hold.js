// The held accelerator (the user, 2026-11-12 : « un auto-acceleration dès qu'on est resté appuyé
// assez longtemps … désactivable ») : the touch pad's GO is a plain Cross at first — the countdown's
// start boost is the player's own press — and locks once held `delay` ms in a race ; the finger can
// then leave it. Input only : the game sees a pad whose Cross stays down. Pure, time given.
//
//   idle ──press──▶ pressing ──held delay ms, racing──▶ held ──lift──▶ held (locked)
//     ▲                │ lift                            │ press
//     └────────────────┘                                 ▼
//                                                     retouched ──lift < delay──▶ idle (a tap)
//                                                                └─lift later───▶ held
//   brake, not racing (menu, pause, end of race), off → idle (Cross let go until pressed again)

export const HOLD_DELAY = 800
export const HOLD_RANGE = [400, 1500]

export function createHold({ delay = HOLD_DELAY, enabled = true } = {}) {
  let state = 'idle'
  let since = 0
  let was = false // GO pressed at the last update
  const self = {
    get state() { return state },
    /** 0..1 while the press is filling the ring, 1 once locked, 0 otherwise */
    progress(now) {
      if (state === 'held' || state === 'retouched') return 1
      return state === 'pressing' ? Math.min(1, (now - since) / delay) : 0
    },
    configure(o) {
      if (o.delay !== undefined) delay = o.delay
      if (o.enabled !== undefined) enabled = o.enabled
      if (!enabled) state = 'idle'
    },
    /**
     * One update : `go` the GO control pressed now, `brake` the brake pressed, `racing` a race is
     * driven. Returns whether Cross is down.
     */
    update(now, { go, brake = false, racing = true }) {
      const down = go && !was
      const up = !go && was
      was = go
      if (!enabled) {
        state = 'idle'
        return go
      }
      if (brake || !racing) {
        // the brake lets go of everything (a finger left on GO presses again once the brake is
        // released) ; outside a race GO is a plain button that never locks
        state = 'idle'
        return racing ? false : go
      }
      if (state === 'idle' && go) {
        state = 'pressing'
        since = now
      } else if (state === 'pressing') {
        if (up) state = 'idle'
        else if (now - since >= delay) state = 'held'
      } else if (state === 'held' && down) {
        state = 'retouched'
        since = now
      } else if (state === 'retouched' && up) {
        state = now - since < delay ? 'idle' : 'held'
      }
      return state !== 'idle'
    },
    reset() { state = 'idle'; was = false },
  }
  return self
}
