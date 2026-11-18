"""The boot executable (PS-X EXE) and the gameplay tables found in it by content.

Header : "PS-X EXE", t_addr at 0x18, t_size at 0x1C, the text loaded from file offset 0x800.

- `MetaDataCharacters` (`include/regionsEXE.h` struct MetaDataCHAR, 16 x 0x10) : name_Debug
  pointer, name_LNG_long, name_LNG_short, iconID, padding, engineID (0..3).
- `metaPhys` (`include/namespace_Vehicle.h` struct MetaPhys, 65 records) : unusedDebugStr,
  driver offset, size, value[NUM_CLASSES]. NTSC-U has 4 classes (0x1C per record : BALANCED,
  ACCEL, SPEED, TURN) ; SCES-02105 has a fifth (0x20 per record), found from the data.
"""

import struct

CHAR_COUNT, CHAR_SIZE = 16, 0x10
PHYS_COUNT = 65
ENGINES = ["BALANCED", "ACCEL", "SPEED", "TURN"]  # the fifth (PAL) has no name in the decomp
MAX_CLASSES = 5


class Exe:
	def __init__(self, data):
		if data[:8] != b"PS-X EXE":
			raise ValueError("not a PS-X EXE")
		self.data = data
		self.base = struct.unpack_from("<I", data, 0x18)[0]
		self.size = struct.unpack_from("<I", data, 0x1C)[0]
		self.text = data[0x800:0x800 + self.size]

	def addr(self, off):
		return self.base + off

	def in_text(self, ptr):
		return self.base <= ptr < self.base + self.size

	def cstring(self, ptr):
		off = ptr - self.base
		end = self.text.index(b"\x00", off)
		return self.text[off:end].decode("ascii", "replace")


def _char_record(exe, off):
	ptr, long_id, short_id, icon, pad, engine = struct.unpack_from("<IhhhhI", exe.text, off)
	if not exe.in_text(ptr) or pad != 0 or engine >= MAX_CLASSES or not 0 <= icon < 0x100 or not 0 <= long_id < 0x400:
		return None
	name = exe.cstring(ptr)
	if not (1 <= len(name) <= 15 and name.isprintable()):
		return None
	return {"name": name, "name_LNG_long": long_id, "name_LNG_short": short_id, "iconID": icon, "engineID": engine}


def find_characters(exe):
	"""[(address, [16 records])] of every place the table fits."""
	out = []
	for off in range(0, len(exe.text) - CHAR_COUNT * CHAR_SIZE, 4):
		recs = []
		for i in range(CHAR_COUNT):
			r = _char_record(exe, off + i * CHAR_SIZE)
			if r is None:
				break
			recs.append(r)
		if len(recs) == CHAR_COUNT:
			out.append((exe.addr(off), recs))
	return out


def _phys_record(exe, off, classes):
	dbg, field, size = struct.unpack_from("<IiI", exe.text, off)
	if dbg != 0 or size not in (1, 2, 4) or not 0 < field < 0x800:
		return None
	return {"offset": field, "size": size, "values": list(struct.unpack_from(f"<{classes}i", exe.text, off + 12))}


def find_metaphys(exe):
	"""[(address, classes, [65 records])] of every place the table fits, for 4 or 5 classes.

	A record's driver offsets must rise : that rules out reading a 5-class table with a 4-class
	stride (and the reverse)."""
	out = []
	for classes in (4, 5):
		stride = 12 + 4 * classes
		for off in range(0, len(exe.text) - PHYS_COUNT * stride, 4):
			recs = []
			for i in range(PHYS_COUNT):
				r = _phys_record(exe, off + i * stride, classes)
				if r is None or (recs and r["offset"] <= recs[-1]["offset"]):
					break
				recs.append(r)
			if len(recs) == PHYS_COUNT:
				out.append((exe.addr(off), classes, recs))
	return out



VOICE_CHARS = 16
# (index entries, voice sets) : NTSC-U 0x16 + 11 (0x84 per character), SCES-02105 0x10 + 8 (0x60).
VOICE_SHAPES = [(0x16, 0xB), (0x10, 0x8)]
VOICE_TYPES = 0x18


def find_voicedata(exe):
	"""[(address, shape, [16 x {"index": [...], "sets": [(first, num)]}], voiceID)] : `voiceData`
	(`include/regionsEXE.h`), each character's GAME-category XA song ids and its voice sets
	(pointers into the character's own index array), then `voiceSetPtr[16]` and `voiceID[0x18]`
	(voice type -> set), which follow it."""
	out = []
	for n_index, n_sets in VOICE_SHAPES:
		size = 2 * n_index + 8 * n_sets
		for off in range(0, len(exe.text) - VOICE_CHARS * size - 0x40 - VOICE_TYPES, 4):
			recs = []
			for c in range(VOICE_CHARS):
				base = off + c * size
				sets = []
				for k in range(n_sets):
					ptr, num = struct.unpack_from("<Ii", exe.text, base + 2 * n_index + 8 * k)
					delta = ptr - exe.addr(base)
					if delta % 2 or not 0 <= delta // 2 < n_index or not 0 <= num <= n_index - delta // 2:
						sets = None
						break
					sets.append((delta // 2, num))
				if sets is None or sets[0][0] != 0:
					break
				recs.append({"index": list(struct.unpack_from(f"<{n_index}h", exe.text, base)), "sets": sets})
			if len(recs) == VOICE_CHARS:
				tail = off + VOICE_CHARS * size + 4 * VOICE_CHARS
				out.append((exe.addr(off), (n_index, n_sets), recs, list(exe.text[tail:tail + VOICE_TYPES])))
	return out
