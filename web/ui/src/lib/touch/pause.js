// The game paused under one of the page's own screens (the touch editor, the first-race tutorial) :
// the pad taps Start itself, as the II button would. The game does not take the pause at every
// moment (the checkered flag still on screen at a race's start, its cooldown after a resume —
// MainFrame.c) : Start is tapped again every half second until the game says no race is driven,
// a few times at most. `release()` resumes a game this paused — also one whose pause lands just
// after the screen closed (a tap already given to the game cannot be taken back), and again when
// the game's own cooldown after a pause swallowed the resume.
import { PSX_BIT as B } from '../guest-input.js'

/**
 * @param {{ racing: boolean, tap(bits: number): void, untap(): boolean }} pad lib/touch/pad.js
 * @param {{ every?: number, tries?: number, timer?: typeof setInterval, clear?: typeof clearInterval }} [opts]
 */
export function pauseGame(pad, { every = 500, tries = 12, timer = setInterval, clear = clearInterval } = {}) {
  const wanted = pad.racing
  let left = tries
  let id = null
  const stop = () => { if (id !== null) { clear(id); id = null } }
  const attempt = () => {
    if (!pad.racing || left-- <= 0) return stop()
    pad.tap(B.start)
  }
  if (wanted) {
    attempt()
    id = timer(attempt, every)
  }
  return {
    release() {
      stop()
      if (!wanted) return
      // a pause asked for and not yet given to the game : dropped
      pad.untap()
      // paused (now, or in a moment) : Start again until the game says a race is driven, three
      // times at most ; a race still driven after four looks was never paused
      // (and once it is driven again after a resume, nothing more : the next pause is the player's)
      let resumes = 3
      let looks = 4
      let resumed = false
      const look = () => {
        if (pad.racing) { if (resumed || --looks <= 0) stop(); return }
        if (resumes-- <= 0) return stop()
        pad.tap(B.start)
        resumed = true
      }
      look()
      id = timer(look, every)
    },
  }
}
