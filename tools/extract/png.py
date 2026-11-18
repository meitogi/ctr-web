"""Minimal PNG writer (8-bit RGBA, no filter) and reader for the tests, stdlib only."""

import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunk(kind, data):
	return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode_rgba(width, height, rgba):
	"""PNG bytes of `rgba` (width * height * 4 bytes, rows top to bottom)."""
	if width <= 0 or height <= 0 or len(rgba) != width * height * 4:
		raise ValueError(f"{width}x{height} RGBA needs {width * height * 4} bytes, got {len(rgba)}")
	stride = width * 4
	raw = bytearray()
	for y in range(height):
		raw.append(0)  # filter type None
		raw += rgba[y * stride:(y + 1) * stride]
	ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
	return SIGNATURE + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + _chunk(b"IEND", b"")


def decode_rgba(data):
	"""(width, height, rgba) of a PNG written by `encode_rgba` (8-bit RGBA, filter 0 rows)."""
	if data[:8] != SIGNATURE:
		raise ValueError("not a PNG")
	pos, idat, width, height = 8, bytearray(), 0, 0
	while pos < len(data):
		length, kind = struct.unpack_from(">I4s", data, pos)
		body = data[pos + 8:pos + 8 + length]
		crc = struct.unpack_from(">I", data, pos + 8 + length)[0]
		if zlib.crc32(kind + body) & 0xFFFFFFFF != crc:
			raise ValueError(f"bad CRC in {kind!r}")
		if kind == b"IHDR":
			width, height, depth, ctype = struct.unpack_from(">IIBB", body)
			if (depth, ctype) != (8, 6):
				raise ValueError("only 8-bit RGBA")
		elif kind == b"IDAT":
			idat += body
		pos += 12 + length
	raw = zlib.decompress(bytes(idat))
	stride = width * 4 + 1
	out = bytearray()
	for y in range(height):
		row = raw[y * stride:(y + 1) * stride]
		if row[0] != 0:
			raise ValueError("only filter 0")
		out += row[1:]
	return width, height, bytes(out)
