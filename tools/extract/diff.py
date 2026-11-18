"""Compare two extractions (NTSC-U and PAL) : the data behind plans' PAL-DIFF report.

	python3 -I tools/extract/diff.py <us_out> <pal_out> <diff.json>

Reads what extract.py wrote ; prints markdown tables and writes the full comparison as JSON.
"""

import difflib
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # sibling modules under `python3 -I`

import hwl as hwl_view  # noqa: E402
import lng  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STR_SECTOR, STR_MAGIC = 2352, 0x80010160


def read_json(path):
	with open(path, encoding="utf-8") as f:
		return json.load(f)


def read_bytes(path):
	with open(path, "rb") as f:
		return f.read()


def load(out):
	with open(os.path.join(out, "extract.json"), encoding="utf-8") as f:
		manifest = json.load(f)
	with open(os.path.join(out, "bigfile", "index.json"), encoding="utf-8") as f:
		big = json.load(f)
	with open(os.path.join(out, "exe", "tables.json"), encoding="utf-8") as f:
		tables = json.load(f)
	return manifest, big, tables


def tree(us, pal):
	def files(m):
		return {o["source"]["iso"]: o for o in m["outputs"] if o["output"].startswith("disc/")}

	a, b = files(us), files(pal)
	return {
		"only_us": sorted(a.keys() - b.keys()),
		"only_pal": sorted(b.keys() - a.keys()),
		"both": [{"path": p, "us": a[p]["size"], "pal": b[p]["size"], "same": a[p]["sha1"] == b[p]["sha1"]} for p in sorted(a.keys() & b.keys())],
	}


def category(name):
	return name.split("+")[0]


def bigfile(ub, pb):
	"""Per US index : the PAL entry with that US index and no language (or ENG)."""
	pal_by_us = {}
	variants = {}
	for e in pb["entries"]:
		if e["us_index"] is None:
			continue
		if e["language"] in (None, "ENG"):
			pal_by_us[e["us_index"]] = e
		else:
			variants.setdefault(e["us_index"], []).append(e)
	rows = []
	cats = {}
	for u in ub["entries"]:
		p = pal_by_us.get(u["index"])
		if p is None:
			state = "missing"
		elif p["sha1"] == u["sha1"]:
			state = "identical"
		elif p["size"] == u["size"]:
			state = "same size, different bytes"
		else:
			state = "different size"
		rows.append({"us_index": u["index"], "name": u["name"], "pal_index": p and p["index"], "us_size": u["size"], "pal_size": p and p["size"], "state": state, "model": u["model"]})
		c = cats.setdefault(category(u["name"]), {"identical": 0, "same size, different bytes": 0, "different size": 0, "missing": 0, "languages": 0})
		c[state] += 1
		c["languages"] += len(variants.get(u["index"], []))
	return {"us_count": ub["count"], "pal_count": pb["count"], "pal_layout_problems": pb["layout_problems"], "categories": cats, "entries": rows,
		"language_variants": {str(k): [{"index": v["index"], "language": v["language"], "size": v["size"], "model": v["model"]} for v in vs] for k, vs in variants.items()}}


def lng_compare(us_out, pal_out):
	with open(os.path.join(REPO, "game", "zGlobal_DATA.c"), encoding="utf-8") as f:
		table = lng.us_font_table(f.read())
	out = {}
	for slot in lng.SLOTS:
		u = read_json(os.path.join(us_out, "lng", f"{slot}.json"))
		p = read_json(os.path.join(pal_out, "lng", f"{slot}.json"))
		sm = difflib.SequenceMatcher(None, u["strings"], p["strings"], autojunk=False)
		ops = [op for op in sm.get_opcodes() if op[0] != "equal"]
		inserted = [(i1, j1, j2) for tag, i1, i2, j1, j2 in ops if tag == "insert"]
		replaced = sum(i2 - i1 for tag, i1, i2, j1, j2 in ops if tag == "replace")
		row = {"us_count": u["count"], "pal_count": p["count"], "pal_inserts": [{"before_us_id": i, "pal_ids": list(range(j1, j2)), "text": p["strings"][j1:j2]} for i, j1, j2 in inserted], "strings_reworded": replaced}
		for side, out_dir in (("us", us_out), ("pal", pal_out)):
			chars = read_json(os.path.join(out_dir, "lng", "chars.json"))[slot]
			codes = [int(c, 16) for c in chars["codes"]]
			row[f"{side}_undrawable"] = [f"0x{c:02x}" for c in lng.undrawable(codes, table)] if slot != "ja" else "kana font, not checked"
		out[slot] = row
	return out


def id_map(lng_rows):
	"""US string id -> PAL string id, from the English slot's inserts (the same in every slot)."""
	inserts = lng_rows["en"]["pal_inserts"]
	us_count = lng_rows["en"]["us_count"]
	m, shift = [], 0
	starts = {ins["before_us_id"]: len(ins["pal_ids"]) for ins in inserts}
	for i in range(us_count):
		shift += starts.get(i, 0)
		m.append(i + shift)
	return m


def exe_compare(ut, pt):
	uc, pc = ut["MetaDataCharacters"][0], pt["MetaDataCharacters"][0]
	chars = []
	for a, b in zip(uc["records"], pc["records"]):
		diff = {k: (a[k], b[k]) for k in a if a[k] != b[k]}
		chars.append({"name": a["name"], "us": a, "pal": b, "diff": diff})
	up, pp = ut["metaPhys"][0], pt["metaPhys"][0]
	phys = []
	for i, (a, b) in enumerate(zip(up["records"], pp["records"])):
		phys.append({"index": i, "us_offset": a["offset"], "pal_offset": b["offset"], "size": a["size"], "pal_size": b["size"],
			"us": a["values"], "pal": b["values"][:4], "pal_class4": b["values"][4] if len(b["values"]) > 4 else None,
			"classes_differ": a["values"] != b["values"][:4]})
	return {"characters": {"us_address": uc["address"], "pal_address": pc["address"], "records": chars},
		"metaPhys": {"us_address": up["address"], "pal_address": pp["address"], "us_classes": up["classes"], "pal_classes": pp["classes"], "records": phys}}


def voice_map(ut, pt):
	"""US GAME song id -> PAL song id from the two `voiceData` tables : the same character and
	voice set, the same position in it ; None where the US set has no PAL counterpart."""
	u, p = ut["voiceData"][0], pt["voiceData"][0]
	m = {}
	for uc, pc in zip(u["characters"], p["characters"]):
		for k, (first, num) in enumerate(uc["sets"]):
			for n in range(num):
				us_id = uc["index"][first + n]
				if k < len(pc["sets"]) and n < pc["sets"][k][1]:
					m.setdefault(us_id, pc["index"][pc["sets"][k][0] + n])
				else:
					m.setdefault(us_id, None)
	return {"us_shape": [u["index_entries"], u["sets"]], "pal_shape": [p["index_entries"], p["sets"]],
		"us_voiceID": u["voiceID"], "pal_voiceID": p["voiceID"], "map": {str(k): m[k] for k in sorted(m)}}


def hwl(path):
	d = read_bytes(path)
	magic, version, _, _, n_spu, n_fx, n_engine, n_banks, n_seq, header = struct.unpack_from("<10i", d, 0)
	o = 0x28
	spu = [struct.unpack_from("<HH", d, o + 4 * i) for i in range(n_spu)]
	o += 4 * n_spu
	fx = [struct.unpack_from("<BBHHH", d, o + 8 * i) for i in range(n_fx)]
	o += 8 * n_fx
	engine = [struct.unpack_from("<BBHHH", d, o + 8 * i) for i in range(n_engine)]
	o += 8 * n_engine
	banks = list(struct.unpack_from(f"<{n_banks}H", d, o))
	return {"bytes": len(d), "numSpuAddrs": n_spu, "numOtherFX": n_fx, "numEngineFX": n_engine, "numBanks": n_banks, "numSequences": n_seq, "headerSize": header,
		# (flags, volume, pitch, sample size) : what an effect sounds like, independent of where its sample sits
		"fx_keys": [(f[0], f[1], f[2], spu[f[3]][1] if f[3] < n_spu else -1) for f in fx],
		"engine_keys": [(f[0], f[1], f[2], spu[f[3]][1] if f[3] < n_spu else -1) for f in engine],
		"bank_sectors": [b - a for a, b in zip(banks, banks[1:])]}


def hwl_compare(us_path, pal_path):
	u, p = hwl(us_path), hwl(pal_path)
	sm = difflib.SequenceMatcher(None, u["fx_keys"], p["fx_keys"], autojunk=False)
	ops = [op for op in sm.get_opcodes() if op[0] != "equal"]
	return {"us": {k: v for k, v in u.items() if not k.endswith("_keys")}, "pal": {k: v for k, v in p.items() if not k.endswith("_keys")},
		"otherfx_ops": ops, "engine_same": u["engine_keys"] == p["engine_keys"][:len(u["engine_keys"])]}


def xnf(path):
	d = read_bytes(path)
	magic, version, types, xas, tracks = struct.unpack_from("<4s4i", d, 0)
	cats = struct.unpack_from(f"<{4 * types}i", d, 0x14)
	pos = 0x14 + 16 * types
	cdpos = struct.unpack_from(f"<{xas}i", d, pos)
	pos += 4 * xas
	songs = [struct.unpack_from("<bbh", d, pos + 4 * k) for k in range(tracks)]
	return {"bytes": len(d), "magic": magic.decode(), "version": version, "numTypes": types, "numXAs_total": xas, "numAudioTracks_total": tracks,
		"numXA": cats[0:types], "firstXaIndex": cats[types:2 * types], "numSongs": cats[2 * types:3 * types], "firstSongIndex": cats[3 * types:4 * types],
		"tail_bytes": len(d) - pos - 4 * tracks, "songs": songs}


def xa_map(us, pal):
	"""US song id -> PAL song id per category, matched by length (`XaSize.XaBytes`) : an
	English line has the same length on both discs. Equal lengths are taken in order.
	Returns {category: {"map": [pal id or None], "unmatched_us": [...], "unused_pal": [...],
	"ambiguous": n}}."""
	out = {}
	for cat, name in enumerate(("MUSIC", "EXTRA", "GAME")):
		u0, un = us["firstSongIndex"][cat], us["numSongs"][cat]
		p0, pn = pal["firstSongIndex"][cat], pal["numSongs"][cat]
		by_len = {}
		for j in range(pn):
			by_len.setdefault(pal["songs"][p0 + j][2], []).append(j)
		ambiguous = sum(1 for v in by_len.values() if len(v) > 1)
		m = []
		for i in range(un):
			cands = by_len.get(us["songs"][u0 + i][2])
			m.append(cands.pop(0) if cands else None)
		used = {j for j in m if j is not None}
		out[name] = {"map": m, "unmatched_us": [i for i, j in enumerate(m) if j is None], "unused_pal": [j for j in range(pn) if j not in used], "ambiguous_lengths": ambiguous}
	return out


def str_frames(path):
	"""(frames, sectors, width, height) of a raw STR file : the highest frame number of its video sectors."""
	frames = sectors = 0
	size = None
	with open(path, "rb") as f:
		while True:
			s = f.read(STR_SECTOR)
			if len(s) < STR_SECTOR:
				break
			sectors += 1
			if struct.unpack_from("<I", s, 24)[0] == STR_MAGIC:
				frame = struct.unpack_from("<I", s, 24 + 8)[0]
				frames = max(frames, frame)
				size = struct.unpack_from("<HH", s, 24 + 16)
	return {"frames": frames, "sectors": sectors, "width": size and size[0], "height": size and size[1]}


def main(argv):
	if len(argv) != 4:
		print(__doc__.strip(), file=sys.stderr)
		return 2
	us_out, pal_out, dest = argv[1:]
	um, ub, ut = load(us_out)
	pm, pb, pt = load(pal_out)
	lng_rows = lng_compare(us_out, pal_out)
	result = {
		"us": {"boot": um["boot"], "version": um["version"]}, "pal": {"boot": pm["boot"], "version": pm["version"]},
		"tree": tree(um, pm), "bigfile": bigfile(ub, pb), "lng": lng_rows, "lng_id_map_us_to_pal": id_map(lng_rows),
		"exe": exe_compare(ut, pt),
		"xnf": {"us": {"ENG": xnf(os.path.join(us_out, "disc", "XA", "ENG.XNF"))},
			"pal": {code: xnf(os.path.join(pal_out, "disc", "XA", f"{code}.XNF")) for code in ("ENG", "FRN", "GRM", "ITL", "SPN", "DCH")}},
		"xa_map_us_to_pal": None,
		"voice_map_us_to_pal": voice_map(ut, pt),
		"hwl": hwl_compare(os.path.join(us_out, "disc", "SOUNDS", "KART.HWL"), os.path.join(pal_out, "disc", "SOUNDS", "KART.HWL")),
		"hwl_view": hwl_view.view(read_bytes(os.path.join(us_out, "disc", "SOUNDS", "KART.HWL")), read_bytes(os.path.join(pal_out, "disc", "SOUNDS", "KART.HWL"))),
		"str": {"us": str_frames(os.path.join(us_out, "disc", "TEST.STR")), "pal": str_frames(os.path.join(pal_out, "disc", "TEST.STR"))},
	}
	result["xa_map_us_to_pal"] = xa_map(result["xnf"]["us"]["ENG"], result["xnf"]["pal"]["ENG"])
	with open(dest, "w", encoding="utf-8") as f:
		json.dump(result, f, ensure_ascii=False, indent=1)

	t = result["tree"]
	print(f"## Disc tree\n\nonly US : {', '.join(t['only_us']) or '—'}\n\nonly PAL : {len(t['only_pal'])} files\n")
	print("| file | US | PAL | same |\n|---|---|---|---|")
	for r in t["both"]:
		print(f"| {r['path']} | {r['us']} | {r['pal']} | {'yes' if r['same'] else 'no'} |")
	b = result["bigfile"]
	print(f"\n## BIGFILE\n\nUS {b['us_count']} entries, PAL {b['pal_count']} ; layout problems : {b['pal_layout_problems'] or 'none'}\n")
	print("| category | identical | same size | different size | language copies (PAL) |\n|---|---|---|---|---|")
	for c, v in b["categories"].items():
		print(f"| {c} | {v['identical']} | {v['same size, different bytes']} | {v['different size']} | {v['languages']} |")
	print("\n## LNG\n\n| slot | US strings | PAL strings | PAL inserts (before US id) | reworded | US undrawable | PAL undrawable |\n|---|---|---|---|---|---|---|")
	for s, r in lng_rows.items():
		ins = ", ".join(f"{i['before_us_id']}+{len(i['pal_ids'])}" for i in r["pal_inserts"])
		print(f"| {s} | {r['us_count']} | {r['pal_count']} | {ins} | {r['strings_reworded']} | {r['us_undrawable']} | {r['pal_undrawable']} |")
	e = result["exe"]
	print(f"\n## EXE\n\nMetaDataCharacters US {e['characters']['us_address']} PAL {e['characters']['pal_address']}\n")
	for r in e["characters"]["records"]:
		if r["diff"]:
			print(f"- {r['name']} : {r['diff']}")
	m = e["metaPhys"]
	print(f"\nmetaPhys US {m['us_address']} ({m['us_classes']} classes) PAL {m['pal_address']} ({m['pal_classes']} classes)\n")
	print("| # | US off | PAL off | size | US B/A/S/T | PAL B/A/S/T | PAL class 4 |\n|---|---|---|---|---|---|---|")
	for r in m["records"]:
		flag = "" if not r["classes_differ"] else " **≠**"
		print(f"| {r['index']} | {r['us_offset']} | {r['pal_offset']} | {r['size']} | {r['us']} | {r['pal']}{flag} | {r['pal_class4']} |")
	print("\n## XNF\n")
	for side, d in result["xnf"].items():
		for code, x in d.items():
			print(f"- {side} {code} : {x['bytes']} bytes, numXA {x['numXA']}, numSongs {x['numSongs']}, firstSong {x['firstSongIndex']}, tracks {x['numAudioTracks_total']}, tail {x['tail_bytes']}")
	print("\n## XA song map (US id -> PAL id, by length)\n")
	for cat, r in result["xa_map_us_to_pal"].items():
		moved = sum(1 for i, j in enumerate(r["map"]) if j is not None and j != i)
		print(f"- {cat} : {len(r['map'])} US songs, {moved} at another id on PAL, unmatched US {r['unmatched_us']}, unused PAL {r['unused_pal']}, ambiguous lengths {r['ambiguous_lengths']}")
	v = result["voice_map_us_to_pal"]
	none = [k for k, j in v["map"].items() if j is None]
	print(f"\n## voiceData (GAME voice lines)\n\nUS {v['us_shape']} PAL {v['pal_shape']} ; voiceID US {v['us_voiceID']} PAL {v['pal_voiceID']} ; US ids without a PAL line : {none}")
	h = result["hwl"]
	print(f"\n## KART.HWL\n\nUS {h['us']['numOtherFX']} OtherFX / {h['us']['numBanks']} banks / {h['us']['numSequences']} seq ; PAL {h['pal']['numOtherFX']} / {h['pal']['numBanks']} / {h['pal']['numSequences']} ; OtherFX ops {h['otherfx_ops']} ; EngineFX same {h['engine_same']}")
	v = result["hwl_view"]
	print(f"\nSample map : conflicts {v['sample_conflicts'] or 'none'}, US samples unmatched {v['us_samples_unmatched'] or 'none'}\n")
	print("| language | OtherFX sample mismatches | English field mismatches | banks from PAL | banks assembled |\n|---|---|---|---|---|")
	for code, r in v["languages"].items():
		built = [n for n, b in enumerate(r["banks"]) if "samples" in b]
		print(f"| {code} | {len(r['fx_sample_mismatch'])} | {len(r['fx_field_mismatch'])} | {len(r['banks']) - len(built)} | {built} |")
	print(f"\n## STR\n\nUS {result['str']['us']} ; PAL {result['str']['pal']}")
	return 0


if __name__ == "__main__":
	sys.exit(main(sys.argv))
