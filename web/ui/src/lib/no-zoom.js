// While the game is played (the game page running, Share's guest connected) a phone does not zoom
// nor select (session 42, the user on his iPhone : « un pb de select qui est enclenché et un zoom ») :
// `touch-action: manipulation` (index.html) stops the double-tap zoom but not a pinch, and a long
// press outside the touch controls started a selection. body.ctr-game (app.css) : no selection, no
// callout, fields excepted ; Safari's own gesture events (a pinch : gesturestart / change) refused.
const stop = (e) => e.preventDefault()

/** On : the page is the game's. Returns nothing ; call again with false to give zoom back. */
export function noZoom(on, doc = globalThis.document) {
  if (!doc) return
  doc.body.classList.toggle('ctr-game', !!on)
  for (const type of ['gesturestart', 'gesturechange']) {
    if (on) doc.addEventListener(type, stop, { passive: false })
    else doc.removeEventListener(type, stop)
  }
}
