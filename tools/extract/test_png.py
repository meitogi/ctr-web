import os
import struct
import sys
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import png  # noqa: E402
import vrm  # noqa: E402


class PngTest(unittest.TestCase):
	def test_round_trip(self):
		rgba = bytes(range(3 * 2 * 4))
		data = png.encode_rgba(3, 2, rgba)
		self.assertEqual(data[:8], png.SIGNATURE)
		self.assertEqual(png.decode_rgba(data), (3, 2, rgba))

	def test_ihdr_and_crc(self):
		data = png.encode_rgba(1, 1, b"\x01\x02\x03\x04")
		length, kind = struct.unpack_from(">I4s", data, 8)
		self.assertEqual((length, kind), (13, b"IHDR"))
		self.assertEqual(struct.unpack_from(">IIBB", data, 16), (1, 1, 8, 6))
		crc = struct.unpack_from(">I", data, 16 + 13)[0]
		self.assertEqual(crc, zlib.crc32(data[12:16 + 13]) & 0xFFFFFFFF)
		broken = bytearray(data)
		broken[20] ^= 1
		with self.assertRaises(ValueError):
			png.decode_rgba(bytes(broken))

	def test_wrong_size_refused(self):
		with self.assertRaises(ValueError):
			png.encode_rgba(2, 2, b"\x00" * 15)


def tim(x, y, w, h, words):
	return struct.pack("<III", 0x10, 2, 12 + 2 * len(words)) + struct.pack("<hhhh", x, y, w, h) + struct.pack(f"<{len(words)}H", *words)


class VrmTest(unittest.TestCase):
	def test_5551(self):
		# white opaque, pure red, transparent black
		self.assertEqual(vrm.rgba_5551(struct.pack("<3H", 0x7FFF, 0x001F, 0)), bytes([255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]))

	def test_single_and_packed(self):
		one = tim(64, 0, 2, 1, [1, 2])
		self.assertEqual(vrm.parse(one), [(64, 0, 2, 1, struct.pack("<2H", 1, 2))])
		a, b = tim(0, 0, 1, 1, [7]), tim(16, 256, 1, 2, [8, 9])
		packed = struct.pack("<I", 0x20) + struct.pack("<I", len(a)) + a + struct.pack("<I", len(b)) + b + struct.pack("<I", 0)
		self.assertEqual([r[:4] for r in vrm.parse(packed)], [(0, 0, 1, 1), (16, 256, 1, 2)])
		with self.assertRaises(ValueError):
			vrm.parse(b"\x00" * 32)

	def test_4bit_texture_with_clut(self):
		# texture page 1 (x 64), 4-bit ; CLUT at (0, 480) : index 0 transparent, 1 red, 2 green
		clut = [0, 0x001F, 0x03E0] + [0] * 13
		pixels = [0x2121]  # texels u0..3 : 1 2 1 2
		v = vrm.Vram()
		v.load([(0, 480, 16, 1, struct.pack("<16H", *clut)), (64, 0, 1, 1, struct.pack("<H", *pixels))])
		tpage = 1  # x = 1 * 64, y = 0, depth 4-bit
		clut_word = (480 << 6) | (0 // 16)
		rgba = v.texture(tpage, clut_word, 0, 0, 4, 1)
		self.assertEqual(rgba, bytes([255, 0, 0, 255, 0, 255, 0, 255] * 2))
		self.assertIsNone(v.texture(tpage, clut_word, 0, 1, 4, 1))  # row 1 never loaded

	def test_find_icons_takes_axis_aligned_named_records(self):
		icon = b"crash".ljust(16, b"\x00") + struct.pack("<i", 3) + struct.pack("<BBHBBHBBBB", 0, 0, 0x7800, 15, 0, 0x1, 0, 15, 15, 15)
		skewed = b"bent".ljust(16, b"\x00") + struct.pack("<i", 3) + struct.pack("<BBHBBHBBBB", 0, 0, 0, 15, 3, 0x1, 0, 15, 15, 15)
		found = vrm.find_icons(b"\xff" * 4 + icon + skewed)
		self.assertEqual(found, [(4, "crash", 1, 0x7800, 0, 0, 16, 16)])


if __name__ == "__main__":
	unittest.main()
