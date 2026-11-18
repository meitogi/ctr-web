"""Raw MODE2/2352 disc image reader and ISO9660 walk.

A PS1 disc image keeps every sector whole : 12 sync bytes, a 4-byte header, an 8-byte XA
subheader, then 2048 bytes of user data (Form 1) or 2324 (Form 2, XA audio and STR video).
Files are listed with their XA attribute so XA / STR can be copied as raw sectors.
"""

import os
import struct
from collections import namedtuple

SECTOR = 2352
DATA = 2048
FORM1_OFFSET = 24
SYNC = b"\x00" + b"\xff" * 10 + b"\x00"
PVD_LBA = 16

# ISO9660 directory record, Mode 2 XA extension (system use area) : attribute bits.
XA_ATTR_FORM2 = 0x1000
XA_ATTR_INTERLEAVED = 0x2000

Entry = namedtuple("Entry", "path lba size raw")


class DiscError(ValueError):
	pass


class Disc:
	"""A raw MODE2/2352 image, opened read-only."""

	def __init__(self, path):
		size = os.path.getsize(path)
		if size == 0 or size % SECTOR:
			raise DiscError(f"{path}: {size} bytes is not a whole number of 2352-byte sectors (a cooked .iso has lost the XA sectors)")
		self.path = path
		self.sectors = size // SECTOR
		self.f = open(path, "rb")

	def close(self):
		self.f.close()

	def __enter__(self):
		return self

	def __exit__(self, *exc):
		self.close()

	def raw(self, lba, count=1):
		"""Whole 2352-byte sectors."""
		if lba < 0 or lba + count > self.sectors:
			raise DiscError(f"sectors {lba}+{count} past the end of the image ({self.sectors})")
		self.f.seek(lba * SECTOR)
		return self.f.read(count * SECTOR)

	def read(self, lba, count=1):
		"""Form 1 user data of `count` sectors, each sector's sync checked."""
		raw = self.raw(lba, count)
		out = bytearray()
		for i in range(count):
			base = i * SECTOR
			if raw[base:base + 12] != SYNC:
				raise DiscError(f"sector {lba + i}: no CD sync pattern")
			out += raw[base + FORM1_OFFSET:base + FORM1_OFFSET + DATA]
		return bytes(out)

	def read_bytes(self, lba, size):
		return self.read(lba, (size + DATA - 1) // DATA)[:size]

	def walk(self):
		"""Every file of the ISO9660 tree, depth first, names without the `;1` version."""
		pvd = self.read(PVD_LBA)
		if pvd[1:6] != b"CD001":
			raise DiscError("no ISO9660 primary volume descriptor at sector 16")
		root = pvd[156:156 + 34]
		lba, size = struct.unpack_from("<I", root, 2)[0], struct.unpack_from("<I", root, 10)[0]
		out = []
		self._walk_dir(lba, size, "", out, set())
		return out

	def _walk_dir(self, lba, size, prefix, out, seen):
		if lba in seen:
			return
		seen.add(lba)
		data = self.read(lba, (size + DATA - 1) // DATA)
		i = 0
		while i < len(data):
			length = data[i]
			if length == 0:
				# Records never cross a sector : skip the sector's padding.
				i = (i // DATA + 1) * DATA
				continue
			rec = data[i:i + length]
			i += length
			name_len = rec[32]
			name = rec[33:33 + name_len]
			if name in (b"\x00", b"\x01"):
				continue
			elba = struct.unpack_from("<I", rec, 2)[0]
			esize = struct.unpack_from("<I", rec, 10)[0]
			flags = rec[25]
			name = name.decode("ascii").split(";")[0]
			path = f"{prefix}/{name}" if prefix else name
			if flags & 2:
				self._walk_dir(elba, esize, path, out, seen)
				continue
			su = rec[33 + name_len + (1 - name_len % 2):]
			attr = struct.unpack_from(">H", su, 4)[0] if len(su) >= 8 and su[6:8] == b"XA" else 0
			out.append(Entry(path, elba, esize, bool(attr & (XA_ATTR_FORM2 | XA_ATTR_INTERLEAVED))))

	def file_bytes(self, entry):
		"""A file's content : raw sectors for XA / STR, Form 1 data otherwise."""
		count = (entry.size + DATA - 1) // DATA
		if entry.raw:
			return self.raw(entry.lba, count)
		return self.read(entry.lba, count)[:entry.size]

	def find(self, path):
		want = path.upper()
		for e in self.walk():
			if e.path.upper() == want:
				return e
		return None
