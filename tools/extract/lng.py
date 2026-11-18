"""LNG files : the game's text, one file per language (BIGFILE `BI_LANGUAGEFILE` + 0..7).

Layout (`game/LOAD/LOAD_LangFile.c`) : numStrings, offsetToPtrArr, then at offsetToPtrArr
numStrings file-relative offsets of NUL-terminated byte strings.

The bytes are the font's codes, not a text encoding. For the JSON, the European control bytes
of the PAL font (`git show c07f3a819 -- game/DecalFont.c`, the removed EurRetail branch) are
read as what they drew ; Japanese codes (>= 0x80) are kept as `<xx>`.
"""

import re
import struct

SLOTS = ["ja", "en", "en2", "fr", "de", "it", "es", "ne"]  # LOAD_LangFile.c, "0 ja, 1 en, 2 en2 …"

# EurRetail font : 0x03 = a tilde over the next letter (Ñ), '"' = quotation mark, '#' = ¡,
# '$' = ¿, '&' = raised period, the ordinal indicator.
EU_CODES = {0x22: '"', 0x23: "¡", 0x24: "¿", 0x26: "º"}
TILDE = {ord("N"): "Ñ", ord("n"): "ñ"}


def parse(data):
	"""[bytes] : the strings, in index order."""
	count, table = struct.unpack_from("<ii", data, 0)
	if count < 0 or table < 8 or table + 4 * count > len(data):
		raise ValueError(f"LNG header: {count} strings at {table} do not fit {len(data)} bytes")
	out = []
	for off in struct.unpack_from(f"<{count}i", data, table):
		end = data.index(b"\x00", off)
		out.append(data[off:end])
	return out


def decode(raw):
	"""A string's bytes as readable text (see the module note)."""
	out = []
	i = 0
	while i < len(raw):
		c = raw[i]
		if c == 0x03 and i + 1 < len(raw) and raw[i + 1] in TILDE:
			out.append(TILDE[raw[i + 1]])
			i += 2
			continue
		if c == 0x0D:
			out.append("\n")
		elif c in EU_CODES:
			out.append(EU_CODES[c])
		elif 0x20 <= c < 0x7F:
			out.append(chr(c))
		else:
			out.append(f"<{c:02x}>")
		i += 1
	return "".join(out)


def codes_used(strings):
	"""Sorted distinct byte values of all strings."""
	seen = set()
	for s in strings:
		seen.update(s)
	return sorted(seen)


def us_font_table(zglobal_data_text):
	"""`font_characterIconID` (byte 0x21 on) from `game/zGlobal_DATA.c`."""
	m = re.search(r"\.font_characterIconID\s*=\s*\{(.*?)\n\s*\},", zglobal_data_text, re.S)
	if not m:
		raise ValueError("font_characterIconID not found")
	body = re.sub(r"//[^\n]*", "", m.group(1))
	values = [int(t, 0) for t in re.findall(r"\b(?:0x[0-9A-Fa-f]+|\d+)\b", body)]
	# DecalFont.c reads indices < 0xDF ; the C array is 0xE0 long, unlisted entries are 0.
	if not 0xDF <= len(values) <= 0xE0:
		raise ValueError(f"font_characterIconID has {len(values)} entries, expected 0xDF-0xE0")
	return values + [0] * (0xE0 - len(values))


def undrawable(codes, table):
	"""Codes the US font draws nothing for (`game/DecalFont.c` : 0x01/0x02 are placeholders,
	0x0D a line break, 0x20 a space, 0x21.. through the table, 0xFF = no glyph)."""
	out = []
	for c in codes:
		if c in (0x01, 0x02, 0x0D, 0x20):
			continue
		if c < 0x21 or table[c - 0x21] == 0xFF:
			out.append(c)
	return out
