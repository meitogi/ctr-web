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
//                      auto boost giving reserves ; the stick centred ends it ; swipe down = brake
//   TOUCH-SLIDE-HOLD   layout D : a slide (R with the stick turned, at speed) held 0.5 s holds
//                      itself — the game's « sliding » reaches the page —, R lights up at the boost's
//                      moment (the game's red meter), stays held with the thumb
//                      lifted, a double tap on R lets it go
//
// RUN : the player harness (CLAUDE.md § Tests) on touch.suite.mjs, --url http://localhost:8093/index.html
// Not a node --test file.

import { drive } from '../../ui/src/lib/autopilot.js'
import { IPHONE_MINI, PLAYER, onMainMenu, fingers, phone, say, shot, startAt, state, touchState, turbo, until } from './ctr.mjs'

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
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const TT = { race: 'crash-cove', char: 'crash', mode: 'tt' }

/** The touch settings (lib/settings.js keys) set before the page loads ; null removes one. */
async function touchSettings(ctx, s) {
	const keys = { touchMode: 'ctr-ui.touch-mode', touchLayout: 'ctr-ui.touch-layout', touchHold: 'ctr-ui.touch-hold', touchHoldMs: 'ctr-ui.touch-hold-ms', touchRetapMs: 'ctr-ui.touch-retap-ms' }
	const set = {}
	for (const k in keys) set[keys[k]] = k in s ? s[k] : null
	await ctx.js(`const s = ${JSON.stringify(set)}; for (const k in s) { if (s[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, String(s[k])) } return true`)
}

/** The page on the phone, at `at` (startAt's), with these touch settings ; waits for the controls. */
async function onPhone(ctx, at, s = {}, { kind = null, turbo: fast = false } = {}) {
	await phone(ctx, IPHONE_MINI)
	// no finger left down from a scenario before (the browser keeps its touch points across loads)
	await ctx.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, ctx.sid).catch(() => {})
	await touchSettings(ctx, s)
	await startAt(ctx, at, { turbo: fast })
	const end = Date.now() + 10_000
	let t = null
	while (Date.now() < end && !((t = await touchState(ctx)) && (!kind || t.kind === kind))) await sleep(150)
	if (!t || (kind && t.kind !== kind)) throw new Error(`the touch controls : ${JSON.stringify(t)} (wanted ${kind ?? 'any'})`)
	return t
}

const kart = async ctx => (await state(ctx))?.kart ?? null

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
		const race = await onPhone(ctx, TT, {}, { kind: 'a' })
		await shot(ctx, 'race-a')
		return `desktop : none · menu : ${menu.ids.join(' ')} · race (A) : ${race.ids.join(' ')}`
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
		await ctx.js("const t = Module.ctrInput.touch; window.__sl = { slide: 0, last: 0 }; Module.ctrInput.touch = (h, d, r, s, red, rev) => { if (s) __sl.slide++; __sl.last = s ? 1 : 0; return t(h, d, r, s, red, rev) }; return true")
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
		await f.move(1, x, y)
		await sleep(700)
		const after = await ctx.js('return { ...window.__sl }')
		await f.up(1)
		await f.down(2, rx, ry)
		await f.move(2, rx, ry + 45)
		await sleep(400)
		const braking = await kart(ctx)
		await f.all()
		if (during.slide < 5) throw new Error(`a tap turning : no slide (${JSON.stringify(during)})`)
		if (after.last) throw new Error('the stick centred, the slide went on')
		if (braking.cross) throw new Error('swipe down : Cross still held')
		return `GO held by itself · a tap turning : the game slid ${during.slide} pulls, reserves up to ${best} (the auto boost) · the stick centred : ended · swipe down : the brake`
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
