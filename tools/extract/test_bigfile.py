import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bigfile  # noqa: E402

LOAD_H = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "include", "namespace_Load.h")


def load_h():
	with open(LOAD_H, encoding="utf-8") as f:
		return f.read()

ENUM = """
enum BigIndex
{
	// comment
	BI_A = 0,
	BI_B = BI_A + (2 * 3), // six
	BI_C = BI_B + 4,
	BI_D = BI_C + 1
};
"""


class BigfileTest(unittest.TestCase):
	def test_enum_expressions(self):
		self.assertEqual(bigfile.parse_bigindex(ENUM), [("BI_A", 0), ("BI_B", 6), ("BI_C", 10), ("BI_D", 11)])

	def test_names_run_the_last_category_to_the_count(self):
		names = bigfile.us_names(bigfile.parse_bigindex(ENUM), 13)
		self.assertEqual(names[5:7] + names[10:], ["BI_A+5", "BI_B+0", "BI_C+0", "BI_D+0", "BI_D+1"])

	def test_header_split(self):
		data = struct.pack("<ii", 0, 3) + struct.pack("<6i", 3, 100, 4, 2048, 5, 0)
		self.assertEqual(bigfile.parse_header(data), (0, [(3, 100), (4, 2048), (5, 0)]))
		with self.assertRaises(ValueError):
			bigfile.parse_header(struct.pack("<ii", 0, 9) + b"\x00" * 16)

	def test_real_enum_gives_the_retail_slots(self):
		enum = dict(bigfile.parse_bigindex(load_h()))
		self.assertEqual(enum["BI_LANGUAGEFILE"], 234)
		self.assertEqual(enum["BI_SCRAPBOOK"], 606)

	def test_pal_layout_inserts_five_languages_after_each_english_group(self):
		enum = bigfile.parse_bigindex(load_h())
		layout = bigfile.pal_layout(enum, 608)
		self.assertEqual(len(layout), 723)
		# joehead (BI_BOSSHEAD+2, 2 files) : English at 452-453, then FRN 454-455 … DCH 462-463
		self.assertEqual(layout[452], ("BI_BOSSHEAD+2", 452, "ENG"))
		self.assertEqual(layout[454], ("BI_BOSSHEAD+2_FRN", 452, "FRN"))
		self.assertEqual(layout[463], ("BI_BOSSHEAD+3_DCH", 453, "DCH"))
		self.assertEqual(layout[464], ("BI_BOSSHEAD+4", 454, "ENG"))
		# everything after the last group is the US entry shifted by 115
		self.assertEqual(layout[722], ("BI_SCRAPBOOK+1", 607, None))

	def test_pal_layout_check_catches_a_wrong_model(self):
		enum = bigfile.parse_bigindex(load_h())
		layout = bigfile.pal_layout(enum, 608)

		def model(name):
			return b"\x00\x00\x00\x00" + name.encode().ljust(16, b"\x00")

		names = {}
		for i, (_, us_index, lang) in enumerate(layout):
			if lang == "ENG":
				names[i] = model("joehead")
			elif lang:
				names[i] = model("joehead" + bigfile.LANGUAGE_SUFFIX[lang] + "X")
		entries = [(0, 0)] * len(layout)

		def read(i):
			return names.get(i, b"\x00" * 20)

		self.assertEqual(bigfile.check_pal_layout(layout, entries, read, 608), [])
		names[456] = model("papuhead_GERMAN")
		self.assertEqual(len(bigfile.check_pal_layout(layout, entries, read, 608)), 1)
		self.assertTrue(bigfile.check_pal_layout(layout, entries[:-1], read, 608))


if __name__ == "__main__":
	unittest.main()
