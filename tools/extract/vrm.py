"""VRM files : rectangles of PS1 VRAM (16-bit words) the game uploads with LoadImage.

`game/LOAD/LOAD_File.c` LOAD_VramFileCallback : either one TIM-like block (0xC bytes of header,
a RECT, the pixels) or a pack (u32 0x20, then per block its byte length and the block, until a
0 length).

Textures sit in VRAM as 4-bit or 8-bit indices with a CLUT, or 16-bit direct : the raw view
shows a rect's words as 5551 colours ; per-texture PNGs need the texture page and CLUT of a
named `Icon` (`include/namespace_Decal.h`) found in the file paired with the VRM.
"""

import re
import struct

VRAM_W, VRAM_H = 1024, 512
_HEADER = 0xC  # VramHeader.data
_NAME = re.compile(rb"[A-Za-z0-9_\-]{2,15}\x00")


def _block(data, pos):
	x, y, w, h = struct.unpack_from("<hhhh", data, pos + _HEADER)
	start = pos + _HEADER + 8
	size = w * h * 2
	if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > VRAM_W or y + h > VRAM_H or start + size > len(data):
		raise ValueError(f"bad VRAM rect {x},{y} {w}x{h} at {pos}")
	return (x, y, w, h, data[start:start + size])


def parse(data):
	"""[(x, y, w, h, pixels)] ; raises ValueError when `data` is not a VRM."""
	if len(data) < 0x14:
		raise ValueError("too short for a VRM")
	first = struct.unpack_from("<I", data, 0)[0]
	if first != 0x20:
		if first != 0x10:  # TIM tag
			raise ValueError("no VRM tag")
		return [_block(data, 0)]
	out = []
	pos = 4
	while pos + 4 <= len(data):
		size = struct.unpack_from("<I", data, pos)[0]
		pos += 4
		if size == 0:
			break
		if struct.unpack_from("<I", data, pos)[0] != 0x10:
			raise ValueError(f"packed block at {pos} has no TIM tag")
		out.append(_block(data, pos))
		pos += size
	if not out:
		raise ValueError("empty VRM pack")
	return out


def rgba_5551(words):
	"""RGBA bytes of little-endian 16-bit PS1 colours ; 0x0000 is transparent."""
	out = bytearray(len(words) * 2)
	for i in range(0, len(words), 2):
		c = words[i] | (words[i + 1] << 8)
		o = i * 2
		out[o] = (c & 31) * 255 // 31
		out[o + 1] = ((c >> 5) & 31) * 255 // 31
		out[o + 2] = ((c >> 10) & 31) * 255 // 31
		out[o + 3] = 0 if c == 0 else 255
	return bytes(out)


class Vram:
	"""A 1024x512 VRAM image built from VRM rects ; `covered` says which words were written."""

	def __init__(self):
		self.words = bytearray(VRAM_W * VRAM_H * 2)
		self.covered = bytearray(VRAM_W * VRAM_H)

	def load(self, rects):
		for x, y, w, h, pix in rects:
			for row in range(h):
				o = ((y + row) * VRAM_W + x)
				self.words[o * 2:(o + w) * 2] = pix[row * w * 2:(row + 1) * w * 2]
				self.covered[o:o + w] = b"\x01" * w

	def word(self, x, y):
		o = (y * VRAM_W + x) * 2
		return self.words[o] | (self.words[o + 1] << 8)

	def is_covered(self, x, y, w, h):
		for row in range(y, y + h):
			if row >= VRAM_H or x + w > VRAM_W or 0 in self.covered[row * VRAM_W + x:row * VRAM_W + x + w]:
				return False
		return True

	def texture(self, tpage, clut, u, v, w, h):
		"""RGBA of a w x h texture at (u, v) of texture page `tpage` with `clut`, or None
		when its pixels or CLUT are not in the loaded rects."""
		px, py = (tpage & 0xF) * 64, ((tpage >> 4) & 1) * 256
		depth = (tpage >> 7) & 3
		cx, cy = (clut & 0x3F) * 16, (clut >> 6) & 0x1FF
		per_word = {0: 4, 1: 2, 2: 1}.get(depth)
		if per_word is None:
			return None
		if not self.is_covered(px + u // per_word, py + v, (u + w + per_word - 1) // per_word - u // per_word, h):
			return None
		if per_word > 1 and not self.is_covered(cx, cy, 16 if depth == 0 else 256, 1):
			return None
		out = bytearray()
		for y in range(v, v + h):
			for x in range(u, u + w):
				word = self.word(px + x // per_word, py + y)
				if depth == 0:
					c = self.word(cx + ((word >> ((x & 3) * 4)) & 0xF), cy)
				elif depth == 1:
					c = self.word(cx + ((word >> ((x & 1) * 8)) & 0xFF), cy)
				else:
					c = word
				out += rgba_5551(bytes((c & 0xFF, c >> 8)))
		return bytes(out)


def find_icons(data):
	"""Named icons in a data file : [(offset, name, tpage, clut, u, v, w, h)].

	An `Icon` is name[16], an int, then a TextureLayout of four corners ; only axis-aligned
	records with a clean name are taken (the false-positive guard)."""
	out = []
	for m in _NAME.finditer(data):
		off = m.start()
		if off % 4 or off + 0x20 > len(data):
			continue
		if any(data[off + len(m.group(0)):off + 16]):
			continue  # name padding must be zeros
		u0, v0, clut, u1, v1, tpage, u2, v2, u3, v3 = struct.unpack_from("<BBHBBHBBBB", data, off + 0x14)
		if not (u0 == u2 and u1 == u3 and v0 == v1 and v2 == v3 and u1 > u0 and v2 > v0):
			continue
		if tpage & ~0x1FF or (tpage >> 7) & 3 == 3:
			continue
		out.append((off, m.group(0)[:-1].decode("ascii"), tpage, clut, u0, v0, u1 - u0 + 1, v2 - v0 + 1))
	return out
