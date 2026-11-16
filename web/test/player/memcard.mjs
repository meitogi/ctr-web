// Memory card images for the tests (session 45b) : the game's card on the web is one file per save
// (platform/native_memcard.c, /memcards/slot0/<name> : the PS1 save's title frame and one icon
// frame, 0x100 bytes, then its data), a real PS1 card or an emulator's is one 128 KB image (.mcr,
// .mcd : the same raw format). These two cut one into the other, so the user's own saves can be
// played by the tests (ctr.mjs importSave) and a card the game wrote can be opened by an emulator.
// No side effects : `node --test` imports it (web/test/memcard.test.js).
//
// The raw PS1 card : 16 blocks of 8 KB. Block 0 is its directory — frame 0 the header (« MC »),
// frames 1–15 one per data block : state (0x51 a file's first block, 0x52 a middle one, 0x53 its
// last, 0xA0 free), the file's size in bytes, the next block (0xFFFF : the end), its name (20
// bytes), an XOR checksum in the frame's last byte. Blocks 1–15 hold the files : the title frame
// (its byte 2 : 0x11 / 0x12 / 0x13, how many icon frames follow), the icon frames, the data.

export const CARD_SIZE = 128 * 1024
export const BLOCK = 0x2000
export const FRAME = 0x80
/** The native file's header : the title frame and one icon frame (native_memcard_adapter.c). */
export const NATIVE_HEADER = 0x100

/** CTR's saves (game/zGlobal_DATA.c) and the size of their data (game/RefreshCard.c). */
export const CTR_PROFILE = 'BASCUS-94426-SLOTS'
export const CTR_GHOST = /^BASCUS-94426G/
export function ctrDataSize(name) {
	if (name === CTR_PROFILE) return 0x1680
	if (CTR_GHOST.test(name)) return 0x3e00
	return null
}

const checksum = (frame) => {
	let x = 0
	for (let i = 0; i < FRAME - 1; i++) x ^= frame[i]
	return x
}

/**
 * The CTR saves of a raw card image (Buffer / Uint8Array of 128 KB) as the web build keeps them :
 * { name: Uint8Array (0x100 header + data) } ; other games' saves are skipped, listed in `others`.
 */
export function splitCardImage(image) {
	const card = Uint8Array.from(image)
	if (card.length !== CARD_SIZE) throw new Error(`a card image is ${CARD_SIZE} bytes, not ${card.length}`)
	if (card[0] !== 0x4d || card[1] !== 0x43) throw new Error('not a PS1 memory card image (no « MC » header)')
	const view = new DataView(card.buffer)
	const files = {}
	const others = []
	for (let slot = 1; slot < 16; slot++) {
		const at = slot * FRAME
		if (card[at] !== 0x51) continue
		const size = view.getUint32(at + 4, true)
		let name = ''
		for (let i = 0; i < 20 && card[at + 0x0a + i]; i++) name += String.fromCharCode(card[at + 0x0a + i])
		const bytes = new Uint8Array(Math.ceil(size / BLOCK) * BLOCK)
		let block = slot
		for (let n = 0; block !== 0xffff && n < 15; n++) {
			bytes.set(card.subarray(block * BLOCK, (block + 1) * BLOCK), n * BLOCK)
			const next = view.getUint16(block * FRAME + 8, true)
			block = next === 0xffff ? 0xffff : next + 1
		}
		const data = ctrDataSize(name)
		if (data == null) {
			others.push(name)
			continue
		}
		// the title frame's icon count : 0x11 one frame, 0x12 two, 0x13 three
		const icons = Math.max(1, Math.min(3, bytes[2] - 0x10))
		const from = FRAME * (1 + icons)
		if (from + data > bytes.length) throw new Error(`${name} : ${size} bytes on the card, too short for its data`)
		const file = new Uint8Array(NATIVE_HEADER + data)
		file.set(bytes.subarray(0, NATIVE_HEADER))
		file[2] = 0x11
		file.set(bytes.subarray(from, from + data), NATIVE_HEADER)
		files[name] = file
	}
	return { files, others }
}

/** A raw 128 KB card image (Uint8Array) holding `files` ({ name: native file }), as a PS1 card lays them. */
export function cardImage(files) {
	const card = new Uint8Array(CARD_SIZE)
	const view = new DataView(card.buffer)
	card[0] = 0x4d
	card[1] = 0x43
	card[FRAME - 1] = checksum(card)
	for (let slot = 1; slot < 16; slot++) {
		const at = slot * FRAME
		card[at] = 0xa0
		view.setUint16(at + 8, 0xffff, true)
		card[at + FRAME - 1] = checksum(card.subarray(at, at + FRAME))
	}
	let free = 1
	for (const name in files) {
		const bytes = files[name]
		const blocks = Math.ceil(bytes.length / BLOCK)
		if (free + blocks > 16) throw new Error(`the card is full : ${name} needs ${blocks} blocks`)
		for (let n = 0; n < blocks; n++) {
			const slot = free + n
			const at = slot * FRAME
			card.fill(0, at, at + FRAME)
			card[at] = n === 0 ? 0x51 : n === blocks - 1 ? 0x53 : 0x52
			if (n === 0) {
				view.setUint32(at + 4, blocks * BLOCK, true)
				for (let i = 0; i < name.length && i < 20; i++) card[at + 0x0a + i] = name.charCodeAt(i)
			}
			view.setUint16(at + 8, n === blocks - 1 ? 0xffff : slot, true)
			card[at + FRAME - 1] = checksum(card.subarray(at, at + FRAME))
			card.set(bytes.subarray(n * BLOCK, (n + 1) * BLOCK), slot * BLOCK)
		}
		free += blocks
	}
	return card
}
