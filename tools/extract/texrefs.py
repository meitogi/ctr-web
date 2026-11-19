"""Texture references of BIGFILE entries : every TextureLayout an entry holds, found by walking
the game's structures, never by byte pattern ; and the byte patches that move a VRAM band.

A TextureLayout (`include/namespace_Decal.h`) is 12 bytes : four u/v corners, a CLUT word
(x / 16 in bits 0-5, y in bits 6-14) and a texture page word (x / 64 in bits 0-3, y / 256 in bit
4, depth in bits 7-8). The walk follows the decomp's loader and renderers :

- an entry read with a pointer map (`LOAD_DramFileCallback`, `game/LOAD/LOAD_File.c`) : a u32
  map offset, the data, then the map (byte count, offsets of the pointer words). A level read in
  two parts (`LOAD_Callback_PatchMem`) has a negative first word ; its map is the next entry.
  Pointers are offsets into the data ; a field is followed only when the map lists it.
- `Model` (`include/namespace_Instance.h`) : its headers ; each `ModelHeader.ptrTexLayout` has
  as many entries as the largest texture index of its command list (`command & 0x1ff`,
  `RenderBucket_GetCommandTexture`) ; its `AnimTex` chain's frames are TextureLayouts
  (`CTR_CycleTex_Model`).
- a model pack (`LOAD_TenStages.c` stage 5) : word 0 a `LevTexLookup`, then Model pointers up
  to a null one.
- `Level` (`include/namespace_Level.h`) : `levTexLookup` (icons, icon groups),
  `ptr_named_tex_array`, `ptr_tex_waterEnvMap`, `ptr_anim_tex` (frames are `IconGroup4`), each
  quadblock's `ptr_texture_mid[4]` (an `IconGroup4`, or an AnimTex when bit 0 is set) and
  `ptr_texture_low`, the level's models.

    python3 -I tools/extract/texrefs.py <out> <x,y,w,h> [report.json]

lists, for an extraction (`extract.py`'s <out>), the structures of each entry that read inside
the VRAM rect.
"""

import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling modules under `python3 -I`

import vrm  # noqa: E402

LAYOUT = 12
ICON = 0x20
ICON_LAYOUT = 0x14
MODEL_HEADER = 0x40
QUADBLOCK = 0x5c
DRAM_HEADER = 4

MODEL_CATEGORIES = {"BI_RACERMODELHI", "BI_RACERMODELMED", "BI_RACERMODELLOW", "BI_DANCEMODELWIN", "BI_DANCEMODELLOSE",
	"BI_DANCETAWNAGIRL", "BI_UKAHEAD", "BI_AKUHEAD", "BI_DINGOFIRE", "BI_PODIUM", "BI_BOSSHEAD", "BI_LOSEHEAD", "BI_BOSSBODY"}
PACK_CATEGORIES = {"BI_SHAREDMPKVRM", "BI_1PARCADEPACK", "BI_ADVENTUREPACK", "BI_TIMETRIALPACK", "BI_2PARCADEPACK", "BI_4PARCADEPACK"}
LEVEL_CATEGORIES = {"BI_ARCADETRACKS", "BI_BATTLETRACKS", "BI_ADVENTUREHUB", "BI_MAINMENUFILE", "BI_NDBOX", "BI_CUTSCENES_INTRO",
	"BI_CUTSCENES_OUTRO", "BI_CREDITS", "BI_SCRAPBOOK"}
# Entries with no structure the walk knows, and why none can hold a TextureLayout the US
# executable draws.
UNWALKED = {
	"BI_MAINMENUFILE+4": "the Japanese font's VRM : no MAIN_MENU_LEVEL / ADVENTURE_GARAGE index reaches it (LOAD_Assets.c)",
	"BI_MAINMENUFILE+5": "the Japanese font's icons : idem",
	"BI_OVERLAYSECT1": "overlay code, never loaded natively (LOAD_Overlays.c)",
	"BI_OVERLAYSECT2": "idem",
	"BI_OVERLAYSECT3": "idem",
	"BI_LANGUAGEFILE": "text",
	"BI_VLCTABLE": "the video decoder's table",
	"BI_THUMBS": "images read whole into VRAM, no pointer map",
}

# One byte decremented per moved field, so a patch never straddles a sector : the CLUT word's
# high byte (y in bits 6-14 : 256 rows = 0x40 there), the tpage word's low byte (bit 4, the page
# row) and a VRM rect's y high byte.
PATCH_CLUT, PATCH_TPAGE, PATCH_RECT_Y = 0, 1, 2
PATCH_DELTA = {PATCH_CLUT: 0x40, PATCH_TPAGE: 0x10, PATCH_RECT_Y: 0x01}


class Problem(ValueError):
	pass


def dram(data, next_entry=None):
	"""(data, pointer offsets) of an entry the game reads with a pointer map, or None.

	`next_entry` : the following BIGFILE entry, the map of a level read in two parts."""
	if len(data) < 8:
		return None
	head = struct.unpack_from("<i", data, 0)[0]
	if head >= 0:
		end = DRAM_HEADER + head
		if end + 4 > len(data):
			return None
		count = struct.unpack_from("<i", data, end)[0]
		if count < 0 or count % 4 or end + 4 + count > len(data):
			return None
		return data[DRAM_HEADER:end], set(struct.unpack_from(f"<{count // 4}i", data, end + 4))
	size = head & 0x7FFFFFFF
	if next_entry is None or DRAM_HEADER + size > len(data) or len(next_entry) < 4:
		return None
	count = struct.unpack_from("<i", next_entry, 0)[0]
	if count < 0 or count % 4 or 4 + count > len(next_entry):
		return None
	return data[DRAM_HEADER:DRAM_HEADER + size], set(struct.unpack_from(f"<{count // 4}i", next_entry, 4))


class Walker:
	def __init__(self, data, ptrs):
		self.data = data
		self.ptrs = {p & ~3 for p in ptrs}
		self.out = {}  # data offset -> structure path (the first one that reaches it)
		self.mosaic_at = {}  # mosaic array offset -> path

	def u32(self, off):
		return struct.unpack_from("<I", self.data, off)[0]

	def s16(self, off):
		return struct.unpack_from("<h", self.data, off)[0]

	def ptr(self, off):
		"""The pointer at `off`, or None when the map has no pointer there."""
		if off not in self.ptrs:
			return None
		p = self.u32(off)
		if p >= len(self.data):
			raise Problem(f"pointer at {off:#x} to {p:#x}, past the data ({len(self.data):#x})")
		return p

	def layout(self, off, path):
		if off is None:
			return
		if off + LAYOUT > len(self.data):
			raise Problem(f"{path} at {off:#x} past the data")
		self.out.setdefault(off, path)

	def tex_lookup(self, off, path):
		num_icon, num_group = self.u32(off), self.u32(off + 8)
		first = self.ptr(off + 4)
		for i in range(num_icon if first is not None else 0):
			self.layout(first + i * ICON + ICON_LAYOUT, f"{path} icon {i}")
		groups = self.ptr(off + 12)
		for g in range(num_group if groups is not None else 0):
			group = self.ptr(groups + 4 * g)
			if group is None:
				continue
			for i in range(self.s16(group + 0x12)):
				icon = self.ptr(group + 0x14 + 4 * i)
				if icon is not None:
					self.layout(icon + ICON_LAYOUT, f"{path} group {g} icon {i}")
		return first

	def anim_chain(self, first, frame, path):
		"""AnimTex list from `first` up to the entry whose first word points back at it ;
		`frame(target, path)` takes each frame."""
		cur, n = first, 0
		while self.u32(cur) != first:
			num = self.s16(cur + 4)
			if num <= 0 or n > 4096:
				raise Problem(f"AnimTex at {cur:#x} : {num} frames")
			for i in range(num):
				p = self.ptr(cur + 0xC + 4 * i)
				if p is not None:
					frame(p, f"{path} anim {n} frame {i}")
			cur += 0xC + 4 * num
			n += 1

	def model(self, off, path):
		headers = self.ptr(off + 0x14)
		count = self.s16(off + 0x12)
		if headers is None or not 0 < count < 64:
			raise Problem(f"{path} at {off:#x} : {count} headers")
		for h in range(count):
			mh = headers + h * MODEL_HEADER
			cmds, table = self.ptr(mh + 0x20), self.ptr(mh + 0x28)
			if cmds is not None and table is not None:
				n, pos = 0, cmds + 4
				while self.u32(pos) != 0xFFFFFFFF:
					c = self.u32(pos)
					if c >> 16:
						n = max(n, c & 0x1FF)
					pos += 4
				for i in range(n):
					self.layout(self.ptr(table + 4 * i), f"{path} header {h} texture {i}")
			anim = self.ptr(mh + 0x3C)
			if anim is not None:
				self.anim_chain(anim, self.layout, f"{path} header {h}")

	def pack(self):
		lookup = self.ptr(0)
		if lookup is not None:
			self.tex_lookup(lookup, "pack")
		pos, m = 4, 0
		while pos in self.ptrs:
			self.model(self.ptr(pos), f"pack model {m}")
			pos, m = pos + 4, m + 1
		if self.u32(pos) != 0:
			raise Problem(f"model list not null-terminated at {pos:#x}")

	def group4(self, off, path):
		"""An `IconGroup4` : far, middle, near ; its fourth slot is a layout, or (a pointer the map
		lists) the near quads' mosaic array (DrawLevelOvr1P's `texture + 0x24`), walked by
		`mosaics`."""
		for k in range(3):
			self.layout(off + k * LAYOUT, f"{path} lod {k}")
		mosaic = self.ptr(off + 3 * LAYOUT)
		if mosaic is None:
			self.layout(off + 3 * LAYOUT, f"{path} lod 3")
		else:
			self.mosaic_at.setdefault(mosaic, f"{path} mosaic")

	def mosaics(self):
		"""Each mosaic array : layouts up to the next pointer target (no count is stored ; the
		arrays seen hold 8, 16 or 32)."""
		targets = sorted({self.u32(p) for p in self.ptrs if self.u32(p) < len(self.data)} | set(self.mosaic_at))
		import bisect
		for at, path in self.mosaic_at.items():
			i = bisect.bisect_right(targets, at)
			end = min(targets[i] if i < len(targets) else len(self.data), at + 32 * LAYOUT)
			for k in range((end - at) // LAYOUT):
				self.layout(at + k * LAYOUT, f"{path} {k}")

	def level(self):
		lookup = self.ptr(0x3C)
		first = self.tex_lookup(lookup, "level") if lookup is not None else None
		named = self.ptr(0x40)
		if named is not None and named != first:
			i = 0
			while named + ICON <= len(self.data) and self.data[named] != 0:
				self.layout(named + ICON_LAYOUT, f"level named icon {i}")
				named, i = named + ICON, i + 1
		self.layout(self.ptr(0x44), "level water map")
		anim = self.ptr(0x08)
		if anim is not None:
			self.anim_chain(anim, self.group4, "level")
		mesh = self.ptr(0x00)
		quads = self.ptr(mesh + 0xC) if mesh is not None else None
		for q in range(self.u32(mesh) if quads is not None else 0):
			block = quads + q * QUADBLOCK
			for k in range(4):
				t = self.ptr(block + 0x1C + 4 * k)
				if t is not None and not t & 1:  # bit 0 : an AnimTex, walked above
					self.group4(t, f"level quad {q} mid {k}")
			self.layout(self.ptr(block + 0x40), f"level quad {q} low")
		models = self.ptr(0x18)
		for m in range(self.u32(0x14) if models is not None else 0):
			p = self.ptr(models + 4 * m)
			if p is not None:
				self.model(p, f"level model {m}")
		self.mosaics()


def kind(name):
	""""model", "pack", "level", or None for an entry named `BI_CATEGORY+k[_LANG]`."""
	category = name.split("+")[0]
	if category in MODEL_CATEGORIES:
		return "model"
	if category in PACK_CATEGORIES:
		return "pack"
	if category in LEVEL_CATEGORIES:
		return "level"
	return None


def refs(data, what, ptrs):
	"""{data offset: structure path} of every TextureLayout of a `what` ("model", "pack", "level")."""
	w = Walker(data, ptrs)
	if what == "model":
		w.model(0, "model")
	elif what == "pack":
		w.pack()
	else:
		w.level()
	return w.out


def in_rect(data, off, rect):
	"""(texels, palette) : whether the TextureLayout at `off` reads its texels (its page in the
	rect's columns, every v in its rows) and its CLUT (4 / 8-bit only) inside `rect` (x, y, w, h).
	A layout with no area still draws (a model's triangle along one row or column)."""
	rx, ry, rw, rh = rect
	v0, clut, v1, tpage, v2, v3 = struct.unpack_from("<xBHxBHxBxB", data, off)
	tx, ty = (tpage & 0xF) * 64, ((tpage >> 4) & 1) * 256
	cx, cy = (clut & 0x3F) * 16, (clut >> 6) & 0x1FF
	vs = (v0, v1, v2, v3)
	texels = rx <= tx < rx + rw and ry <= ty + min(vs) and ty + max(vs) < ry + rh
	palette = (tpage >> 7) & 3 < 2 and rx <= cx < rx + rw and ry <= cy < ry + rh
	return texels, palette


def touches(data, off, rect):
	"""Whether the TextureLayout at `off` comes near `rect` at all : any of its rows of texels in
	the rect's (page in its columns, its width counted, area or not), or its CLUT word in it,
	whatever the depth. `prove` requires every such layout on the moved band to be a full `in_rect`
	read, so a straddling or one-row layout cannot be left behind silently."""
	rx, ry, rw, rh = rect
	v0, clut, v1, tpage, v2, v3 = struct.unpack_from("<xBHxBHxBxB", data, off)
	tx, ty = (tpage & 0xF) * 64, ((tpage >> 4) & 1) * 256
	width = {0: 64, 1: 128}.get((tpage >> 7) & 3, 256)  # words a page spans at its depth
	cx, cy = (clut & 0x3F) * 16, (clut >> 6) & 0x1FF
	vs = (v0, v1, v2, v3)
	rows = ty + min(vs) < ry + rh and ry <= ty + max(vs)
	return (tx < rx + rw and rx < tx + width and rows) or (rx <= cx < rx + rw and ry <= cy < ry + rh)


def classify(name, data, next_data):
	"""("vrm", rects) | ("refs", {offset: path}, file offset of the data) | ("none", reason)."""
	try:
		return ("vrm", vrm.parse(data))
	except ValueError:
		pass
	base = name.rsplit("_", 1)[0] if name[-4:-3] == "_" else name  # a PAL language copy : BI_X+k_FRN
	for key, reason in UNWALKED.items():
		if base == key or base.split("+")[0] == key:
			return ("none", reason)
	if not data:
		return ("none", "empty")
	what = kind(name)
	split = dram(data, next_data)
	if what is None or split is None:
		if len(data) >= 4 and struct.unpack_from("<i", data, 0)[0] + 4 == len(data):
			return ("none", "the pointer map of the level before it")
		raise Problem(f"{name} : no structure known ({what}, map {'found' if split else 'not found'})")
	body, ptrs = split
	return ("refs", refs(body, what, ptrs), DRAM_HEADER)


def scan(bigfile_dir, index, rects):
	"""Per entry of an extraction's BIGFILE, what reads inside each of `rects` :
	[{index, name, kind, refs: {rect: [(path, texels, palette, file offset)]}, rects: [...]}]."""
	files = {}
	for f in os.listdir(bigfile_dir):
		if f.endswith(".bin"):
			files[int(f.split("_")[0])] = os.path.join(bigfile_dir, f)

	def read(i):
		if i not in files:
			return None
		with open(files[i], "rb") as fh:
			return fh.read()

	out = []
	data = read(0)
	for e in index["entries"]:
		i = e["index"]
		next_data = read(i + 1)
		c = classify(e["name"], data, next_data)
		row = {"index": i, "name": e["name"], "us_index": e.get("us_index", i), "kind": c[0], "refs": {}, "vrm": []}
		if c[0] == "vrm":
			row["vrm"] = [(x, y, w, h) for x, y, w, h, _ in c[1]]
			row["vrm_at"] = vrm_rect_offsets(data)
		elif c[0] == "refs":
			row["layouts"] = len(c[1])
			for rect in rects:
				hits = []
				for off, path in sorted(c[1].items()):
					t, p = in_rect(data, c[2] + off, rect)
					if t or p:
						hits.append((path, t, p, c[2] + off))
				row["refs"][rect] = hits
				row.setdefault("near", {})[rect] = sum(1 for off in c[1] if touches(data, c[2] + off, rect))
		else:
			row["reason"] = c[1]
		out.append(row)
		data = next_data
	return out


def vrm_rect_offsets(data):
	"""File offset of each rect's RECT in a VRM (the order of `vrm.parse`)."""
	if struct.unpack_from("<I", data, 0)[0] != 0x20:
		return [0xC]
	out, pos = [], 4
	while pos + 4 <= len(data):
		size = struct.unpack_from("<I", data, pos)[0]
		pos += 4
		if size == 0:
			break
		out.append(pos + 0xC)
		pos += size
	return out


def band_patches(rows, band):
	"""{entry index: [(file offset, PATCH_*)]} moving `band` (in the lower half of VRAM) up 256
	rows : its VRM rect, and in every entry the texels (tpage row) and CLUTs read inside it."""
	bx, by, bw, bh = band
	if by < 256 or by + bh > 512:
		raise ValueError("the band must sit in the lower half of VRAM")
	out = {}
	for row in rows:
		patches = [(at + 3, PATCH_RECT_Y) for rect, at in zip(row["vrm"], row.get("vrm_at", [])) if tuple(rect) == tuple(band)]
		for path, texels, palette, off in row["refs"].get(tuple(band), []):
			if palette:
				patches.append((off + 3, PATCH_CLUT))  # the CLUT word's high byte
			if texels:
				patches.append((off + 6, PATCH_TPAGE))  # the tpage word's low byte
		if patches:
			out[row["index"]] = sorted(patches)
	return out


SHARED_VRM = "BI_SHAREDMPKVRM+0"


def shared_rects(rows):
	"""The rects of the shared VRM (`BI_SHAREDMPKVRM`+0) ; the band is the one left of x 512."""
	for row in rows:
		if row["name"] == SHARED_VRM:
			return [tuple(r) for r in row["vrm"]]
	raise Problem(f"no {SHARED_VRM}")


def prove(us_rows, pal_rows, same_size):
	"""(problems, summary) of moving the PAL shared band onto the US one's rows.

	`*_rows` : `scan_discs` ; `same_size(us index)`
	whether the US entry and its PAL counterpart have the same size. Proof : the destination is
	free on PAL (no VRM rect, no layout reads it) ; the same entries read the band on both discs ;
	an entry of the same size on both reads the shared VRM from the same structures."""
	us_shared, pal_shared = shared_rects(us_rows), shared_rects(pal_rows)
	us_band, pal_band, dest = band_rects(us_shared, pal_shared)
	problems = []
	for row in pal_rows:
		for rect in row["vrm"]:
			if tuple(rect) == pal_band and row["name"] != SHARED_VRM:
				problems.append(f"{row['name']} also loads the band")
			if overlaps(rect, dest):
				problems.append(f"{row['name']} loads {rect}, over the destination {dest}")
		if row["refs"].get(dest):
			problems.append(f"{row['name']} reads the destination {dest} : {row['refs'][dest][0][0]} …")
	us_by_index = {r["index"]: r for r in us_rows}
	summary = {}

	def paths(row, rects):
		return {h[0] for rect in rects for h in row["refs"].get(rect, [])}

	for row in pal_rows:
		if row["kind"] != "refs" or row["us_index"] is None:
			continue
		us = us_by_index[row["us_index"]]
		pal_hits, us_hits = row["refs"][pal_band], us["refs"][us_band]
		pal_paths, us_paths = paths(row, pal_shared), paths(us, us_shared)
		if not (pal_hits or us_hits or pal_paths or us_paths):
			continue
		near = row.get("near", {}).get(pal_band, len(pal_hits))
		if near != len(pal_hits):
			problems.append(f"{row['name']} : {near - len(pal_hits)} layouts touch the band without reading inside it (straddling, one row, a CLUT of a 16-bit page)")
		if bool(pal_hits) != bool(us_hits):
			problems.append(f"{row['name']} : {len(pal_hits)} band reads on PAL, {len(us_hits)} on US")
		same = same_size(row["us_index"])
		if same and pal_paths != us_paths:
			problems.append(f"{row['name']} : the shared VRM is read from other structures on each disc")
		s = summary.setdefault(row["name"].split("+")[0], {"entries": 0, "other size": 0, "layouts": [0, 0], "shared": [0, 0],
			"band": [0, 0], "texels": [0, 0], "cluts": [0, 0]})
		s["entries"] += 1
		s["other size"] += not same
		for k, (u, p) in {"layouts": (us["layouts"], row["layouts"]), "shared": (len(us_paths), len(pal_paths)), "band": (len(us_hits), len(pal_hits)),
				"texels": (sum(h[1] for h in us_hits), sum(h[1] for h in pal_hits)), "cluts": (sum(h[2] for h in us_hits), sum(h[2] for h in pal_hits))}.items():
			s[k][0] += u
			s[k][1] += p
	return problems, summary


def overlaps(a, b):
	return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def band_rects(us_shared, pal_shared):
	"""(US band, PAL band, the PAL band's destination) : the shared rect left of x 512 on each disc,
	the destination its rect on the US band's rows."""
	us_band = [r for r in us_shared if r[0] < 512]
	pal_band = [r for r in pal_shared if r[0] < 512]
	if len(us_band) != 1 or len(pal_band) != 1:
		raise Problem(f"shared VRM bands : US {us_band}, PAL {pal_band}")
	us_band, pal_band = us_band[0], pal_band[0]
	dest = (pal_band[0], us_band[1], pal_band[2], pal_band[3])
	if pal_band[1] - dest[1] != 256 or (pal_band[0], pal_band[2]) != (us_band[0], us_band[2]) or dest[1] + dest[3] > 256:
		raise Problem(f"the PAL band {pal_band} does not move onto the US rows {us_band} by one texture page")
	return us_band, pal_band, dest


def read_index(out):
	with open(os.path.join(out, "bigfile", "index.json"), encoding="utf-8") as f:
		return json.load(f)


def shared_vrm(out, index):
	for e in index["entries"]:
		if e["name"] == SHARED_VRM:
			with open(os.path.join(out, "bigfile", f"{e['index']:03d}_{e['name']}.bin"), "rb") as f:
				return [tuple(r[:4]) for r in vrm.parse(f.read())]
	raise Problem(f"no {SHARED_VRM}")


def scan_discs(us_out, pal_out):
	"""Both extractions scanned for what `prove` needs : (US rows, PAL rows)."""
	us_index, pal_index = read_index(us_out), read_index(pal_out)
	us_shared, pal_shared = shared_vrm(us_out, us_index), shared_vrm(pal_out, pal_index)
	dest = band_rects(us_shared, pal_shared)[2]
	return (scan(os.path.join(us_out, "bigfile"), us_index, us_shared),
		scan(os.path.join(pal_out, "bigfile"), pal_index, pal_shared + [dest]))


def apply_patches(data, patches):
	"""`data` with the patches applied (each : a byte minus its delta), as the view does."""
	out = bytearray(data)
	for off, code in patches:
		out[off] = (out[off] - PATCH_DELTA[code]) & 0xFF
	return bytes(out)


def main(argv):
	if len(argv) not in (3, 4):
		print(__doc__.strip(), file=sys.stderr)
		return 2
	out_dir, rect = argv[1], tuple(int(v) for v in argv[2].split(","))
	with open(os.path.join(out_dir, "bigfile", "index.json"), encoding="utf-8") as f:
		index = json.load(f)
	rows = scan(os.path.join(out_dir, "bigfile"), index, [rect])
	report = []
	for r in rows:
		hits = r["refs"].get(rect, [])
		if hits or any(tuple(v) == rect for v in r["vrm"]):
			report.append({"index": r["index"], "name": r["name"], "kind": r["kind"], "layouts": r.get("layouts"), "in_rect": len(hits),
				"texels": sum(1 for h in hits if h[1]), "palettes": sum(1 for h in hits if h[2])})
	for r in report:
		print(f"{r['index']:4} {r['name']:28} {r['kind']:5} {r['in_rect']:5} ({r['texels']} texels, {r['palettes']} CLUTs)")
	if len(argv) == 4:
		with open(argv[3], "w", encoding="utf-8") as f:
			json.dump(report, f, indent=1)
	return 0


if __name__ == "__main__":
	sys.exit(main(sys.argv))
