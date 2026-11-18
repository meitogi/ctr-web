import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import iso  # noqa: E402
import region  # noqa: E402


def sector(payload, xa=False):
	"""A raw 2352-byte Mode 2 sector : sync, header, subheader, payload padded."""
	sub = bytes([0, 0, 0x24 if xa else 0x08, 0]) * 2
	body = payload.ljust(2324 if xa else 2048, b"\x00")
	raw = iso.SYNC + b"\x00\x02\x00\x02" + sub + body
	return raw.ljust(iso.SECTOR, b"\x00")


def record(name, lba, size, is_dir=False, xa_attr=0x0D55):
	name_b = name if isinstance(name, bytes) else name.encode()
	pad = b"" if len(name_b) % 2 else b"\x00"
	su = b"\x00\x00\x00\x00" + struct.pack(">H", xa_attr) + b"XA" + b"\x00" * 6
	rec = bytearray(33 + len(name_b) + len(pad) + len(su))
	rec[0] = len(rec)
	struct.pack_into("<I", rec, 2, lba)
	struct.pack_into(">I", rec, 6, lba)
	struct.pack_into("<I", rec, 10, size)
	struct.pack_into(">I", rec, 14, size)
	rec[25] = 2 if is_dir else 0
	rec[32] = len(name_b)
	rec[33:33 + len(name_b)] = name_b
	rec[33 + len(name_b) + len(pad):] = su
	return bytes(rec)


def build_image(path):
	"""Sectors : 16 PVD, 20 root, 21 SUB dir, 22 SYSTEM.CNF, 23-24 DATA.BIN, 25-26 MOVIE.STR (XA)."""
	cnf = b"BOOT = cdrom:\\SCUS_944.26;1\r\nTCB = 4\r\n"
	data = bytes(range(256)) * 12  # 3072 bytes, two sectors
	root = record(b"\x00", 20, 2048, True) + record(b"\x01", 20, 2048, True) + record("SYSTEM.CNF;1", 22, len(cnf)) + record("SUB", 21, 2048, True)
	sub = record(b"\x00", 21, 2048, True) + record(b"\x01", 20, 2048, True) + record("DATA.BIN;1", 23, len(data)) + record("MOVIE.STR;1", 25, 4096, xa_attr=0x3555)
	pvd = bytearray(2048)
	pvd[0:6] = b"\x01CD001"
	pvd[156:156 + 34] = record(b"\x00", 20, 2048, True)[:34]
	sectors = [sector(b"")] * 16 + [sector(bytes(pvd)), sector(b""), sector(b""), sector(b""), sector(root), sector(sub), sector(cnf),
		sector(data[:2048]), sector(data[2048:]), sector(b"A" * 2324, xa=True), sector(b"B" * 2324, xa=True)]
	with open(path, "wb") as f:
		f.write(b"".join(sectors))
	return data, cnf


class IsoTest(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.TemporaryDirectory()
		self.path = os.path.join(self.tmp.name, "disc.bin")
		self.data, self.cnf = build_image(self.path)

	def tearDown(self):
		self.tmp.cleanup()

	def test_walk_lists_every_file_with_its_xa_attribute(self):
		with iso.Disc(self.path) as d:
			files = {e.path: e for e in d.walk()}
		self.assertEqual(sorted(files), ["SUB/DATA.BIN", "SUB/MOVIE.STR", "SYSTEM.CNF"])
		self.assertEqual((files["SUB/DATA.BIN"].lba, files["SUB/DATA.BIN"].size, files["SUB/DATA.BIN"].raw), (23, 3072, False))
		self.assertTrue(files["SUB/MOVIE.STR"].raw)

	def test_form1_file_is_its_user_data(self):
		with iso.Disc(self.path) as d:
			self.assertEqual(d.file_bytes(d.find("sub/data.bin")), self.data)

	def test_xa_file_keeps_whole_sectors_and_subheaders(self):
		with iso.Disc(self.path) as d:
			raw = d.file_bytes(d.find("SUB/MOVIE.STR"))
		self.assertEqual(len(raw), 2 * iso.SECTOR)
		self.assertEqual(raw[:12], iso.SYNC)
		self.assertEqual(raw[18], 0x24)  # submode : Form 2 + audio
		self.assertEqual(raw[iso.SECTOR + 24:iso.SECTOR + 28], b"BBBB")

	def test_region_from_system_cnf(self):
		with iso.Disc(self.path) as d:
			cnf = d.file_bytes(d.find("SYSTEM.CNF"))
		self.assertEqual(region.region_of(cnf), ("SCUS_944.26", "us"))
		self.assertEqual(region.region_of(b"BOOT=cdrom:\\SCES_021.05;1"), ("SCES_021.05", "pal"))
		self.assertEqual(region.region_of(b"BOOT = cdrom:\\SLPS_999.99;1")[1], None)

	def test_cooked_iso_is_refused(self):
		path = os.path.join(self.tmp.name, "cooked.iso")
		with open(path, "wb") as f:
			f.write(b"\x00" * 2048 * 20)
		with self.assertRaises(iso.DiscError):
			iso.Disc(path)

	def test_missing_sync_is_reported(self):
		with open(self.path, "r+b") as f:
			f.seek(22 * iso.SECTOR)
			f.write(b"\x00" * 12)
		with iso.Disc(self.path) as d:
			with self.assertRaises(iso.DiscError):
				d.read(22)


if __name__ == "__main__":
	unittest.main()
