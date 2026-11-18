import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hwl  # noqa: E402

SECTOR = hwl.SECTOR


def build(samples, fx, banks):
	"""A KART.HWL : `samples` spu index -> bytes (a multiple of 8), `fx` the OtherFX spu
	indices, `banks` lists of spu indices. Two EngineFX and one song, as filler."""
	n_spu = len(samples)
	spu = b"".join(struct.pack("<HH", 0, len(samples[i]) // 8) for i in range(n_spu))
	fxs = b"".join(struct.pack("<BBHHH", 0, 100, 0x1000, i, 0) for i in fx)
	engine = struct.pack("<BBHHH", 0, 1, 2, 0, 0) * 2
	tables_size = len(spu) + len(fxs) + len(engine) + 2 * len(banks) + 2
	header_sectors = (0x28 + tables_size + SECTOR - 1) // SECTOR
	body, offsets, sector = b"", [], header_sectors
	for idx in banks:
		head = struct.pack(f"<H{len(idx)}H", len(idx), *idx).ljust(SECTOR, b"\0")
		data = b"".join(samples[i] for i in idx)
		data = data.ljust((len(data) + SECTOR - 1) // SECTOR * SECTOR, b"\0")
		offsets.append(sector)
		body += head + data
		sector += 1 + len(data) // SECTOR
	header = struct.pack("<10i", 0x6C776F48, 0x80, 0, 0, n_spu, len(fx), 2, len(banks), 1, tables_size)
	header += spu + fxs + engine + struct.pack(f"<{len(banks)}H", *offsets) + struct.pack("<H", sector)
	return header.ljust(header_sectors * SECTOR, b"\0") + body + b"\0" * SECTOR


def sample(tag):
	return struct.pack("<H", tag) * 8


class Discs:
	"""A small US / PAL pair shaped like the real one : US OtherFX 28..59, 167, 209 are the
	language effects, PAL keeps them in six 34-entry blocks from 224."""

	def __init__(self):
		lang_fx = hwl.US_LANGUAGE_FX
		# US : spu 0 shared, 1 a sound effect, 2..35 the 34 language samples (English)
		self.us_samples = [sample(1), sample(2)] + [sample(10 + m) for m in range(34)]
		us_fx = [1 if k not in lang_fx else 2 + lang_fx.index(k) for k in range(258)]
		self.us_banks = [[0, 1], [0, 2, 3], [1, 4, 5], list(range(6, 36))]
		# PAL : spu 0, 1 the same, then six blocks of 34 language samples (block 0 = English)
		self.pal_samples = [sample(1), sample(2)]
		for language in range(6):
			self.pal_samples += [sample(10 + m) if language == 0 else sample(100 + 34 * language + m) for m in range(34)]
		pal_fx = [1] * 224 + [2 + 34 * language + m for language in range(6) for m in range(34)]
		# bank 1 is a PAL bank per language ; US bank 2's samples are split over PAL banks 0 and 7+
		self.pal_banks = [[0, 1]] + [[0, 2 + 34 * language, 3 + 34 * language] for language in range(6)] + [[4 + 34 * language, 5 + 34 * language] for language in range(6)] + [list(range(6 + 34 * language, 36 + 34 * language)) for language in range(6)]
		self.us = build(self.us_samples, us_fx, self.us_banks)
		self.pal = build(self.pal_samples, pal_fx, self.pal_banks)


class HwlTest(unittest.TestCase):
	def test_parse_reads_banks_and_samples(self):
		d = Discs()
		h = hwl.parse(d.us)
		self.assertEqual([b["idx"] for b in h["banks"]], d.us_banks)
		i, pos, size = h["banks"][1]["samples"][2]
		self.assertEqual((i, d.us[pos:pos + size]), (3, sample(11)))

	def test_otherfx_map_moves_the_language_block(self):
		self.assertEqual(hwl.otherfx_map(258, 0)[:29], list(range(28)) + [224])
		fr = hwl.otherfx_map(258, 1)
		self.assertEqual((fr[28], fr[59], fr[167], fr[209]), (258, 289, 290, 291))
		self.assertEqual((fr[60], fr[166], fr[168], fr[208], fr[210], fr[257]), (28, 134, 135, 175, 176, 223))

	def test_banks_map_per_language_by_content(self):
		d = Discs()
		v = hwl.view(d.us, d.pal)
		self.assertEqual((v["sample_conflicts"], v["us_samples_unmatched"]), ([], []))
		en, de = v["languages"]["en"], v["languages"]["de"]
		self.assertEqual((en["fx_sample_mismatch"], en["fx_field_mismatch"], de["fx_sample_mismatch"]), ([], [], []))
		self.assertEqual(en["banks"][:2], [{"pal": 0}, {"pal": 1}])
		self.assertEqual(de["banks"][1], {"pal": 3})  # the German copy of the language bank
		# no PAL bank holds US bank 2 : the sound effect plus the German samples, to assemble
		self.assertEqual(de["banks"][2], {"samples": [1, 2 + 68 + 2, 2 + 68 + 3], "from": [0, 9, 9]})
		self.assertEqual(en["otherfx"][28], 224)
		self.assertEqual(de["otherfx"][28], 224 + 68)
		self.assertEqual(de["banks"][3], {"pal": 13 + 2})

	def test_a_disagreement_between_sources_is_reported(self):
		d = Discs()
		# the PAL English block's first effect points at the wrong sample : bank content says 2
		pal = bytearray(d.pal)
		struct.pack_into("<H", pal, 0x28 + 4 * len(d.pal_samples) + 8 * 224 + 4, 3)
		v = hwl.view(d.us, bytes(pal))
		self.assertIn(2, v["sample_conflicts"])
		self.assertTrue(v["languages"]["en"]["fx_sample_mismatch"])

	def test_truncated_header_is_refused(self):
		with self.assertRaises(ValueError):
			hwl.parse(Discs().us[:0x30])


if __name__ == "__main__":
	unittest.main()
