// Player suite : playing on a phone by touch (session 42) — the page at an iPhone mini's shape
// (812 × 375, touch emulated over CDP), fingers sent with Input.dispatchTouchEvent (several at once).
//   TOUCH-SHOWN        on a touch screen the touch controls are drawn : the menus' reduced pad
//                      (D-pad, OK, BACK, pause) on the main menu, the race's layout in a race ; none
//                      on a desktop
//   TOUCH-FINGERS      steer + GO + R + item in the same frame : the game's pad has them all
//                      (__ctr.kart.cross, the stick seen turning the kart)
//   TOUCH-LAP-ENHANCED a Time Trial lap driven by touch alone, layout A : the page's Bot decides,
//                      its keys become fingers on the stick's zone, GO, BRAKE, ITEM
//   TOUCH-LAP-MINIMAL  the same on the minimal pad : the D-pad, Cross, Square, Circle
//   TOUCH-START-BOOST  the start boost by hand : GO pressed during the countdown gives the boost
//                      (__ctr.kart.reserves after GO), the hold not locked before GO
//   TOUCH-HOLD         GO held 0.8 s locks : the finger lifted, Cross stays (__ctr.kart.cross) ;
//                      the brake lets go ; a tap on GO lets go ; the pause lets go ; off in Settings
//                      GO is a plain button
//   TOUCH-MENUS-BACK   the menus by touch : the D-pad moves the main menu, OK opens Time Trial's
//                      screens, BACK (Triangle) comes back, every time
//   TOUCH-PAD-HIDES    a pad connecting hides the controls ; a touch brings them back
//   TOUCH-BOOT-INTRO   a real boot (started by itself) : through the Naughty Dog crate and the title
//                      intro's scenes to the main menu, the menus' pad only — never the race's
//                      (the user saw it come up during the intro, b.25)
//   TOUCH-STICK-SLIDE  layout A : turning, the left thumb lifted and put down again at once starts a
//                      slide the game reports (KS_DRIFTING, read through the touch pull), the stick
//                      on the same side ; lifting it ends the slide
//   TOUCH-E            layout E : the right half held = GO, held by itself ; a tap there turning =
//                      hop + slide the game reports, kept by the page with no finger on it, the
//                      auto boost giving reserves ; the steering thumb lifted ends it
//   TOUCH-E-STICK-UP   layout E : the stick pushed up = GO from the start, locks like GO
//   TOUCH-HOLD-HIT     layout E : the hold locked, P1 blasted then spun (ctrDev.hit) : still locked
//   TOUCH-PORTRAIT     a phone held upright : the game at the top, E / A / minimal in the band under
//                      it, smaller, none over the game ; GO drives ; back to landscape as before
//   TOUCH-E-SWIPE      E's swipe slide : a swipe right slides right (stick untouched) ; a tap with
//                      an item (ctrDev.item) uses it, no hop ; held still : the hop
//   TOUCH-E-COUNTERSTEER layout E : a slide, the stick held into the turn → away : tighter → wider, never ended
//   TOUCH-SLIDE-HOLD   layout D : a slide (R with the stick turned, at speed) held 0.5 s holds
//                      itself — the game's « sliding » reaches the page —, R lights up at the boost's
//                      moment (the game's red meter), stays held with the thumb
//                      lifted, a double tap on R lets it go
//
// RUN : the player harness (CLAUDE.md § Tests) on touch.suite.mjs, --url http://localhost:8093/index.html
// Not a node --test file.

import { drive } from '../../ui/src/lib/autopilot.js'
import { IPHONE_MINI, PLAYER, onMainMenu, fingers, open, phone, say, shot, startAt, state, touchState, turbo, until } from './ctr.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: PLAYER }

export const tags = {
	'TOUCH-SHOWN': ['input', 'page'],
	'TOUCH-FINGERS': ['input', 'race'],
	'TOUCH-LAP-ENHANCED': ['input', 'race'],
	'TOUCH-LAP-MINIMAL': ['input', 'race'],
	'TOUCH-START-BOOST': ['input', 'race'],
	'TOUCH-HOLD': ['input', 'race'],
	'TOUCH-MENUS-BACK': ['input', 'menu'],
	'TOUCH-PAD-HIDES': ['input', 'page'],
	'TOUCH-SLIDE-HOLD': ['input', 'race'],
	'TOUCH-BOOT-INTRO': ['input', 'boot'],
	'TOUCH-STICK-SLIDE': ['input', 'race'],
	'TOUCH-E': ['input', 'race'],
	'TOUCH-E-ACTIONS': ['input', 'race'],
	'TOUCH-E-BOOSTS': ['input', 'race'],
	'TOUCH-E-STICK-UP': ['input', 'race'],
	'TOUCH-HOLD-HIT': ['input', 'race'],
	'TOUCH-PORTRAIT': ['input', 'page'],
	'TOUCH-E-SWIPE': ['input', 'race'],
	'TOUCH-E-COUNTERSTEER': ['input', 'race'],
	'TOUCH-EDITOR': ['input', 'page'],
	'TOUCH-TUTORIAL': ['input', 'page'],
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const TT = { race: 'crash-cove', char: 'crash', mode: 'tt' }

/** The touch settings (lib/settings.js keys) set before the page loads ; null removes one. */
async function touchSettings(ctx, s) {
	const keys = { touchMode: 'ctr-ui.touch-mode', touchLayout: 'ctr-ui.touch-layout', touchHold: 'ctr-ui.touch-hold', touchHoldMs: 'ctr-ui.touch-hold-ms', touchRetapMs: 'ctr-ui.touch-retap-ms', touchTutorial: 'ctr-ui.touch-tutorial', touchSwipeSlide: 'ctr-ui.touch-swipe-slide' }
	const set = {}
	for (const k in keys) set[keys[k]] = k in s ? s[k] : null
	await ctx.js(`const s = ${JSON.stringify(set)}; for (const k in s) { if (s[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, String(s[k])) } return true`)
}

/** The page on the phone, at `at` (startAt's), with these touch settings ; waits for the controls. */
async function onPhone(ctx, at, s = {}, { kind = null, turbo: fast = false, portrait = false } = {}) {
	await phone(ctx, { ...IPHONE_MINI, portrait })
	// no finger left down from a scenario before (the browser keeps its touch points across loads)
	await ctx.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, ctx.sid).catch(() => {})
	// the scenarios written on layout A say nothing : A unless told (the default is E since 42b)
	await touchSettings(ctx, { touchLayout: 'a', ...s })
	await startAt(ctx, at, { turbo: fast })
	const end = Date.now() + 10_000
	let t = null
	while (Date.now() < end && !((t = await touchState(ctx)) && (!kind || t.kind === kind))) await sleep(150)
	if (!t || (kind && t.kind !== kind)) throw new Error(`the touch controls : ${JSON.stringify(t)} (wanted ${kind ?? 'any'})`)
	return t
}

const kart = async ctx => (await state(ctx))?.kart ?? null

/**
 * What the game pulls from the touch pad from now on : `pulls(ctx)` returns and empties the list,
 * one [buttons pressed (active high), sliding, red, boosts made, the stick's y byte] per pull.
 */
const spy = ctx => ctx.js("const t = Module.ctrInput.touch; window.__pulls = []; Module.ctrInput.touch = (h, d, ...a) => { const ok = t(h, d, ...a); if (ok) { __pulls.push([~(h[d + 2] | (h[d + 3] << 8)) & 0xffff, a[1] ? 1 : 0, a[2] ? 1 : 0, a[4] | 0, h[d + 7]]); if (__pulls.length > 6000) __pulls.shift() } return ok }; return true")
const pulls = ctx => ctx.js('const p = window.__pulls; window.__pulls = []; return p')
/** E in a Time Trial, GO held by itself, the kart at speed. */
async function eDriving(ctx, s = {}, at = TT, fast = 9000) {
	await onPhone(ctx, at, { touchLayout: 'e', ...s }, { kind: 'e' })
	await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
	const f = fingers(ctx)
	const right = await f.rect('right')
	// the thumb down until the kart is at speed (whatever the track's countdown), then lifted
	await f.down(2, right.cx, right.cy)
	let speed = 0
	for (const end = Date.now() + 20_000; Date.now() < end && speed < fast; await sleep(50)) speed = (await kart(ctx))?.speed ?? 0
	await f.up(2)
	await sleep(300)
	const held = await touchState(ctx)
	if (held.hold !== 'held' || speed < fast) throw new Error(`the right half held : ${held.hold}, speed ${speed}`)
	return { f, right, zone: await f.rect('steer') }
}

/**
 * The Bot's keys as fingers (lib/autopilot.js's `out`) : steering on the stick's zone (layout A)
 * or the D-pad (minimal), Cross / Square / Circle on their controls.
 */
function touchHands(ctx, f, kind) {
	const held = {}
	const CONTROL = kind === 'minimal'
		? { c: 'cross', x: 'square', v: 'circle' }
		: { c: 'go', x: 'brake', v: 'item' }
	const FINGER = { c: 2, x: 3, v: 4 }
	let stickAt = null
	const dirs = () => {
		let dx = 0
		let dy = 0
		if (held.ArrowLeft) dx -= 1
		if (held.ArrowRight) dx += 1
		if (held.ArrowDown) dy += 1
		if (held.ArrowUp) dy -= 1
		return [dx, dy]
	}
	const steer = async () => {
		const [dx, dy] = dirs()
		if (!dx && !dy) { stickAt = null; return f.off(1) }
		if (kind === 'minimal') {
			const r = await f.rect('dpad')
			return f.points[1] ? f.move(1, r.cx + dx * r.w * 0.35, r.cy + dy * r.h * 0.35) : f.down(1, r.cx + dx * r.w * 0.35, r.cy + dy * r.h * 0.35)
		}
		// the stick : a thumb landed in the zone, then pushed to the full reach
		if (!stickAt) {
			const z = await f.rect('steer')
			stickAt = { x: z.x + 70, y: z.y + z.h - 90 }
			await f.down(1, stickAt.x, stickAt.y)
		}
		return f.move(1, stickAt.x + dx * 60, stickAt.y + dy * 60)
	}
	return {
		async hold(name) {
			held[name] = true
			if (CONTROL[name]) return f.on(FINGER[name], CONTROL[name])
			return steer()
		},
		async release(name) {
			held[name] = false
			if (CONTROL[name]) return f.off(FINGER[name])
			return steer()
		},
		async press(name) {
			await this.hold(name)
			await sleep(150)
			await this.release(name)
		},
	}
}

/** A lap of Time Trial by touch alone (the Bot's decisions as fingers) ; returns the lap's figures. */
async function touchLap(ctx, kind) {
	const f = fingers(ctx)
	await turbo(ctx, true)
	const start = Date.now()
	let top = 0
	const deadline = Date.now() + 240_000
	const hands = touchHands(ctx, f, kind)
	const watch = (async () => {
		for (;;) {
			const k = await kart(ctx)
			if (k) top = Math.max(top, k.speed)
			if (!k || k.lap >= 1 || Date.now() > deadline) return k
			await sleep(400)
		}
	})()
	// the Bot's clock jumps past its deadline once the lap is done : it stops deciding
	let stopped = false
	const driving = drive({
		out: hands,
		read: () => ctx.js('const c = window.__ctr; if (!c) return null; const { track, ...s } = c; return s'),
		track: () => ctx.js('return window.__ctr?.track ?? null'),
		deadline: deadline,
		now: () => (stopped ? Infinity : Date.now()),
	}).catch(e => e)
	const k = await watch
	stopped = true
	await driving
	await f.all()
	await turbo(ctx, false)
	if (!k || k.lap < 1) throw new Error(`no lap by touch in 4 min : ${JSON.stringify(k)}`)
	return `lap 1 done by touch in ${((Date.now() - start) / 1000).toFixed(0)} s (turbo), top speed ${top}`
}

export default async ctx => {
	await ctx.scenario('TOUCH-SHOWN', async () => {
		await phone(ctx, null)
		await touchSettings(ctx, {})
		await startAt(ctx, 'menu')
		await sleep(1000)
		const desktop = await touchState(ctx)
		if (desktop) throw new Error(`touch controls on a desktop : ${JSON.stringify(desktop)}`)
		const menu = await onPhone(ctx, 'menu', {}, { kind: 'menu' })
		for (const id of ['dpad', 'cross', 'triangle', 'start']) if (!menu.ids.includes(id)) throw new Error(`the menus' pad lacks ${id} : ${menu.ids}`)
		await shot(ctx, 'menu-pad')
		const race = await onPhone(ctx, TT, { touchLayout: null }, { kind: 'e' })
		await shot(ctx, 'race-default')
		return `desktop : none · menu : ${menu.ids.join(' ')} · race (the default, E) : ${race.ids.join(' ')}`
	})

	await ctx.scenario('TOUCH-FINGERS', async () => {
		await onPhone(ctx, TT, { touchHold: 0 }, { kind: 'a' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		const f = fingers(ctx)
		// up to speed on GO, then the left thumb steers, R slides and the item goes, GO still down
		await f.on(2, 'go')
		await sleep(2000)
		const k0 = await kart(ctx)
		const z = await f.rect('steer')
		await f.down(1, z.x + 70, z.y + z.h - 90)
		await f.move(1, z.x + 70 - 60, z.y + z.h - 90)
		await f.on(3, 'slide')
		await f.on(4, 'item')
		await sleep(300)
		const t = await touchState(ctx)
		const k1 = await kart(ctx)
		await sleep(900)
		const k2 = await kart(ctx)
		await f.all()
		for (const id of ['go', 'slide', 'item']) if (!t.on.includes(id)) throw new Error(`${id} not shown pressed : ${t.on}`)
		if (!k1.cross) throw new Error('Cross not held with four fingers down')
		if (k0.speed <= 0) throw new Error(`GO did not move the kart : ${JSON.stringify(k0)}`)
		const turned = ((k2.angle - k0.angle + 0x1800) & 0xfff) - 0x800
		if (Math.abs(turned) < 100) throw new Error(`the stick did not turn the kart : ${turned}`)
		return `GO : speed ${k0.speed} · then 4 fingers : drawn pressed ${t.on.join(' ')} · Cross held · turned ${turned} (of 4096) in 1.2 s, speed ${k2.speed}`
	})

	await ctx.scenario('TOUCH-LAP-ENHANCED', async () => {
		// the Bot lifts and puts its steering finger back within milliseconds : no slide from the stick
		await onPhone(ctx, TT, { touchHold: 0, touchLayout: 'a', touchRetapMs: 0 }, { kind: 'a' })
		return touchLap(ctx, 'a')
	})

	await ctx.scenario('TOUCH-LAP-MINIMAL', async () => {
		await onPhone(ctx, TT, { touchMode: 'minimal' }, { kind: 'minimal' })
		return touchLap(ctx, 'minimal')
	})

	await ctx.scenario('TOUCH-START-BOOST', async () => {
		const tries = []
		// GO pressed `ms` before the lights end, kept down ; the boost is read just after GO
		for (const ms of [1300, 1000, 700, 400]) {
			await onPhone(ctx, TT, {}, { kind: 'a' })
			const f = fingers(ctx)
			let s = await until(ctx, 'the countdown', c => c.screen === 'countdown' && c.lights > 0, { timeout: 30_000, every: 50 })
			while (s.lights > ms) { await sleep(20); s = await state(ctx) }
			await f.on(2, 'go')
			const pressedAt = s.lights
			const before = await touchState(ctx)
			s = await until(ctx, 'GO', c => c.lights <= 0 && c.screen === 'race', { timeout: 10_000, every: 30 })
			await sleep(150)
			const k = await kart(ctx)
			const t = await touchState(ctx)
			await f.all()
			tries.push({ ms, pressedAt, reserves: k?.reserves ?? null, holdBefore: before.hold, holdAfter: t.hold })
			say(`GO pressed at lights ${pressedAt} : reserves ${k?.reserves} · hold ${before.hold} → ${t.hold}`)
		}
		const boost = tries.find(t => t.reserves > 0)
		if (!boost) throw new Error(`no start boost by touch : ${JSON.stringify(tries)}`)
		return tries.map(t => `${t.ms} ms before GO → reserves ${t.reserves} (hold ${t.holdBefore} → ${t.holdAfter})`).join(' · ')
	})

	await ctx.scenario('TOUCH-HOLD', async () => {
		await onPhone(ctx, TT, { touchHoldMs: 800 }, { kind: 'a' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		const f = fingers(ctx)
		const lockGo = async () => {
			await f.on(2, 'go')
			await sleep(1300)
			await f.off(2)
			await sleep(500)
			const t = await touchState(ctx)
			const k = await kart(ctx)
			if (t.hold !== 'held' || !k.cross) throw new Error(`GO held 1.3 s, lifted : hold ${t.hold}, Cross ${k.cross}`)
		}
		const out = []
		// a short press : plain
		await f.on(2, 'go')
		await sleep(300)
		await f.off(2)
		await sleep(400)
		if ((await touchState(ctx)).hold !== 'idle' || (await kart(ctx)).cross) throw new Error('a 0.3 s press locked')
		out.push('0.3 s : plain')
		await lockGo()
		out.push('1.3 s : locked, finger off, Cross held')
		await f.on(3, 'brake')
		await sleep(300)
		await f.off(3)
		await sleep(300)
		if ((await touchState(ctx)).hold !== 'idle' || (await kart(ctx)).cross) throw new Error('the brake did not let go')
		out.push('brake : let go')
		await lockGo()
		await f.on(2, 'go')
		await sleep(150)
		await f.off(2)
		await sleep(300)
		if ((await touchState(ctx)).hold !== 'idle' || (await kart(ctx)).cross) throw new Error('a tap on GO did not let go')
		out.push('tap : let go')
		await lockGo()
		await f.on(5, 'start')
		await sleep(200)
		await f.off(5)
		await until(ctx, 'the pause', s => s.screen === 'paused', { timeout: 5000 })
		await sleep(300)
		const paused = await touchState(ctx)
		if (paused.hold !== 'idle' || paused.kind !== 'menu') throw new Error(`paused : ${JSON.stringify(paused)}`)
		out.push('pause : let go, the menus\' pad')
		await onPhone(ctx, TT, { touchHold: 0 }, { kind: 'a' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		await f.on(2, 'go')
		await sleep(1500)
		await f.off(2)
		await sleep(400)
		if ((await kart(ctx)).cross) throw new Error('hold off : Cross stayed')
		out.push('off : plain')
		return out.join(' · ')
	})

	await ctx.scenario('TOUCH-MENUS-BACK', async () => {
		await onPhone(ctx, 'menu', {}, { kind: 'menu' })
		const f = fingers(ctx)
		const menu = async () => (await state(ctx))?.menu
		const row0 = (await menu()).label
		const r = await f.rect('dpad')
		await f.down(1, r.cx, r.cy + r.h * 0.38)
		await sleep(200)
		await f.off(1)
		await sleep(400)
		const row1 = (await menu()).label
		if (row1 === row0) throw new Error(`the D-pad's down did not move the menu : ${row0}`)
		const back = []
		// into the next screen and back, three times
		for (let i = 0; i < 3; i++) {
			const before = JSON.stringify(await menu())
			await f.on(2, 'cross')
			await sleep(150)
			await f.off(2)
			await sleep(900)
			const inside = await state(ctx)
			await f.on(3, 'triangle')
			await sleep(150)
			await f.off(3)
			await sleep(900)
			const after = await menu()
			const where = inside.charSelect ? 'the character select' : inside.sub ? `${inside.sub.title} (${inside.sub.label})` : inside.menu ? `${inside.menu.title} (${inside.menu.label})` : inside.screen
			if (JSON.stringify(inside.menu) === before && !inside.charSelect && !inside.sub) throw new Error(`OK opened nothing : ${where}`)
			back.push(`${JSON.parse(before).label} → ${where} → ${after?.label}`)
			if (after?.label !== JSON.parse(before).label) throw new Error(`BACK did not come back : ${back.join(' | ')}`)
		}
		return `down : ${row0} → ${row1} · ${back.join(' | ')}`
	})

	await ctx.scenario('TOUCH-BOOT-INTRO', async () => {
		await phone(ctx, IPHONE_MINI)
		await ctx.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, ctx.sid).catch(() => {})
		await touchSettings(ctx, {})
		await ctx.js("localStorage.removeItem('ctr-ui.auto-start'); return true")
		await ctx.conn.send('Page.navigate', { url: await ctx.js('return location.origin + location.pathname') }, ctx.sid)
		await sleep(500)
		const seen = {}
		let s = null
		for (const end = Date.now() + 150_000; Date.now() < end; await sleep(250)) {
			s = await state(ctx).catch(() => null)
			const t = await touchState(ctx).catch(() => null)
			if (s && t) {
				const key = `${t.kind}@${s.levelID}`
				seen[key] = (seen[key] ?? 0) + 1
			}
			if (onMainMenu(s)) break
		}
		const kinds = Object.keys(seen)
		if (!onMainMenu(s)) throw new Error(`no main menu in 150 s (${s?.screen}, level ${s?.levelID}) · seen ${kinds.join(' ')}`)
		const race = kinds.filter((k) => !k.startsWith('menu@'))
		if (race.length) throw new Error(`the race's controls during the boot : ${race.join(' ')} (all : ${kinds.join(' ')})`)
		return `the boot to the main menu : ${kinds.join(' ')} (kind@level)`
	})

	await ctx.scenario('TOUCH-STICK-SLIDE', async () => {
		await onPhone(ctx, TT, { touchLayout: 'a' }, { kind: 'a' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		// what the game says to the page, counted : sliding pulls
		await ctx.js("const t = Module.ctrInput.touch; window.__sl = { slide: 0, last: 0 }; Module.ctrInput.touch = (h, d, r, s, red) => { if (s) __sl.slide++; __sl.last = s ? 1 : 0; return t(h, d, r, s, red) }; return true")
		const f = fingers(ctx)
		await f.on(2, 'go')
		await sleep(2500)
		const z = await f.rect('steer')
		const [x, y] = [z.x + 70, z.y + z.h - 90]
		await f.down(1, x, y)
		await f.move(1, x + 60, y)
		await sleep(300)
		const lx0 = (await kart(ctx))?.angle
		await f.up(1)
		await sleep(60)
		await f.down(1, x + 10, y + 5)
		await sleep(1200)
		const during = await ctx.js('return { ...window.__sl }')
		await f.up(1)
		await sleep(150)
		const atLift = await ctx.js('return window.__sl.slide')
		await sleep(600)
		const after = await ctx.js('return { ...window.__sl }')
		await f.all()
		void lx0
		if (during.slide < 10) throw new Error(`no slide from the stick : ${JSON.stringify(during)}`)
		if (after.last || after.slide > atLift + 2) throw new Error(`the left thumb lifted, the slide went on : ${atLift} → ${JSON.stringify(after)}`)
		return `lift + touch while turning : the game slides (${during.slide} pulls) · lifted : the slide ends`
	})

	await ctx.scenario('TOUCH-E', async () => {
		await onPhone(ctx, TT, { touchLayout: 'e' }, { kind: 'e' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		await ctx.js("const t = Module.ctrInput.touch; window.__sl = { slide: 0, last: 0 }; Module.ctrInput.touch = (h, d, r, s, ...a) => { if (s) __sl.slide++; __sl.last = s ? 1 : 0; return t(h, d, r, s, ...a) }; return true")
		const f = fingers(ctx)
		const right = await f.rect('right')
		const [rx, ry] = [right.cx, right.cy]
		await f.down(2, rx, ry)
		await sleep(1300)
		await f.up(2)
		await sleep(300)
		const held = await touchState(ctx)
		if (held.hold !== 'held' || !(await kart(ctx)).cross) throw new Error(`the right half held : ${held.hold}`)
		await sleep(1200)
		const z = await f.rect('steer')
		const [x, y] = [z.x + 70, z.y + z.h - 90]
		await f.down(1, x, y)
		await f.move(1, x + 60, y)
		await sleep(150)
		await f.down(2, rx, ry)
		await sleep(80)
		await f.up(2)
		let best = 0
		for (const end = Date.now() + 1500; Date.now() < end; await sleep(60)) best = Math.max(best, (await kart(ctx))?.reserves ?? 0)
		const during = await ctx.js('return { ...window.__sl }')
		await f.up(1)
		await sleep(700)
		const after = await ctx.js('return { ...window.__sl }')
		await f.all()
		if (during.slide < 5) throw new Error(`a tap turning : no slide (${JSON.stringify(during)})`)
		if (after.last) throw new Error('the steering thumb lifted, the slide went on')
		return `GO held by itself · a tap turning : the game slid ${during.slide} pulls, reserves up to ${best} (the auto boost) · the steering thumb lifted : ended`
	})

	// 42b : E's last actions, as the game pulls them. The item's direction is the game's rule
	// (VehPickupItem.c : Down held = a bomb backward, Up held = a potion ahead) : what is checked
	// here is that Circle and the direction reach the game in the same pull.
	await ctx.scenario('TOUCH-E-ACTIONS', async () => {
		const { f, right, zone } = await eDriving(ctx)
		await spy(ctx)
		const swipe = async dy => {
			await f.down(2, right.cx, right.cy)
			await f.move(2, right.cx, right.cy + dy)
			await sleep(250)
			await f.up(2)
			await sleep(150)
			return pulls(ctx)
		}
		const up = await swipe(-45)
		const down = await swipe(45)
		const both = (list, dir) => list.filter(p => (p[0] & (0x2000 | dir)) === (0x2000 | dir)).length
		if (!both(up, 0x10)) throw new Error('swipe up : no pull with Circle and Up')
		if (!both(down, 0x40)) throw new Error('swipe down : no pull with Circle and Down')
		if (down.some(p => p[0] & 0x8000)) throw new Error('swipe down still brakes')
		if (!(await kart(ctx)).cross) throw new Error('the swipes let GO go')
		// a turn, pulled back a little : no brake
		const [x, y] = [zone.x + 70, zone.y + 50]
		await f.down(1, x, y)
		await f.move(1, x + 40, y + 20)
		await sleep(400)
		const turn = await pulls(ctx)
		if (turn.some(p => p[0] & 0x8000)) throw new Error('a turn brakes')
		const fast = (await kart(ctx)).speed
		// straight down : the brake, Cross let go ; kept down : the kart backs up
		await f.move(1, x, y + 60)
		await sleep(1500)
		const braking = await pulls(ctx)
		const slowed = await kart(ctx)
		await sleep(2500)
		const backing = await kart(ctx)
		const drawn = await ctx.js("return document.querySelector('#ctr-touch .stick-base')?.classList.contains('brake') ?? false")
		await f.all()
		const squares = braking.filter(p => p[0] & 0x8000).length
		if (squares < 5) throw new Error(`the stick down : Square in ${squares} of ${braking.length} pulls`)
		if (slowed.cross) throw new Error('the brake : Cross still held')
		if (!(Math.abs(slowed.speed) < Math.abs(fast) / 2)) throw new Error(`the brake : speed ${fast} → ${slowed.speed}`)
		if (!drawn) throw new Error('the stick is not drawn braking')
		const moved = Math.hypot(backing.pos.x - slowed.pos.x, backing.pos.z - slowed.pos.z)
		return `swipe up : Circle + Up in ${both(up, 0x10)} pulls · swipe down : Circle + Down in ${both(down, 0x40)}, no Square, GO kept · a turn : no brake · the stick down : Square in ${squares} pulls, speed ${fast} → ${slowed.speed}, then ${backing.speed} (moved ${Math.round(moved)} : backing up)`
	})

	// 42b, the user 2026-11-19 : « si on met le stick vers le haut faut que ça avance » — the stick
	// pushed straight up from the start : Cross, the kart moves, held 0.8 s it locks ; the thumb
	// back to the centre, the kart goes on.
	await ctx.scenario('TOUCH-E-STICK-UP', async () => {
		await onPhone(ctx, TT, { touchLayout: 'e' }, { kind: 'e' })
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		const f = fingers(ctx)
		const zone = await f.rect('steer')
		const [x, y] = [zone.x + 70, zone.y + zone.h - 60]
		await f.down(1, x, y)
		await f.move(1, x, y - 60)
		let speed = 0
		for (const end = Date.now() + 20_000; Date.now() < end && speed < 9000; await sleep(50)) speed = (await kart(ctx))?.speed ?? 0
		const drawn = await ctx.js("return document.querySelector('#ctr-touch .stick-base')?.classList.contains('gas') ?? false")
		await f.move(1, x, y)
		await sleep(400)
		const t = await touchState(ctx)
		const k = await kart(ctx)
		await f.all()
		if (speed < 9000) throw new Error(`the stick up : speed ${speed}`)
		if (!drawn) throw new Error('the stick is not drawn as GO')
		if (t.hold !== 'held' || !k.cross) throw new Error(`the stick back to the centre : hold ${t.hold}, Cross ${k.cross}`)
		return `the stick up alone : speed ${speed}, drawn as GO ; back to the centre : hold ${t.hold}, Cross kept, speed ${k.speed}`
	})

	// 42b, the user 2026-11-19 : « l'auto-accelerate s'est mise à s'arrêter après que je me sois pris
	// un projectile (et je suis pas tombé) » — the hold locked, P1 hit by the game's own damage
	// (ctrDev.hit : 2 blasted, 1 a spin) : the hold stays locked, Cross stays down, the kart drives on.
	await ctx.scenario('TOUCH-HOLD-HIT', async () => {
		await eDriving(ctx)
		const trace = []
		const sample = async (ms) => {
			for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
				const k = (await state(ctx))?.karts?.[0] ?? {}
				const t = await touchState(ctx)
				trace.push(`${t.hold[0]}${k.cross ? 'X' : '-'}${k.state}:${k.speed}`)
			}
		}
		const out = []
		for (const type of [2, 1]) {
			trace.length = 0
			await ctx.js(`ctrDev.hit(${type}); return true`)
			await sample(5000)
			const k = (await state(ctx))?.karts?.[0] ?? {}
			const t = await touchState(ctx)
			const hit = trace.some(e => [3, 6].includes(Number(e.slice(2).split(':')[0])))
			out.push(`hit ${type} : ${trace.filter((_, i) => i % 5 === 0).join(' ')}`)
			if (!hit) throw new Error(`hit ${type} never reached the kart : ${trace.join(' ')}`)
			// the speed it gets back once the hit is over (no one steers : a wall comes later)
			const after = trace.slice(trace.findLastIndex(e => [3, 6].includes(Number(e.slice(2).split(':')[0]))) + 1)
			const back = Math.max(0, ...after.map(e => Number(e.split(':')[1])))
			if (t.hold !== 'held' || !k.cross || back < 9000) throw new Error(`after hit ${type} : hold ${t.hold}, Cross ${k.cross}, back to ${back} — ${trace.join(' ')}`)
		}
		return out.join(' · ')
	})

	// 42b, the user 2026-11-19 : « améliorer les contrôles en mode vertical, mettre les contrôles plus
	// petits en bas » — upright, the game at the top (its picture's rect), the controls under it.
	await ctx.scenario('TOUCH-PORTRAIT', async () => {
		const rects = () => ctx.js("const c = document.getElementById('canvas').getBoundingClientRect(); return { game: [c.x, c.y, c.width, c.height], controls: [...document.querySelectorAll('#ctr-touch [data-id]')].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height } }), W: innerWidth, H: innerHeight }")
		const out = []
		for (const layout of ['e', 'a', 'minimal']) {
			const s = layout === 'minimal' ? { touchMode: 'minimal' } : { touchLayout: layout }
			await onPhone(ctx, TT, s, { kind: layout, portrait: true })
			await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
			await sleep(500)
			const r = await rects()
			const [gx, gy, gw, gh] = r.game
			if (r.W !== 375 || Math.abs(gy) > 1 || Math.abs(gw - 375) > 1) throw new Error(`the game upright : ${JSON.stringify(r.game)} on ${r.W} × ${r.H}`)
			const over = r.controls.filter(c => c.y < gy + gh - 1 || c.y + c.h > r.H + 1 || c.x < -1 || c.x + c.w > r.W + 1)
			if (over.length) throw new Error(`${layout} : over the game or off the screen : ${JSON.stringify(over)}`)
			if (!r.controls.length) throw new Error(`${layout} : no controls`)
			await shot(ctx, `portrait-${layout}`)
			out.push(`${layout} : ${r.controls.length} controls from y ${Math.round(Math.min(...r.controls.map(c => c.y)))} (the game ends at ${Math.round(gy + gh)})`)
		}
		// E drives upright : the right half held
		await onPhone(ctx, TT, { touchLayout: 'e' }, { kind: 'e', portrait: true })
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		const f = fingers(ctx)
		const right = await f.rect('right')
		await f.down(2, right.cx, right.cy)
		let speed = 0
		for (const end = Date.now() + 20_000; Date.now() < end && speed < 9000; await sleep(50)) speed = (await kart(ctx))?.speed ?? 0
		await f.all()
		if (speed < 9000) throw new Error(`GO upright : speed ${speed}`)
		// turned back : landscape's places, the game centred again
		await phone(ctx, IPHONE_MINI)
		await sleep(800)
		const flat = await rects()
		const go = flat.controls.find(c => c.id === 'right')
		if (Math.abs(flat.game[1] - (375 - flat.game[3]) / 2) > 1 || !go || go.x < 400) throw new Error(`back to landscape : ${JSON.stringify(flat.game)} ${JSON.stringify(go)}`)
		return `${out.join(' · ')} · GO upright : speed ${speed} · landscape again : the game centred, the right half from x ${Math.round(go.x)}`
	})

	// 42b, the user 2026-11-19 : « slide gauche slide droite pour déclencher le dérapage. Et que ça
	// déclenche en prio l'item si on a un item au lieu du saut » — the switch on : a swipe right with
	// the stick untouched, the game slides right ; an item in hand (ctrDev.item), a tap uses it
	// (heldItemID back to none) with no hop ; another, held still : the hop, the item kept.
	await ctx.scenario('TOUCH-E-SWIPE', async () => {
		// the kart's turn over 0.3 s of a slide (4096 a turn ; its sign, the side)
		const slideTurn = async (what) => {
			const st = await until(ctx, what, c => c.karts?.[0]?.state === 2, { timeout: 3000, every: 30 })
			await sleep(300)
			const a1 = (await state(ctx)).karts[0].angle
			await until(ctx, `${what} over`, c => c.karts?.[0]?.state !== 2, { timeout: 5000, every: 50 })
			return ((((a1 - st.karts[0].angle) % 4096) + 6144) % 4096) - 2048
		}
		// the side of a right turn, by the stick : the same tap as without the switch, the stick right
		const one = await eDriving(ctx, { touchSwipeSlide: 1 })
		const [x, y] = [one.zone.x + one.zone.w / 2, one.zone.y + one.zone.h / 2]
		await one.f.down(1, x, y)
		await one.f.move(1, x + 70, y)
		await sleep(150)
		await one.f.down(2, one.right.cx, one.right.cy)
		await sleep(80)
		await one.f.up(2)
		const stickTurn = await slideTurn('the stick\'s slide')
		await one.f.all()
		// a swipe right, the stick untouched (the race again : a slide ends at a wall)
		const { f, right } = await eDriving(ctx, { touchSwipeSlide: 1 })
		const k0 = (await state(ctx)).karts[0]
		await f.down(2, right.cx, right.cy)
		await f.move(2, right.cx + 50, right.cy)
		await sleep(60)
		await f.up(2)
		const turn = await slideTurn('the swiped slide')
		if (!turn || Math.sign(turn) !== Math.sign(stickTurn)) throw new Error(`the swipe right turned ${turn}, the stick right ${stickTurn}`)
		// an item : a tap uses it, the kart stays on the ground
		await ctx.js('ctrDev.item(2); return true')
		await until(ctx, 'the item in hand', c => c.karts?.[0]?.item === 2, { timeout: 3000, every: 30 })
		await sleep(300)
		await spy(ctx)
		await f.down(2, right.cx, right.cy)
		await sleep(70)
		await f.up(2)
		const used = await until(ctx, 'the item used', c => c.karts?.[0]?.item === 15, { timeout: 3000, every: 30 }).catch(() => null)
		const tapped = await pulls(ctx)
		const r1 = tapped.filter(p => p[0] & 0x800).length
		const circle = tapped.filter(p => p[0] & 0x2000).length
		if (!used || !circle || r1) throw new Error(`a tap with an item : used ${!!used}, Circle in ${circle} pulls, R1 in ${r1}`)
		// held still with an item : the hop, the item kept
		await sleep(1500)
		await ctx.js('ctrDev.item(2); return true')
		await until(ctx, 'the item in hand', c => c.karts?.[0]?.item === 2, { timeout: 3000, every: 30 })
		await sleep(300)
		await pulls(ctx)
		await f.down(2, right.cx, right.cy)
		await sleep(350)
		await f.up(2)
		await sleep(300)
		const held = await pulls(ctx)
		const k = (await state(ctx)).karts[0]
		const hop = held.filter(p => p[0] & 0x800).length
		if (!hop || held.some(p => p[0] & 0x2000) || k.item !== 2) throw new Error(`held still with an item : R1 in ${hop} pulls, Circle ${held.filter(p => p[0] & 0x2000).length}, item ${k.item}`)
		return `a swipe right, the stick untouched : the slide, turned ${turn} in 0.3 s (a slide by the stick right : ${stickTurn}, the same side ; speed ${k0.speed}) · a missile in hand, a tap : used (Circle in ${circle} pulls, no R1) · another, held still : the hop (R1 in ${hop} pulls), the missile kept`
	})

	// 42b, the user 2026-11-19 : « s'il va vers la gauche il faudrait qu'en braquant à droite je
	// ralentisse la courbe » — a slide to the left, then the thumb held at one place : the kart's
	// turn rate (__ctr.kart.angle, 4096 a turn) for each place, from tight to wide.
	await ctx.scenario('TOUCH-E-COUNTERSTEER', async () => {
		const rows = []
		const side = 1 // a slide to the right : Crash Cove's start has a wall on its left
		for (const v of [1, 0, -0.25, -1]) {
			const { f, right, zone } = await eDriving(ctx)
			const [x, y] = [zone.x + zone.w / 2, zone.y + zone.h / 2]
			await f.down(1, x, y)
			await f.move(1, x + side * 70, y)
			await sleep(150)
			await f.down(2, right.cx, right.cy)
			await sleep(80)
			await f.up(2)
			const st = await until(ctx, 'the slide', c => c.karts?.[0]?.state === 2, { timeout: 3000, every: 30 }).catch(() => null)
			if (!st) { await f.all(); rows.push(`${v} : no slide`); continue }
			await f.move(1, x + side * 70 * v, y)
			await sleep(100)
			const a = []
			for (let i = 0; i < 12; i++) { const k = (await state(ctx))?.karts?.[0]; a.push([Date.now(), k?.angle ?? 0, k?.state]); await sleep(50) }
			await f.all()
			const sl = a.filter(e => e[2] === 2)
			if (sl.length < a.length) throw new Error(`the thumb held at ${v} : the slide ended (${a.map(e => e[2]).join('')})`)
			const turn = Math.abs(((((sl.at(-1)[1] - sl[0][1]) % 4096) + 6144) % 4096) - 2048) / ((sl.at(-1)[0] - sl[0][0]) / 1000)
			rows.push({ v, turn: Math.round(turn) })
		}
		const said = rows.map(r => `${r.v} : ${r.turn}/s`).join(' · ')
		for (let i = 1; i < rows.length; i++) if (!(rows[i].turn < rows[i - 1].turn)) throw new Error(`the slide does not widen as the stick goes away from the turn : ${said}`)
		return `a slide to the right, the stick held (1 = into the turn, -1 = away), the kart's turn (4096 a turn) : ${said}`
	})

	// 42b : the auto boost makes a slide's first boost only ; the zone turns red, « 1 · 2 · 3 » shows.
	// In the race : the first red, tapped by the page, and the game's count coming back as 1. A slide
	// on a straight meets a wall about a second in (KS_CRASHING), before its second red : the
	// second and third reds are then played to the page in the game's place (`__force` : sliding,
	// red, the boosts made, as the game would say them) and its packets read.
	await ctx.scenario('TOUCH-E-BOOSTS', async () => {
		const { f, right, zone } = await eDriving(ctx)
		await spy(ctx)
		await ctx.js("window.__seen = { made: 0, red: 0, bg: '', pips: 0 }; window.__seenT = setInterval(() => { const t = document.querySelector('#ctr-touch'); const p = t?.querySelector('.pips'); if (p) { __seen.pips++; __seen.made = Math.max(__seen.made, +p.dataset.made) } if (t?.dataset.window === 'red') { __seen.red++; __seen.bg = getComputedStyle(t.querySelector('[data-id=right]')).backgroundColor } }, 16); return true")
		const [x, y] = [zone.x + 70, zone.y + 50]
		await f.down(1, x, y)
		await f.move(1, x + 60, y)
		await sleep(150)
		await f.down(2, right.cx, right.cy)
		await sleep(80)
		await f.up(2)
		await sleep(2500)
		const list = await pulls(ctx)
		const seen = await ctx.js('return { ...window.__seen }')
		// the slide as pulled, in runs : s = sliding, r = red, the digit = boosts made, L = L1
		const runs = []
		for (const p of list) { const k = `${p[1] ? 's' : '-'}${p[2] ? 'r' : ''}${p[3]}${p[0] & 0x400 ? 'L' : ''}`; if (runs.at(-1)?.[0] === k) runs.at(-1)[1]++; else runs.push([k, 1]) }
		const trace = runs.map(r => `${r[0]}×${r[1]}`).join(' ')
		const first = list.filter(p => (p[0] & 0x400) && p[1] && p[3] === 0).length
		const made = Math.max(0, ...list.map(p => p[3]))
		if (!first) throw new Error(`the first boost was not tapped : ${trace}`)
		if (made !== 1) throw new Error(`the game's count after the first boost : ${made} (${trace})`)
		if (!seen.red || !/255, 70, 50/.test(seen.bg)) throw new Error(`the right half at the red : ${JSON.stringify(seen)}`)
		if (!seen.pips || seen.made !== 1) throw new Error(`« 1 · 2 · 3 » : ${JSON.stringify(seen)}`)
		// the second and the third red, said to the page as the game would
		await ctx.js("const t = Module.ctrInput.touch; Module.ctrInput.touch = (h, d, r, s, red, rev, made) => (window.__force ? t(h, d, r, window.__force[0], window.__force[1], rev, window.__force[2]) : t(h, d, r, s, red, rev, made)); return true")
		const say = async (sliding, red, n, ms) => { await ctx.js(`window.__force = [${sliding}, ${red}, ${n}]; return true`); await sleep(ms) }
		await pulls(ctx)
		await say(true, false, 1, 200)
		await say(true, true, 1, 300)
		await say(true, false, 2, 200)
		await say(true, true, 2, 300)
		const auto = await pulls(ctx)
		// the player's own tap in that red still boosts
		await f.down(2, right.cx, right.cy)
		await sleep(120)
		await f.up(2)
		await sleep(150)
		const hand = await pulls(ctx)
		const drawn = await ctx.js("const p = document.querySelector('#ctr-touch .pips'); return p ? { made: +p.dataset.made, now: [...p.children].findIndex(c => c.classList.contains('now')) + 1 } : null")
		await ctx.js('window.__force = null; clearInterval(window.__seenT); return true')
		await f.all()
		const reds = auto.filter(p => p[2]).length
		const l1 = auto.filter(p => p[0] & 0x400).length
		if (reds < 10) throw new Error(`the reds said to the page : ${reds} pulls`)
		if (l1) throw new Error(`the page tapped L1 at the second or third red (${l1} of ${auto.length} pulls)`)
		if (!hand.some(p => p[0] & 0x400)) throw new Error(`the player's tap at the third red : no L1 (${JSON.stringify(await touchState(ctx))} ${hand.slice(0, 12).map(p => p[0].toString(16) + '/' + p[1] + p[2] + p[3]).join(' ')})`)
		if (!drawn || drawn.made !== 2 || drawn.now !== 3) throw new Error(`« 1 · 2 · 3 » at the third red : ${JSON.stringify(drawn)}`)
		return `in the race : the first red tapped by the page (L1 in ${first} pulls), the game counts ${made}, the zone red (${seen.bg}), the pips at ${seen.made} · the second and third reds (${reds} pulls, said to the page) : no L1 by the page, the player's tap gives it, the pips show 2 made and 3 now`
	})

	// 42b : « my pad » — the editor over the paused race, a control moved, resized, added, removed,
	// kept as the layout « mine », played, kept across a reload ; its ways back
	await ctx.scenario('TOUCH-EDITOR', async () => {
		await ctx.js("localStorage.removeItem('ctr-ui.touch-custom'); return true")
		await onPhone(ctx, TT, { touchLayout: 'a' }, { kind: 'a' })
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		const click = sel => ctx.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true`)
		const wait = async (what, expr, ms = 8000) => {
			for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) { const v = await ctx.js(`return (${expr})`); if (v) return v }
			throw new Error(`no ${what}`)
		}
		const box = id => ctx.js(`const r = document.querySelector('#ctr-touch-editor [data-id=${id}]')?.getBoundingClientRect(); return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width } : null`)
		// Settings › Controls › Touch, until `id` is there
		const touchTab = async id => {
			await click('#ctr-settings [data-tab=controls]')
			await wait('Controls', "!!document.querySelector('#ctr-settings [data-device=touch]')")
			await click('#ctr-settings [data-device=touch]')
			await wait(id, `!!document.getElementById('${id}')`)
		}
		const openEditor = async () => {
			await click('#ctr-gear')
			await wait('Settings', "!!document.getElementById('ctr-settings')")
			await touchTab('ctr-touch-edit')
			await click('#ctr-touch-edit')
			await wait('the editor', "!!document.getElementById('ctr-touch-editor') && !document.getElementById('ctr-settings')")
		}
		await openEditor()
		await until(ctx, 'the pause', st => st.screen === 'paused', { timeout: 5000 })
		if (await touchState(ctx)) throw new Error('the touch controls stay under the editor')
		const f = fingers(ctx)
		// move GO
		const go0 = await box('go')
		await f.down(1, go0.cx, go0.cy)
		await f.move(1, go0.cx - 150, go0.cy - 80)
		await f.up(1)
		const go1 = await box('go')
		if (Math.abs(go1.cx - (go0.cx - 150)) > 2 || Math.abs(go1.cy - (go0.cy - 80)) > 2) throw new Error(`GO dragged : ${JSON.stringify(go0)} → ${JSON.stringify(go1)}`)
		// dragged off the screen's edge : it stays inside the margin (Chrome has no iOS safe areas :
		// the notch's band is node --test's, touch-custom.test.js)
		await f.down(1, go1.cx, go1.cy)
		await f.move(1, 2, go1.cy)
		await f.up(1)
		const edge = await box('go')
		if (edge.cx < 8) throw new Error(`GO off the margin : ${edge.cx}`)
		await f.down(1, edge.cx, edge.cy)
		await f.move(1, go1.cx, go1.cy)
		await f.up(1)
		// its size (the picked control's slider)
		await ctx.js("const i = document.getElementById('ctr-edit-size'); i.value = '1.4'; i.dispatchEvent(new Event('input', { bubbles: true })); return true")
		await shot(ctx, 'editor-picked')
		const go2 = await box('go')
		if (!(Math.abs(go2.w / go1.w - 1.4) < 0.02) || Math.abs(go2.cx - go1.cx) > 1) throw new Error(`GO × 1.4 : ${go1.w} → ${go2.w}`)
		// add a super button, remove BRAKE ; pause cannot go
		await click('#ctr-edit-add')
		await wait('the palette', "document.querySelectorAll('#ctr-edit-tray [data-add]').length")
		await shot(ctx, 'editor-palette')
		await click('#ctr-edit-tray [data-add=itemDown]')
		const added = await box('itemDown')
		if (!added) throw new Error('ITEM v not added')
		const brake = await box('brake')
		await f.down(1, brake.cx, brake.cy)
		await f.up(1)
		await click('#ctr-edit-remove')
		if (await box('brake')) throw new Error('BRAKE not removed')
		const start = await box('start')
		await f.down(1, start.cx, start.cy)
		await f.up(1)
		if (await ctx.js("return !!document.getElementById('ctr-edit-remove')")) throw new Error('pause can be removed')
		// no accelerator : told, not refused
		await f.down(1, go2.cx, go2.cy)
		await f.up(1)
		await click('#ctr-edit-remove')
		const warn = await ctx.js("return document.getElementById('ctr-edit-warn').textContent.trim()")
		if (!warn) throw new Error('no warning without an accelerator')
		// Reset : back to what the editor opened on ; then the same edits again, shorter
		await click('#ctr-edit-reset')
		const back = await box('go')
		if (Math.abs(back.cx - go0.cx) > 1 || !(await box('brake')) || (await box('itemDown'))) throw new Error('Reset did not bring the layout back')
		await f.down(1, go0.cx, go0.cy)
		await f.move(1, go0.cx - 150, go0.cy - 80)
		await f.up(1)
		await click('#ctr-edit-add')
		await click('#ctr-edit-tray [data-add=itemDown]')
		const item = await box('itemDown')
		// Done : kept as « mine », the race resumes, the pad is played
		await click('#ctr-edit-done')
		await until(ctx, 'the race again', st => st.screen === 'race', { timeout: 5000 })
		const mine = await wait('the layout « mine »', "document.querySelector('#ctr-touch')?.dataset.kind === 'mine'")
		const placed = await f.rect('go')
		if (Math.abs(placed.cx - (go0.cx - 150)) > 2) throw new Error(`GO in the race : ${placed.cx}, wanted ${go0.cx - 150}`)
		await spy(ctx)
		await f.down(1, item.cx, item.cy)
		await sleep(200)
		await f.up(1)
		const list = await pulls(ctx)
		if (!list.some(p => (p[0] & 0x2040) === 0x2040)) throw new Error('ITEM v : no pull with Circle and Down')
		// kept across a reload
		await onPhone(ctx, TT, { touchLayout: 'mine' }, { kind: 'mine' })
		const again = await f.rect('go')
		if (Math.abs(again.cx - placed.cx) > 2) throw new Error(`after a reload : GO at ${again.cx}`)
		// « Start from… 3 fingers », then the way back : Settings › Reset my pad → the default
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		await openEditor()
		await click('#ctr-edit-from')
		await click('#ctr-edit-starts [data-start=three]')
		const three = await ctx.js("return [...document.querySelectorAll('#ctr-touch-editor [data-id]')].map(e => e.dataset.id)")
		for (const id of ['steer', 'go', 'slide', 'boost', 'item', 'look', 'start']) if (!three.includes(id)) throw new Error(`3 fingers lacks ${id} : ${three}`)
		await click('#ctr-edit-reset')
		await click('#ctr-edit-done')
		await click('#ctr-gear')
		await wait('Settings', "!!document.getElementById('ctr-settings')")
		await touchTab('ctr-touch-edit-clear')
		await click('#ctr-touch-edit-clear')
		const stored = await ctx.js("return [localStorage.getItem('ctr-ui.touch-custom'), localStorage.getItem('ctr-ui.touch-layout'), !!document.querySelector('[data-touch-layout=mine]')]")
		if (stored[0] !== null || stored[1] !== null || stored[2]) throw new Error(`Reset my pad : ${JSON.stringify(stored)}`)
		await click('#ctr-gear')
		return `the editor pauses the race · GO dragged (kept inside the margin), × 1.4 · ITEM v added, BRAKE removed, pause not removable · no accelerator : « ${warn} » · Reset · Done : « ${mine ? 'mine' : ''} », GO at ${Math.round(placed.cx)}, ITEM v = Circle + Down · kept across a reload · 3 fingers : ${three.join(' ')} · Reset my pad : the default again`
	})

	// 42b : the first-race tutorial — shown once at the first race by touch, the race running under
	// it (the user, 2026-11-19), one card an action for the pad in use, each passed by doing it, a tap
	// skipping one, Skip, « Show the tutorial again ».
	// (Under the harness it never opens by itself : the scenario asks for it, stored « 0 ».)
	await ctx.scenario('TOUCH-TUTORIAL', async () => {
		await phone(ctx, IPHONE_MINI)
		await ctx.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, ctx.sid).catch(() => {})
		await touchSettings(ctx, {})
		await ctx.js("localStorage.removeItem('ctr-ui.touch-custom'); localStorage.setItem('ctr-ui.touch-tutorial', '0'); return true")
		await open(ctx, '?race=crash-cove&char=crash&mode=tt')
		const click = sel => ctx.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true`)
		const wait = async (what, expr, ms = 15_000) => {
			for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) { const v = await ctx.js(`return (${expr})`); if (v) return v }
			throw new Error(`no ${what} (the card : ${JSON.stringify(await card())})`)
		}
		const card = () => ctx.js("const t = document.getElementById('ctr-touch-tutorial'); return t ? { id: t.dataset.card, done: !!t.dataset.done, lit: [...t.querySelectorAll('[data-lit]')].map(e => e.dataset.lit), title: t.querySelector('h3 .name').textContent } : null")
		const onCard = (id, ms = 15_000) => wait(`the card « ${id} »`, `document.getElementById('ctr-touch-tutorial')?.dataset.card === ${JSON.stringify(id)}`, ms)
		await wait('the tutorial at the first race', "!!document.getElementById('ctr-touch-tutorial')", 90_000)
		const first = await card()
		if (first.id !== 'start' || first.lit.join() !== 'right') throw new Error(`card 1 : ${JSON.stringify(first)}`)
		// the race is not paused and the controls are live under the card
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		await wait('the touch controls under the card', "document.querySelector('#ctr-touch')?.dataset.kind === 'e'")
		const f = fingers(ctx)
		const right = await f.rect('right')
		const zone = await f.rect('steer')
		await shot(ctx, 'tutorial-start')
		// the start : done once the race runs (GO) ; then go + steer
		await f.down(2, right.cx, right.cy)
		await onCard('go')
		const frame0 = (await state(ctx)).raceFrame
		const [x, y] = [zone.x + 70, zone.y + zone.h - 90]
		await f.down(1, x, y)
		await f.move(1, x + 40, y)
		await sleep(250)
		await f.move(1, x, y)
		await sleep(1600)
		await f.up(2)
		await shot(ctx, 'tutorial-go-done')
		await onCard('slide', 6000)
		const frame1 = (await state(ctx)).raceFrame
		if (!(frame1 > frame0 + 30)) throw new Error(`the race under the card : frame ${frame0} → ${frame1}`)
		// the slide : turning, a tap on the right
		await f.move(1, x + 60, y)
		await sleep(150)
		await f.down(2, right.cx, right.cy)
		await sleep(80)
		await f.up(2)
		await onCard('items', 6000)
		await f.up(1)
		// the item : a swipe up
		await sleep(300)
		await f.down(2, right.cx, right.cy)
		await f.move(2, right.cx, right.cy - 45)
		await sleep(150)
		await f.up(2)
		await onCard('brake', 6000)
		// › skips it ; the card itself lets a touch through to the controls under it
		const through = await ctx.js("const c = document.getElementById('ctr-tutorial-card').getBoundingClientRect(); const e = document.elementFromPoint(c.x + 20, c.y + c.height - 10); return !e.closest('#ctr-touch-tutorial')")
		if (!through) throw new Error('the card takes the touches under it')
		await click('#ctr-tutorial-next')
		await onCard('look', 3000)
		const look = await card()
		// the look back done, the last : closed, seen
		await f.on(3, 'look')
		await sleep(300)
		await f.all()
		await wait('the cards closed', "!document.getElementById('ctr-touch-tutorial')", 5000)
		if (await ctx.js("return localStorage.getItem('ctr-ui.touch-tutorial')") !== '1') throw new Error('not marked seen')
		// seen : the next race has none
		await startAt(ctx, TT)
		await until(ctx, 'the race', st => st.screen === 'race', { timeout: 30_000 })
		await sleep(1500)
		if (await ctx.js("return !!document.getElementById('ctr-touch-tutorial')")) throw new Error('shown twice')
		// the way back : Settings › Controls › Touch › Show the tutorial again ; Skip
		await click('#ctr-gear')
		await wait('Settings', "!!document.getElementById('ctr-settings')")
		await click('#ctr-settings [data-tab=controls]')
		await wait('Controls', "!!document.querySelector('#ctr-settings [data-device=touch]')")
		await click('#ctr-settings [data-device=touch]')
		await wait('Show the tutorial again', "!!document.getElementById('ctr-touch-tutorial-again')")
		await click('#ctr-touch-tutorial-again')
		await wait('the tutorial again', "!!document.getElementById('ctr-touch-tutorial') && !document.getElementById('ctr-settings')")
		const again = await card()
		await click('#ctr-tutorial-skip')
		await wait('skipped', "!document.getElementById('ctr-touch-tutorial')")
		if ((await state(ctx)).screen !== 'race') throw new Error('the race after Skip')
		if (await ctx.js("return localStorage.getItem('ctr-ui.touch-tutorial')") !== '1') throw new Error('Skip did not mark it seen')
		return `card 1 « ${first.title} » lights ${first.lit.join()}, the controls live, the race running (frame ${frame0} → ${frame1}) · each card passed by doing it : the start (GO), steer + go, a slide, an item (swipe) · the card lets touches through, › skipped « brake » · « ${look.title} » done : closed, seen · the next race : none · « Show the tutorial again » mid-race : « ${again.id} », Skip, the race goes on`
	})

	await ctx.scenario('TOUCH-SLIDE-HOLD', async () => {
		await onPhone(ctx, TT, { touchLayout: 'd' }, { kind: 'd' })
		await until(ctx, 'the race', s => s.screen === 'race', { timeout: 30_000 })
		const f = fingers(ctx)
		await f.on(2, 'go')
		await sleep(2500)
		const z = await f.rect('steer')
		// full lock right at speed on Crash Cove's start (left runs into the wall there, and the game
		// ends a slide against a wall)
		await f.down(1, z.x + 70, z.y + z.h - 90)
		await f.move(1, z.x + 70 + 60, z.y + z.h - 90)
		await f.on(3, 'slide')
		let t = null
		for (const end = Date.now() + 3000; Date.now() < end && (t = await touchState(ctx)) && (t.slide = await ctx.js("return document.getElementById('ctr-touch')?.dataset.slide")) !== 'held'; ) await sleep(100)
		if (t?.slide !== 'held') { await f.all(); throw new Error(`R kept in a slide never held : ${t?.slide}`) }
		// the boost's moment : R lights up red while the game's meter is in its red
		let red = false
		for (const end = Date.now() + 3000; Date.now() < end && !red; await sleep(50)) red = (await ctx.js("return document.getElementById('ctr-touch')?.dataset.window ?? null")) === 'red'
		if (!red) { await f.all(); throw new Error('the boost\'s moment never lit R in a 3 s slide') }
		await f.off(3)
		await sleep(400)
		const lifted = await ctx.js("return document.getElementById('ctr-touch')?.dataset.slide")
		if (lifted !== 'held') throw new Error(`the thumb lifted, the slide let go : ${lifted}`)
		// a double tap : two taps well inside the 350 ms (the box read once, no query between)
		const r = await f.rect('slide')
		await f.down(3, r.cx, r.cy)
		await sleep(50)
		await f.up(3)
		await sleep(50)
		await f.down(3, r.cx, r.cy)
		await sleep(50)
		await f.up(3)
		await sleep(300)
		const after = await ctx.js("return document.getElementById('ctr-touch')?.dataset.slide")
		await f.all()
		if (after !== 'idle') throw new Error(`a double tap did not let go : ${after}`)
		return 'R in a slide 0.5 s : held · the boost\'s moment lit R · thumb lifted : still held · double tap : let go'
	})

	await ctx.scenario('TOUCH-PAD-HIDES', async () => {
		await onPhone(ctx, 'menu', {}, { kind: 'menu' })
		await ctx.pad(0).press('cross')
		await sleep(600)
		const hidden = await touchState(ctx)
		if (hidden) throw new Error(`a pad connected, the controls still drawn : ${JSON.stringify(hidden)}`)
		const f = fingers(ctx)
		await f.down(1, 400, 200)
		await f.all()
		await sleep(400)
		const back = await touchState(ctx)
		if (!back) throw new Error('a touch did not bring the controls back')
		return `pad : hidden · a touch : ${back.kind}`
	})
}
