"""BIGFILE.BIG : header, per-entry split, names from `enum BigIndex`.

Header (`include/namespace_Load.h` BigHeader / BigEntry) : cdpos, numEntry, then numEntry
{offset, size}, offset in 2048-byte sectors from the BIGFILE start, size in bytes.

The NTSC-U layout is the enum itself. The PAL BIGFILE (SCES-02105) inserts, after some English
entries, one copy per extra language (lip-sync matched to the voices) : `PAL_LANGUAGE_GROUPS`
lists them, found from the data and checked against it on every run (`check_pal_layout`).
"""

import re
import struct

LANGUAGES = ["ENG", "FRN", "GRM", "ITL", "SPN", "DCH"]  # PAL order, as in `xaLanguagePtrs`
# Suffix a PAL model name carries for each extra language (`joehead_FRENCH`, `papuhead_ITALIA` …).
LANGUAGE_SUFFIX = {"FRN": "_FR", "GRM": "_GE", "ITL": "_IT", "SPN": "_SP", "DCH": "_DU"}

# (BigIndex name, offset in the category, files per group) : the English group the PAL BIGFILE
# follows with five more, one per extra language.
PAL_LANGUAGE_GROUPS = [
	("BI_BOSSHEAD", 2, 2),  # joehead (Ripper Roo, +0, has no speech)
	("BI_BOSSHEAD", 4, 2),  # pinstripehead
	("BI_BOSSHEAD", 6, 2),  # papuhead
	("BI_BOSSHEAD", 8, 2),  # noxidehead
	("BI_LOSEHEAD", 2, 2),
	("BI_LOSEHEAD", 4, 2),
	("BI_LOSEHEAD", 6, 2),
	("BI_LOSEHEAD", 8, 2),
	("BI_CUTSCENES_INTRO", 24, 3),  # the last intro : Oxide's arrival
	("BI_CUTSCENES_OUTRO", 0, 2),
	("BI_CUTSCENES_OUTRO", 2, 2),
]

_ENUM = re.compile(r"enum\s+BigIndex\s*\{(.*?)\};", re.S)
_ITEM = re.compile(r"^\s*(BI_\w+)\s*=\s*([^,]+?)\s*,?\s*$")


def parse_bigindex(header_text):
	"""[(name, first index)] from `enum BigIndex`, in index order."""
	m = _ENUM.search(header_text)
	if not m:
		raise ValueError("enum BigIndex not found")
	values = {}
	for line in m.group(1).splitlines():
		line = line.split("//")[0]
		im = _ITEM.match(line)
		if not im:
			continue
		name, expr = im.groups()
		expr = re.sub(r"\bBI_\w+\b", lambda t: str(values[t.group(0)]), expr)
		if not re.fullmatch(r"[0-9+*() ]+", expr):
			raise ValueError(f"unexpected BigIndex expression: {name} = {expr}")
		values[name] = eval(expr, {"__builtins__": {}})  # digits and + * ( ) only, checked above
	return sorted(values.items(), key=lambda kv: kv[1])


def parse_header(data):
	"""(cdpos, [(offset_sectors, size)])"""
	cdpos, count = struct.unpack_from("<ii", data, 0)
	if count <= 0 or 8 + 8 * count > len(data):
		raise ValueError(f"BIGFILE header: {count} entries do not fit {len(data)} bytes")
	return cdpos, [struct.unpack_from("<ii", data, 8 + 8 * i) for i in range(count)]


def us_names(enum, count):
	"""Name of each NTSC-U index : `BI_CATEGORY+k` (the last category runs to `count`)."""
	names = []
	for i, (name, start) in enumerate(enum):
		end = enum[i + 1][1] if i + 1 < len(enum) else count
		names += [f"{name}+{k}" for k in range(end - start)]
	if len(names) != count:
		raise ValueError(f"BigIndex names {len(names)} entries, the BIGFILE has {count}")
	return names


def pal_layout(enum, us_count):
	"""[(name, us_index, language)] in PAL order : the US layout with the language copies
	inserted after each English group of `PAL_LANGUAGE_GROUPS`."""
	starts = dict(enum)
	names = us_names(enum, us_count)
	groups = {starts[cat] + off: size for cat, off, size in PAL_LANGUAGE_GROUPS}
	out = []
	i = 0
	while i < us_count:
		size = groups.get(i)
		if size is None:
			out.append((names[i], i, None))
			i += 1
			continue
		for lang in LANGUAGES:
			for k in range(size):
				out.append((names[i + k] if lang == "ENG" else f"{names[i + k]}_{lang}", i + k, lang))
		i += size
	return out


def model_name(data):
	"""A model file's name (after its 4-byte pointer-map header), or None."""
	raw = data[4:20].split(b"\x00")[0]
	if len(raw) >= 3 and all(0x20 < c < 0x7f for c in raw):
		return raw.decode("ascii")
	return None


def check_pal_layout(layout, entries, read, us_count):
	"""Problems with `layout` against the PAL entries ; [] when the layout holds.

	`read(i)` returns the first bytes of PAL entry i. Checks : the count ; every language copy
	of a named model carries its English base name and, when the name is long enough, its
	language suffix."""
	problems = []
	if len(layout) != len(entries):
		return [f"PAL layout predicts {len(layout)} entries, the BIGFILE has {len(entries)}"]
	english = {}
	for i, (name, us_index, lang) in enumerate(layout):
		if lang is None:
			continue
		mname = model_name(read(i))
		if lang == "ENG":
			english[us_index] = mname
			continue
		base = english.get(us_index)
		if base is None:
			continue  # cutscene levels carry no model name at the start
		if mname is None or not mname.startswith(base[:15]):
			problems.append(f"PAL {i} {name}: model {mname!r}, expected the base {base!r}")
		elif len(base) + 3 <= 15 and LANGUAGE_SUFFIX[lang] not in mname:
			problems.append(f"PAL {i} {name}: model {mname!r} lacks {LANGUAGE_SUFFIX[lang]}")
	return problems
