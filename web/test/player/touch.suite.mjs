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
//
// RUN : the player harness (CLAUDE.md § Tests) on touch.suite.mjs, --url http://localhost:8093/index.html
// Not a node --test file.

import { drive } from '../../ui/src/lib/autopilot.js'
import { IPHONE_MINI, PLAYER, fingers, phone, say, shot, startAt, state, touchState, turbo, until } from './ctr.mjs'

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
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const TT = { race: 'crash-cove', char: 'crash', mode: 'tt' }

/** The touch settings (lib/settings.js keys) set before the page loads ; null removes one. */
async function touchSettings(ctx, s) {
	const keys = { touchMode: 'ctr-ui.touch-mode', touchLayout: 'ctr-ui.touch-layout', touchHold: 'ctr-ui.touch-hold', touchHoldMs: 'ctr-ui.touch-hold-ms' }
	const set = {}
	for (const k in keys) set[keys[k]] = k in s ? s[k] : null
	await ctx.js(`const s = ${JSON.stringify(set)}; for (const k in s) { if (s[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, String(s[k])) } return true`)
}

/** The page on the phone, at `at` (startAt's), with these touch settings ; waits for the controls. */
async function onPhone(ctx, at, s = {}, { kind = null, turbo: fast = false } = {}) {
	await phone(ctx, IPHONE_MINI)
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
		await onPhone(ctx, TT, { touchHold: 0, touchLayout: 'a' }, { kind: 'a' })
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
