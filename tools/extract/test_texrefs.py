import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import texrefs  # noqa: E402
import view_maps  # noqa: E402

BAND = (0, 472, 512, 40)
DEST = (0, 216, 512, 40)


def layout(page_x, page_y, clut_x, clut_y, u=0, v=0, w=16, h=16, depth=0):
	"""A TextureLayout (four corners, CLUT, tpage) as the game stores it."""
	clut = (clut_x // 16) | (clut_y << 6)
	tpage = (page_x // 64) | ((page_y // 256) << 4) | (depth << 7)
	return struct.pack("<BBHBBHBBBB", u, v, clut, u + w - 1, v, tpage, u, v + h - 1, u + w - 1, v + h - 1)


class Blob:
	"""Data with a pointer map, laid out as it is appended ; `ptr` records a pointer word."""

	def __init__(self):
		self.data = bytearray()
		self.ptrs = []

	def at(self):
		return len(self.data)

	def put(self, b):
		off = len(self.data)
		self.data += b
		return off

	def ptr(self, target):
		self.ptrs.append(len(self.data))
		return self.put(struct.pack("<I", target))

	def word(self, v):
		return self.put(struct.pack("<I", v))

	def patch_ptr(self, off, target):
		self.ptrs.append(off)
		struct.pack_into("<I", self.data, off, target)

	def file(self):
		"""The entry as the BIGFILE holds it : map offset, data, map."""
		return struct.pack("<i", len(self.data)) + bytes(self.data) + struct.pack("<i", 4 * len(self.ptrs)) + b"".join(struct.pack("<i", p) for p in self.ptrs)


def pack():
	"""A model pack : two icons in the band, one model with two textures (one in the band's
	texels, one with only its CLUT there) and an animated frame, a decoy layout no pointer reaches.
	Returns (entry bytes, {name: data offset of the layout})."""
	b = Blob()
	where = {}
	lookup_at = b.ptr(0)  # word 0 : LevTexLookup, filled below
	models_at = b.ptr(0)  # one model
	b.word(0)  # end of the model list
	icons = b.at()
	for i in range(2):
		b.put(f"icon{i}".encode().ljust(16, b"\0") + struct.pack("<i", i))
		where[f"icon{i}"] = b.put(layout(0, 256, 32 * i, 480 + i, v=216 + 8 * i, h=8))
	lookup = b.word(2)
	b.ptr(icons)
	b.word(0)
	b.word(0)
	b.patch_ptr(lookup_at, lookup)
	where["decoy"] = b.put(layout(0, 256, 0, 500, v=220, h=8))
	where["tex1"] = b.put(layout(64, 256, 64, 490, v=230, h=10))
	where["tex2"] = b.put(layout(896, 0, 96, 500, v=0, h=32))
	where["frame"] = b.put(layout(128, 256, 0, 495, v=240, h=8))
	where["unmapped"] = b.put(layout(192, 256, 16, 499, v=240, h=8))
	table = b.ptr(where["tex1"])
	b.ptr(where["tex2"])
	b.word(where["unmapped"])  # an offset the map does not list : not a pointer
	cmds = b.word(3)
	b.word(0x80010002)  # draws texture 2
	b.word(0x00000001)  # colour only : its low bits are no texture index
	b.word(0xFFFFFFFF)
	anim = b.at()
	b.put(struct.pack("<IhhhH", 0, 1, 0, 0, 0))
	b.ptr(where["frame"])
	b.ptr(anim)  # the chain's end : a word pointing back at the first AnimTex
	struct.pack_into("<I", b.data, anim, table)  # ptrActiveTex
	b.ptrs.append(anim)
	headers = b.put(b"m_hi".ljust(16, b"\0") + bytes(0x30))
	b.patch_ptr(headers + 0x20, cmds)
	b.patch_ptr(headers + 0x28, table)
	b.patch_ptr(headers + 0x3C, anim)
	model = b.put(b"m".ljust(16, b"\0") + struct.pack("<hh", 0, 1))
	b.ptr(headers)
	b.patch_ptr(models_at, model)
	return b.file(), where


def vrm_pack(rects):
	out = struct.pack("<I", 0x20)
	for x, y, w, h in rects:
		block = struct.pack("<I", 0x10) + bytes(8) + struct.pack("<hhhh", x, y, w, h) + bytes(w * h * 2)
		out += struct.pack("<I", len(block)) + block
	return out + struct.pack("<I", 0)


class WalkTest(unittest.TestCase):
	def test_pack_walk_follows_the_structures_only(self):
		entry, where = pack()
		body, ptrs = texrefs.dram(entry)
		refs = texrefs.refs(body, "pack", ptrs)
		self.assertEqual(sorted(refs), sorted(where[k] for k in ("icon0", "icon1", "tex1", "tex2", "frame")))
		self.assertEqual(refs[where["icon1"]], "pack icon 1")
		self.assertEqual(refs[where["tex2"]], "pack model 0 header 0 texture 1")
		self.assertEqual(refs[where["frame"]], "pack model 0 header 0 anim 0 frame 0")

	def test_level_quad_mosaic_slot_is_a_pointer(self):
		"""An IconGroup4's fourth slot : a pointer the map lists (the mosaic array, walked up to the
		next pointer target), else a layout."""
		b = Blob()
		b.put(bytes(0xE0))  # the Level header
		group = b.put(layout(512, 0, 0, 300) * 3 + bytes(12))
		group2 = b.put(layout(576, 0, 0, 301) * 4)  # its fourth slot is a layout
		mosaic = b.put(layout(640, 0, 0, 302) * 2)
		b.patch_ptr(group + 36, mosaic)
		quad = b.put(bytes(0x5c))
		b.patch_ptr(quad + 0x1C, group)
		b.patch_ptr(quad + 0x20, group2)
		mesh = b.put(struct.pack("<iiiI", 1, 0, 0, 0) + bytes(16))
		b.patch_ptr(mesh + 0xC, quad)
		b.patch_ptr(0, mesh)
		body, ptrs = texrefs.dram(b.file())
		refs = texrefs.refs(body, "level", ptrs)
		self.assertNotIn(group + 36, refs)
		self.assertEqual(refs[mosaic + 12], "level quad 0 mid 0 mosaic 1")
		self.assertEqual(refs[group2 + 36], "level quad 0 mid 1 lod 3")
		self.assertEqual(len(refs), 3 + 4 + 2)

	def test_split_level_reads_its_map_from_the_next_entry(self):
		data = struct.pack("<I", 0x80000008) + struct.pack("<II", 4, 0)
		mapping = struct.pack("<ii", 4, 0)
		body, ptrs = texrefs.dram(data, mapping)
		self.assertEqual((body, ptrs), (struct.pack("<II", 4, 0), {0}))
		self.assertIsNone(texrefs.dram(data))

	def test_in_rect(self):
		data = layout(0, 256, 32, 480, v=216, h=8) + layout(896, 0, 64, 500, h=8) + layout(0, 256, 0, 480, v=216, h=1) + layout(0, 256, 0, 400, v=200, h=30)
		self.assertEqual(texrefs.in_rect(data, 0, BAND), (True, True))
		self.assertEqual(texrefs.in_rect(data, 12, BAND), (False, True))
		self.assertEqual(texrefs.in_rect(data, 24, BAND), (True, True))  # one row : a model triangle along it still draws
		self.assertEqual(texrefs.in_rect(data, 36, BAND), (False, False))  # starts above the band

	def test_band_patches_move_pages_and_cluts_only(self):
		entry, where = pack()
		body, ptrs = texrefs.dram(entry)
		refs = texrefs.refs(body, "pack", ptrs)
		hits = []
		for off, path in sorted(refs.items()):
			t, p = texrefs.in_rect(body, off, BAND)
			if t or p:
				hits.append((path, t, p, 4 + off))
		vrm = vrm_pack([(896, 0, 128, 256), BAND])
		rows = [{"index": 7, "vrm": [], "refs": {BAND: hits}},
			{"index": 3, "vrm": [(896, 0, 128, 256), BAND], "vrm_at": texrefs.vrm_rect_offsets(vrm), "refs": {}}]
		patches = texrefs.band_patches(rows, BAND)
		moved = texrefs.apply_patches(entry, patches[7])
		for name, (page_y, clut_y) in {"icon0": (0, 224), "tex1": (0, 234), "tex2": (0, 244), "frame": (0, 239)}.items():
			off = 4 + where[name]
			before, after = struct.unpack_from("<BBHBBH", entry, off), struct.unpack_from("<BBHBBH", moved, off)
			self.assertEqual((after[2] >> 6) & 0x1FF, clut_y, name)
			self.assertEqual(after[2] & 0x3F, before[2] & 0x3F, name)
			self.assertEqual(after[0:2] + after[3:5], before[0:2] + before[3:5], name)  # u / v unchanged
			if name != "tex2":
				self.assertEqual(after[5], before[5] & ~0x10, name)
			else:
				self.assertEqual(after[5], before[5], name)  # its texels are not in the band
		self.assertEqual(moved[4 + where["decoy"]:4 + where["decoy"] + 12], entry[4 + where["decoy"]:4 + where["decoy"] + 12])
		self.assertEqual([r[:4] for r in __import__("vrm").parse(texrefs.apply_patches(vrm, patches[3]))], [(896, 0, 128, 256), DEST])

	def test_band_stream_round_trip(self):
		patches = {5: [(3, 0), (6, 1), (300, 0)], 9: [(0x12345, 2)]}
		entries, stream = view_maps.band_stream(patches)
		decoded = {}
		for index, count, start in entries:
			pos, off, out = start, 0, []
			for _ in range(count):
				v, shift = 0, 0
				while True:
					v |= (stream[pos] & 0x7F) << shift
					shift += 7
					pos += 1
					if not stream[pos - 1] & 0x80:
						break
				off += v >> 2
				out.append((off, v & 3))
			decoded[index] = out
		self.assertEqual(decoded, patches)


def disc_rows(band, extra_vrm=(), extra_refs=None, band_reads=True):
	shared = [(896, 0, 128, 256), band]
	rows = [{"index": 0, "name": texrefs.SHARED_VRM, "us_index": 0, "kind": "vrm", "vrm": shared, "refs": {}},
		{"index": 1, "name": "BI_1PARCADEPACK+0", "us_index": 1, "kind": "refs", "vrm": [], "layouts": 3,
			"refs": {band: [("pack icon 0", True, True, 4)] if band_reads else [], (896, 0, 128, 256): [("pack model 0 header 0 texture 0", False, True, 16)]}}]
	if extra_refs:
		rows[1]["refs"].update(extra_refs)
	for i, rect in enumerate(extra_vrm):
		rows.append({"index": 2 + i, "name": f"BI_ARCADETRACKS+{i}", "us_index": 2 + i, "kind": "vrm", "vrm": [rect], "refs": {}})
	return rows


class ProveTest(unittest.TestCase):
	def test_holds(self):
		problems, summary = texrefs.prove(disc_rows((0, 216, 512, 48)), disc_rows(BAND), lambda u: True)
		self.assertEqual(problems, [])
		self.assertEqual(summary["BI_1PARCADEPACK"]["band"], [1, 1])

	def test_refuses_a_destination_in_use(self):
		problems, _ = texrefs.prove(disc_rows((0, 216, 512, 48)), disc_rows(BAND, extra_vrm=[(0, 230, 64, 8)]), lambda u: True)
		self.assertTrue(any("over the destination" in p for p in problems))
		problems, _ = texrefs.prove(disc_rows((0, 216, 512, 48)), disc_rows(BAND, extra_refs={DEST: [("pack icon 9", True, False, 40)]}), lambda u: True)
		self.assertTrue(any("reads the destination" in p for p in problems))

	def test_refuses_a_layout_touching_the_band_unmoved(self):
		pal = disc_rows(BAND)
		pal[1]["near"] = {BAND: 2}  # one more layout than the band reads : straddling its edge
		problems, _ = texrefs.prove(disc_rows((0, 216, 512, 48)), pal, lambda u: True)
		self.assertTrue(any("touch the band" in p for p in problems))
		data = layout(0, 256, 0, 100, v=200, h=40)  # rows 456-495 : across the band's top
		self.assertTrue(texrefs.touches(data, 0, BAND))
		self.assertEqual(texrefs.in_rect(data, 0, BAND), (False, False))

	def test_refuses_band_reads_on_one_disc_only(self):
		problems, _ = texrefs.prove(disc_rows((0, 216, 512, 48)), disc_rows(BAND, band_reads=False), lambda u: True)
		self.assertTrue(any("band reads" in p for p in problems))
		self.assertTrue(any("other structures" in p for p in problems))


if __name__ == "__main__":
	unittest.main()
