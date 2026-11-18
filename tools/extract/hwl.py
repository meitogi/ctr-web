"""KART.HWL : the sound header, its tables, and the NTSC-U → PAL map the US executable needs.

Layout (`game/HOWL/HOWL_Load.c` howl_ParseHeader, `include/namespace_Howl.h`) : a 0x28-byte
HowlHeader, then numSpuAddrs SpuAddrEntry (addr, size in 8-byte units), numOtherFX and
numEngineFX 8-byte records, numBanks u16 bank sector offsets, numSequences u16 song sector
offsets. A bank (`game/HOWL/HOWL_Bank.c` Bank_AssignSpuAddrs) is one sector holding
SampleBlockHeader (numSamples, then that many spu indices), then the samples' bytes from the
next sector, back to back, each `spuSize * 8` bytes.

The US executable plays OtherFX by number and loads banks by number. The PAL file keeps the
same kinds of tables, re-laid for six languages : this module derives, from the two files'
content, the PAL OtherFX and the PAL samples each US number needs, per language.

PAL language index L (0 en, 1 fr, 2 de, 3 it, 4 es, 5 nl) : the PAL executable takes
`lang < 2 ? 0 : lang - 2` of its LNG slot (`ja en en2 fr de it es ne`) for both the OtherFX
block (OtherFX_Play_LowLevel adds 34 * L to ids 224..257) and its language banks (e.g. the
intro race bank 0x28 + L).
"""

import hashlib
import struct

HEADER = 0x28
SECTOR = 2048
LANGUAGES = ["en", "fr", "de", "it", "es", "nl"]

# OtherFX : the 34 language-dependent US effects (the 16 characters' two calls, ids 0x1c + c and
# 0x2c + c in HOWL_Voiceline.c, plus 167 and 209), in the order of a PAL block.
US_LANGUAGE_FX = list(range(28, 60)) + [167, 209]
PAL_LANGUAGE_FX_FIRST = 224


def parse(data):
	"""The header tables and every bank's samples ; raises ValueError on a malformed header."""
	if len(data) < HEADER:
		raise ValueError("HWL shorter than its header")
	_, _, _, _, n_spu, n_fx, n_engine, n_banks, n_seq, header_size = struct.unpack_from("<10i", data, 0)
	o = HEADER
	end = o + 4 * n_spu + 8 * (n_fx + n_engine) + 2 * (n_banks + n_seq)
	if min(n_spu, n_fx, n_engine, n_banks, n_seq) < 0 or end > len(data):
		raise ValueError(f"HWL header tables ({end} bytes) do not fit {len(data)} bytes")
	spu = [struct.unpack_from("<HH", data, o + 4 * i) for i in range(n_spu)]
	o += 4 * n_spu
	fx = [struct.unpack_from("<BBHHH", data, o + 8 * i) for i in range(n_fx)]
	o += 8 * n_fx
	engine = [struct.unpack_from("<BBHHH", data, o + 8 * i) for i in range(n_engine)]
	o += 8 * n_engine
	bank_offsets = list(struct.unpack_from(f"<{n_banks}H", data, o))
	o += 2 * n_banks
	songs = list(struct.unpack_from(f"<{n_seq}H", data, o))
	banks = []
	for sector in bank_offsets:
		at = sector * SECTOR
		(n,) = struct.unpack_from("<H", data, at)
		idx = list(struct.unpack_from(f"<{n}H", data, at + 2))
		pos = at + SECTOR
		samples = []
		for i in idx:
			size = spu[i][1] * 8
			samples.append((i, pos, size))
			pos += size
		if pos > len(data):
			raise ValueError(f"bank at sector {sector} runs past the file")
		banks.append({"sector": sector, "idx": idx, "samples": samples})
	return {"bytes": len(data), "header_size": header_size, "spu": spu, "fx": fx, "engine": engine, "banks": banks, "songs": songs}


def sample_hashes(data, h):
	"""spu index -> sha1 of its bytes, from the banks that hold it (the same bytes in each)."""
	out = {}
	for b in h["banks"]:
		for i, pos, size in b["samples"]:
			out.setdefault(i, hashlib.sha1(data[pos:pos + size]).hexdigest())
	return out


def otherfx_map(n_us, language):
	"""US OtherFX id -> PAL OtherFX id for a language index (session 1's map, by the ids)."""
	block = PAL_LANGUAGE_FX_FIRST + 34 * language
	out = []
	for k in range(n_us):
		if k < 28:
			out.append(k)
		elif k in US_LANGUAGE_FX:
			out.append(block + US_LANGUAGE_FX.index(k))
		elif k < 167:
			out.append(k - 32)
		elif k < 209:
			out.append(k - 33)
		else:
			out.append(k - 34)
	return out


def english_sample_map(us_data, us, pal_data, pal):
	"""US spu index -> PAL spu index for English, and the evidence.

	Three sources, in order : a US bank whose samples are, byte for byte and in order, a PAL
	bank's (position gives the index) ; the OtherFX map (a US effect's sample is the sample of
	the PAL effect it maps to) ; a sample whose bytes only one PAL index holds. Returns (map,
	conflicts, unmatched) : `conflicts` lists the indices where two sources disagree, which a
	proven map has none of ; `unmatched` the US indices no source gives."""
	us_hash, pal_hash = sample_hashes(us_data, us), sample_hashes(pal_data, pal)
	pal_by_hash = {}
	for j, digest in pal_hash.items():
		pal_by_hash.setdefault(digest, []).append(j)
	pal_by_sequence = {tuple(pal_hash[i] for i in b["idx"]): b["idx"] for b in pal["banks"]}
	out, conflicts = {}, []

	def take(i, j):
		if out.setdefault(i, j) != j and i not in conflicts:
			conflicts.append(i)

	for b in us["banks"]:
		match = pal_by_sequence.get(tuple(us_hash[i] for i in b["idx"]))
		if match is not None:
			for i, j in zip(b["idx"], match):
				take(i, j)
	fx = otherfx_map(len(us["fx"]), 0)
	for k, (_, _, _, i, _) in enumerate(us["fx"]):
		if i in us_hash:
			take(i, pal["fx"][fx[k]][3])
	for i, digest in us_hash.items():
		if i not in out and len(pal_by_hash.get(digest, [])) == 1:
			out[i] = pal_by_hash[digest][0]
	unmatched = sorted(i for i in us_hash if i not in out)
	return out, sorted(conflicts), unmatched


def language_sample_map(english, pal, language):
	"""The English map moved to a language : a PAL sample of the English OtherFX block becomes
	the sample at the same place in that language's block (every language-dependent PAL sample
	is in one of the six blocks)."""
	english_block = [pal["fx"][PAL_LANGUAGE_FX_FIRST + m][3] for m in range(len(US_LANGUAGE_FX))]
	block = [pal["fx"][PAL_LANGUAGE_FX_FIRST + 34 * language + m][3] for m in range(len(US_LANGUAGE_FX))]
	return {i: block[english_block.index(j)] if j in english_block else j for i, j in english.items()}


def view(us_data, pal_data):
	"""What a PAL KART.HWL must present, per language, for the US executable.

	Per language : `otherfx` (US id -> PAL OtherFX id), `banks` (US bank id -> {"pal": PAL bank
	id} when a PAL bank holds exactly the samples needed, else {"samples": [PAL spu indices],
	"from": [the PAL bank holding each]} to assemble), and the checks that prove it : every US OtherFX's sample maps to the sample
	of the PAL OtherFX it maps to (`fx_sample_mismatch`), every English OtherFX has the same
	flags / volume / pitch (`fx_field_mismatch`), no two sources of the sample map disagree
	(`sample_conflicts`), and the US samples nothing matches (`us_samples_unmatched`, left out of
	their banks)."""
	us, pal = parse(us_data), parse(pal_data)
	pal_banks = {tuple(b["idx"]): n for n, b in enumerate(pal["banks"])}
	holder = {}
	for n, b in enumerate(pal["banks"]):
		for j in b["idx"]:
			holder.setdefault(j, n)
	english, conflicts, unmatched = english_sample_map(us_data, us, pal_data, pal)
	out = {"us": {"spu": len(us["spu"]), "otherfx": len(us["fx"]), "banks": len(us["banks"]), "songs": len(us["songs"])},
		"pal": {"spu": len(pal["spu"]), "otherfx": len(pal["fx"]), "banks": len(pal["banks"]), "songs": len(pal["songs"])},
		"engine_same": [e[:3] for e in us["engine"]] == [e[:3] for e in pal["engine"][:len(us["engine"])]],
		"sample_conflicts": conflicts, "us_samples_unmatched": unmatched, "languages": {}}
	for language, code in enumerate(LANGUAGES):
		fx = otherfx_map(len(us["fx"]), language)
		samples = language_sample_map(english, pal, language)
		sample_mismatch = [k for k in range(len(us["fx"])) if samples.get(us["fx"][k][3]) != pal["fx"][fx[k]][3]]
		field_mismatch = [k for k in range(len(us["fx"])) if language == 0 and us["fx"][k][:3] != pal["fx"][fx[k]][:3]]
		banks = []
		for b in us["banks"]:
			need = [samples[i] for i in b["idx"] if i in samples]
			p = pal_banks.get(tuple(need))
			banks.append({"pal": p} if p is not None else {"samples": need, "from": [holder[j] for j in need]})
		out["languages"][code] = {"otherfx": fx, "banks": banks, "fx_sample_mismatch": sample_mismatch, "fx_field_mismatch": field_mismatch}
	return out
