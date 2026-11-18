"""Extract a Crash Team Racing disc image (NTSC-U SCUS-94426 or PAL SCES-02105).

	python3 -I tools/extract/extract.py <disc.bin> <outdir>

The disc is a raw MODE2/2352 image. Writes under <outdir> :
  disc/      every ISO9660 file (XA and STR as raw 2352-byte sectors, subheaders kept)
  bigfile/   one file per BIGFILE entry, named from `enum BigIndex`
  lng/       per LNG slot : <slot>.json (UTF-8 strings) ; chars.json (codes each one uses)
  vrm/       per VRM entry : each VRAM rect as PNG, and named icons with their CLUT when found
  exe/       tables.json : MetaDataCharacters and metaPhys located in the boot executable
  extract.json  the manifest : every output, its source, the extractor version
Output belongs outside the repository or under the gitignored /assets/.
"""

import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling modules under `python3 -I`

import bigfile  # noqa: E402
import exe  # noqa: E402
import iso  # noqa: E402
import lng  # noqa: E402
import png  # noqa: E402
import region  # noqa: E402
import vrm  # noqa: E402

VERSION = "1.0.0"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOAD_H = os.path.join(REPO, "include", "namespace_Load.h")


class Writer:
	def __init__(self, out):
		self.out = out
		self.items = []

	def write(self, rel, data, source):
		path = os.path.join(self.out, rel)
		os.makedirs(os.path.dirname(path), exist_ok=True)
		with open(path, "wb") as f:
			f.write(data)
		self.items.append({"output": rel, "size": len(data), "sha1": hashlib.sha1(data).hexdigest(), "source": source})


def log(msg):
	print(msg, flush=True)


def extract_tree(disc, w, files):
	for e in files:
		w.write(f"disc/{e.path}", disc.file_bytes(e), {"iso": e.path, "lba": e.lba, "size": e.size, "raw_sectors": e.raw})
	log(f"disc tree : {len(files)} files ({sum(e.raw for e in files)} raw XA/STR)")


def bigfile_names(region_name, entries, read):
	"""(names, us_index per entry, language per entry, problems)."""
	with open(LOAD_H, encoding="utf-8") as f:
		enum = bigfile.parse_bigindex(f.read())
	us_count = 608  # NTSC-U entries (its last category, BI_SCRAPBOOK, holds 2) : the PAL layout is built on it
	if region_name == "us":
		names = bigfile.us_names(enum, len(entries))
		return names, list(range(len(entries))), [None] * len(entries), []
	layout = bigfile.pal_layout(enum, us_count)
	problems = bigfile.check_pal_layout(layout, entries, read, us_count)
	if problems:
		return [f"UNMAPPED_{i}" for i in range(len(entries))], [None] * len(entries), [None] * len(entries), problems
	return [n for n, _, _ in layout], [u for _, u, _ in layout], [lang for _, _, lang in layout], []


def extract_bigfile(disc, w, region_name, big):
	header = disc.read(big.lba, 8)
	cdpos, entries = bigfile.parse_header(header)

	def read(i, n=32):
		return disc.read_bytes(big.lba + entries[i][0], min(n, entries[i][1]))

	names, us_index, langs, problems = bigfile_names(region_name, entries, read)
	for p in problems:
		log(f"BIGFILE layout problem : {p}")
	table = []
	contents = []
	for i, (off, size) in enumerate(entries):
		data = disc.read_bytes(big.lba + off, size) if size else b""
		rel = f"bigfile/{i:03d}_{names[i]}.bin"
		w.write(rel, data, {"bigfile_index": i, "name": names[i], "us_index": us_index[i], "language": langs[i], "offset_sectors": off, "size": size})
		table.append({"index": i, "name": names[i], "us_index": us_index[i], "language": langs[i], "offset_sectors": off, "size": size, "sha1": hashlib.sha1(data).hexdigest(), "model": bigfile.model_name(data)})
		contents.append(data)
	w.write("bigfile/index.json", json.dumps({"cdpos": cdpos, "count": len(entries), "layout_problems": problems, "entries": table}, indent=1).encode(), {"bigfile_header": True})
	log(f"BIGFILE : {len(entries)} entries, layout {'OK' if not problems else 'NOT verified'}")
	return names, contents


def extract_lng(w, names, contents):
	start = names.index("BI_LANGUAGEFILE+0")
	chars = {}
	for k, slot in enumerate(lng.SLOTS):
		strings = lng.parse(contents[start + k])
		doc = {"slot": k, "language": slot, "bigfile_index": start + k, "count": len(strings), "strings": [lng.decode(s) for s in strings]}
		w.write(f"lng/{slot}.json", json.dumps(doc, ensure_ascii=False, indent=1).encode("utf-8"), {"bigfile_index": start + k, "name": names[start + k]})
		chars[slot] = {"codes": [f"0x{c:02x}" for c in lng.codes_used(strings)], "text": "".join(sorted(set("".join(doc["strings"]))))}
	w.write("lng/chars.json", json.dumps(chars, ensure_ascii=False, indent=1).encode("utf-8"), {"lng": "all"})
	log(f"LNG : {len(lng.SLOTS)} languages")


def extract_vrm(w, names, contents):
	count_rects = count_icons = 0
	for i, data in enumerate(contents):
		try:
			rects = vrm.parse(data)
		except ValueError:
			continue
		base = f"vrm/{i:03d}_{names[i]}"
		for n, (x, y, rw, rh, pix) in enumerate(rects):
			w.write(f"{base}/rect{n}_{x}_{y}_{rw}x{rh}.png", png.encode_rgba(rw, rh, vrm.rgba_5551(pix)), {"bigfile_index": i, "name": names[i], "rect": [x, y, rw, rh], "view": "raw 16-bit words as 5551"})
			count_rects += 1
		vram = vrm.Vram()
		vram.load(rects)
		for j in (i - 1, i + 1):
			if not 0 <= j < len(contents):
				continue
			for off, name, tpage, clut, u, v, tw, th in vrm.find_icons(contents[j]):
				rgba = vram.texture(tpage, clut, u, v, tw, th)
				if rgba is None:
					continue
				w.write(f"{base}/icons/{name}.png", png.encode_rgba(tw, th, rgba), {"bigfile_index": i, "icon_file": j, "icon_offset": off, "tpage": tpage, "clut": clut, "uv": [u, v, tw, th]})
				count_icons += 1
	log(f"VRM : {count_rects} rects, {count_icons} icons")


def extract_exe(disc, w, boot):
	data = disc.file_bytes(disc.find(boot))
	x = exe.Exe(data)
	chars = exe.find_characters(x)
	phys = exe.find_metaphys(x)
	voices = exe.find_voicedata(x)
	doc = {
		"exe": boot,
		"MetaDataCharacters": [{"address": f"0x{a:08x}", "records": r} for a, r in chars],
		"metaPhys": [{"address": f"0x{a:08x}", "classes": k, "records": r} for a, k, r in phys],
		"voiceData": [{"address": f"0x{a:08x}", "index_entries": shape[0], "sets": shape[1], "characters": r, "voiceID": t} for a, shape, r, t in voices],
	}
	w.write("exe/tables.json", json.dumps(doc, indent=1).encode(), {"iso": boot})
	log(f"EXE {boot} : MetaDataCharacters x{len(chars)}, metaPhys x{len(phys)}, voiceData x{len(voices)}")


def main(argv):
	if len(argv) != 3:
		print(__doc__.strip(), file=sys.stderr)
		return 2
	disc_path, out = argv[1], argv[2]
	with iso.Disc(disc_path) as disc:
		files = disc.walk()
		cnf = disc.file_bytes(disc.find("SYSTEM.CNF"))
		boot, region_name = region.region_of(cnf)
		if region_name is None:
			print(f"unknown release {boot} : this tool knows {', '.join(region.REGIONS)}", file=sys.stderr)
			return 1
		log(f"{disc_path} : {boot} ({region_name}), {disc.sectors} sectors")
		w = Writer(out)
		extract_tree(disc, w, files)
		names, contents = extract_bigfile(disc, w, region_name, disc.find("BIGFILE.BIG"))
		extract_lng(w, names, contents)
		extract_vrm(w, names, contents)
		extract_exe(disc, w, boot)
		manifest = {"extractor": "ctr-web tools/extract", "version": VERSION, "disc": os.path.basename(disc_path), "boot": boot, "region": region_name, "outputs": w.items}
		with open(os.path.join(out, "extract.json"), "w", encoding="utf-8") as f:
			json.dump(manifest, f, indent=1)
		log(f"manifest : {len(w.items)} outputs")
	return 0


if __name__ == "__main__":
	sys.exit(main(sys.argv))
