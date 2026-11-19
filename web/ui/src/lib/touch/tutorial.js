// The first-race tutorial's cards (session 42b, the user : « Pour le "mini tutoriel" il faut le
// faire en web only … 1. Le démarrage 2. L'utilisation d'item 3. Le dérapage 4. L'accélération
// 5. Le freinage 6. La vue arrière ») : pure, from the controls of the pad in use — the default
// layout, another one, the minimal pad or the player's own. One card an action ; an action the
// pad has no control for has no card. TouchTutorial.svelte draws them, strings.js says them.
//
// A card : { id, parts: [text keys, said in a row], targets: [the ids of the controls it lights] } ;
// done(id, did) : the player did it (the next card comes by itself).
import { PSX_BIT as B } from '../guest-input.js'

const ids = (list) => list.map((c) => c.id)

/**
 * @param {object[]} controls the race layout's controls (layouts.js, custom.js fromSpec)
 * @param {{ swipe?: boolean }} [opts] `swipe` : the right side's swipe slide and item tap (pad.js
 *   `swipeSlide`)
 */
export function cards(controls, { swipe = false } = {}) {
  const with_ = (fn) => controls.filter(fn)
  const stick = with_((c) => c.type === 'stick')
  const dpad = with_((c) => c.type === 'dpad')
  const arrows = with_((c) => c.type !== 'dpad' && (c.bits & (B.left | B.right)))
  const gesture = with_((c) => c.gesture)
  const go = with_((c) => c.go && !c.gesture)
  const cross = with_((c) => !c.go && (c.bits & B.cross))
  const anchor = with_((c) => c.anchor)
  const glide = with_((c) => c.group && (c.bits & B.r1))
  const r1 = with_((c) => !c.anchor && !c.group && (c.bits & B.r1))
  const boost = with_((c) => c.boost || (!c.group && (c.bits & B.l1)))
  const item = with_((c) => c.bits & B.circle)
  const brakeStick = with_((c) => c.type === 'stick' && c.brake)
  const square = with_((c) => c.bits & B.square)
  const look = with_((c) => c.bits & B.r2)

  const steer = stick.length ? ['steerStick', stick] : dpad.length ? ['steerDpad', dpad] : arrows.length >= 2 ? ['steerArrows', arrows] : null
  const gas = gesture.length ? ['goGesture', 'startGesture', gesture] : go.length ? ['goButton', 'startButton', go] : cross.length ? ['goPad', 'startPad', cross] : null
  const out = []
  // the start first : the cards open during the track's fly-in, before the countdown
  if (gas) out.push({ id: 'start', parts: [gas[1]], targets: ids(gas[2]) })
  if (steer || gas) out.push({ id: 'go', parts: [steer?.[0], gas?.[0], brakeStick.length ? 'goStick' : null].filter(Boolean), targets: ids([...(steer?.[1] ?? []), ...(gas?.[2] ?? [])]) })
  if (gesture.length) out.push({ id: 'slide', parts: [swipe ? 'slideSwipe' : 'slideGesture'], targets: ids(gesture) })
  else if (anchor.length) out.push({ id: 'slide', parts: [boost.length ? 'slideButton' : 'slideButtonAlone'], targets: ids([...anchor, ...boost]) })
  else if (glide.length) out.push({ id: 'slide', parts: ['slideGlide'], targets: ids(with_((c) => c.group)) })
  else if (r1.length) out.push({ id: 'slide', parts: ['slidePad'], targets: ids([...r1, ...boost]) })
  if (gesture.length) out.push({ id: 'items', parts: [swipe ? 'itemTap' : 'itemSwipe'], targets: ids(gesture) })
  else if (item.length) out.push({ id: 'items', parts: [item.some((c) => c.bits & (B.up | B.down)) ? 'itemButtons' : 'itemButton'], targets: ids(item) })
  if (brakeStick.length) out.push({ id: 'brake', parts: ['brakeStick'], targets: ids(brakeStick) })
  else if (square.length) out.push({ id: 'brake', parts: ['brakeButton'], targets: ids(square) })
  if (look.length) out.push({ id: 'look', parts: ['look'], targets: ids(look) })
  return out
}

/** Every text key a card can say (strings.js has each, in every language : tutorial.test.js). */
export const PARTS = ['steerStick', 'goStick', 'steerDpad', 'steerArrows', 'goGesture', 'goButton', 'goPad', 'startGesture', 'startButton', 'startPad', 'slideGesture', 'slideSwipe', 'slideButton', 'slideButtonAlone', 'slideGlide', 'slidePad', 'itemSwipe', 'itemTap', 'itemButtons', 'itemButton', 'brakeStick', 'brakeButton', 'look']
export const CARDS = ['start', 'go', 'slide', 'items', 'brake', 'look']

/**
 * Whether the player has done what card `id` shows, from the touch pad's `did` (pad.js) : the
 * cards go on by themselves while the race runs (the user, 2026-11-19 : « le tuto doit être en
 * même temps et pas mettre en pause »).
 */
export function done(id, did) {
  switch (id) {
    case 'start': return did.start
    case 'go': return did.steer && did.goMs >= 1500
    case 'slide': return did.slide
    case 'items': return did.item
    case 'brake': return did.brake
    case 'look': return did.look
    default: return false
  }
}
