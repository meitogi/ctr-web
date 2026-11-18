// The disc as the NTSC-U executable expects it, whatever the player dropped (browser builds,
// included by native_disc_image.c).
//
// A PAL disc (SCES-02105) keeps the US disc's files, but four tables the US executable
// addresses by number are laid out differently : the BIGFILE index, the LNG string ids, the
// XA song ids and the KART.HWL sound tables. This file presents those four files in the US
// layout, rewritten when the disc is opened, every entry still read from the dropped disc :
//   BIGFILE.BIG      its header in the 608-entry US layout, the language's copies of the
//                    inserted groups ; LNG slot 1 (the only one the executable loads) is the
//                    chosen language, appended after the file ;
//   XA/ENG.XNF       the language's XNF with a song table in US order ; XA/ENG/* is read
//                    from XA/<language>/* ;
//   SOUNDS/KART.HWL  its header with the OtherFX and banks in US order ; a US bank no PAL bank
//                    holds exactly is assembled from the PAL samples, appended after the file.
// The maps come from both discs' data (tools/extract, web_disc_view_maps.h). A US disc goes
// through untouched, except LNG slot 1 when another language is chosen.
//
// The European font codes the US font draws blank (the Ñ tilde marker, ", ¡, ¿, º) are
// replaced by close US glyphs in the served LNG ; the faithful font is a change of the game.

#include "web_disc_view_maps.h"

#define WEB_DISC_VIEW_LBA_BASE   WEB_DISC_VIEW_LBA_FIRST // past any disc : a view file's sectors
#define WEB_DISC_VIEW_LBA_SPAN   0x00100000u
#define WEB_DISC_VIEW_SECTOR     NATIVE_DISC_IMAGE_FORM1_DATA_SIZE
#define WEB_DISC_VIEW_LNG_MAX    0x3f04 // the executable's LNG buffer (game/zGlobal_SDATA.c, langBufferSize)
#define WEB_DISC_VIEW_HWL_HEADER 0x28
#define WEB_DISC_VIEW_XNF_HEADER 0x44
#define WEB_DISC_VIEW_MAX_PARTS  8

enum
{
	WEB_DISC_VIEW_BIGFILE,
	WEB_DISC_VIEW_HWL,
	WEB_DISC_VIEW_XNF,
	WEB_DISC_VIEW_FILES,
};

// A view file : sectors [0, headSectors) from `head`, then the disc file's own sectors up to
// realSectors, then appended parts. An assembled bank's part is built on its first read.
struct WebDiscViewPart
{
	u32 first;
	u32 count;
	u8 *data;
	int assembled; // -1, or the k of s_webViewAssembledAt
};

struct WebDiscViewFile
{
	int active;
	struct NativeDiscImageFile real;
	u32 size;
	u8 *head;
	u32 headSectors;
	u32 realSectors;
	u32 palBanksAt; // KART.HWL : where the PAL bank offsets sit in the disc's file
	u32 numParts;
	struct WebDiscViewPart parts[WEB_DISC_VIEW_MAX_PARTS];
};

global_variable const char *s_webViewPaths[WEB_DISC_VIEW_FILES] = {"BIGFILE.BIG", "SOUNDS/KART.HWL", "XA/ENG.XNF"};
global_variable const char *s_webViewXaCodes[WEB_DISC_VIEW_LANGUAGES] = {"ENG", "FRN", "GRM", "ITL", "SPN", "DCH"};
global_variable struct WebDiscViewFile s_webViewFiles[WEB_DISC_VIEW_FILES];
global_variable int s_webViewReady;
global_variable int s_webViewPal;
global_variable int s_webViewLanguage; // 0 en, 1 fr, 2 de, 3 it, 4 es, 5 nl
global_variable char s_webViewLastXa[64]; // the last XA file opened, as read (the tests' __ctr.disc)

// The page's choice (web/ui/src/lib/language.js) : one of the codes above, else English.
EM_JS(int, CTRWeb_DiscLanguage, (void), {
	var codes = ['en', 'fr', 'de', 'it', 'es', 'nl'];
	var i = codes.indexOf(globalThis.__ctrLang);
	return i < 0 ? 0 : i;
});

internal u32 WebDiscView_LE32(const u8 *p)
{
	return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24);
}

internal u16 WebDiscView_LE16(const u8 *p)
{
	return (u16)(p[0] | (p[1] << 8));
}

internal void WebDiscView_Put32(u8 *p, u32 v)
{
	p[0] = (u8)v;
	p[1] = (u8)(v >> 8);
	p[2] = (u8)(v >> 16);
	p[3] = (u8)(v >> 24);
}

internal void WebDiscView_Put16(u8 *p, u32 v)
{
	p[0] = (u8)v;
	p[1] = (u8)(v >> 8);
}

internal u32 WebDiscView_Sectors(u32 bytes)
{
	return (bytes + WEB_DISC_VIEW_SECTOR - 1) / WEB_DISC_VIEW_SECTOR;
}

// Reads a whole file of the disc ; NULL on failure. The caller frees.
internal u8 *WebDiscView_ReadReal(const struct NativeDiscImageFile *file, u32 offset, u32 size)
{
	u8 *data = (u8 *)malloc(size ? size : 1);

	if ((data != NULL) && !NativeDiscImage_ReadDataBytes(file, offset, data, size))
	{
		free(data);
		data = NULL;
	}

	return data;
}

internal int WebDiscView_AddPart(struct WebDiscViewFile *view, u8 *data, u32 bytes, int assembled, u32 *firstSectorOut)
{
	u32 first = view->realSectors;

	if (view->numParts == WEB_DISC_VIEW_MAX_PARTS)
	{
		return 0;
	}

	for (u32 i = 0; i < view->numParts; i++)
	{
		first = view->parts[i].first + view->parts[i].count;
	}

	view->parts[view->numParts].first = first;
	view->parts[view->numParts].count = WebDiscView_Sectors(bytes);
	view->parts[view->numParts].data = data;
	view->parts[view->numParts].assembled = assembled;
	view->numParts++;
	view->size = (first + WebDiscView_Sectors(bytes)) * WEB_DISC_VIEW_SECTOR;
	*firstSectorOut = first;
	return 1;
}

// ---- LNG ----

// A European font code the US font has no glyph for, as the closest US glyph (0 : dropped).
internal u8 WebDiscView_UsGlyph(u8 c)
{
	switch (c)
	{
	case 0x03: // tilde over the next letter (Ñ)
	case '#':  // ¡
	case '$':  // ¿
		return 0;
	case '&': // º
		return '.';
	case '"':
		return '\'';
	default:
		return c;
	}
}

// The language's LNG in US string order and US glyphs ; NULL if it does not fit the
// executable's buffer.
internal u8 *WebDiscView_BuildLng(const u8 *src, u32 srcSize, u32 *sizeOut)
{
	u32 count;
	u32 table;
	u32 strings = WEB_DISC_VIEW_LNG_STRINGS;
	u32 tableAt;
	u32 at = 8;
	u8 *out;

	if (srcSize < 8)
	{
		return NULL;
	}

	count = WebDiscView_LE32(src);
	table = WebDiscView_LE32(src + 4);
	if ((table > srcSize) || (count > (srcSize - table) / 4) || (count < strings))
	{
		return NULL;
	}

	out = (u8 *)calloc(WebDiscView_Sectors(WEB_DISC_VIEW_LNG_MAX), WEB_DISC_VIEW_SECTOR); // read back whole sectors
	if (out == NULL)
	{
		return NULL;
	}

	tableAt = WEB_DISC_VIEW_LNG_MAX - 4 * strings;
	for (u32 i = 0; i < strings; i++)
	{
		u32 id = s_webViewPal ? s_webViewLng[i] : i;
		u32 from = (id < count) ? WebDiscView_LE32(src + table + 4 * id) : srcSize;

		WebDiscView_Put32(out + tableAt + 4 * i, at);
		for (; (from < srcSize) && (src[from] != 0); from++)
		{
			u8 c = WebDiscView_UsGlyph(src[from]);

			if (c == 0)
			{
				continue;
			}
			if (at + 1 >= tableAt)
			{
				free(out);
				return NULL;
			}
			out[at++] = c;
		}
		if (at >= tableAt)
		{
			free(out);
			return NULL;
		}
		out[at++] = 0;
	}

	// The pointer table right after the strings, word-aligned.
	at = (at + 3) & ~3u;
	memmove(out + at, out + tableAt, 4 * strings);
	WebDiscView_Put32(out, strings);
	WebDiscView_Put32(out + 4, at);
	*sizeOut = at + 4 * strings;
	return out;
}

// ---- BIGFILE ----

internal int WebDiscView_BuildBigfile(struct WebDiscViewFile *view)
{
	u32 lngSlot = (s_webViewLanguage == 0) ? 1 : (u32)s_webViewLanguage + 2; // LNG slots : ja en en2 fr de it es ne
	u32 headBytes = 3 * WEB_DISC_VIEW_SECTOR;
	u8 *header;
	u8 *lngSrc;
	u8 *lng;
	u32 numEntry;
	u32 firstData = 0xffffffffu;
	u32 lngSize;
	u32 lngSector;

	header = WebDiscView_ReadReal(&view->real, 0, headBytes);
	if (header == NULL)
	{
		return 0;
	}

	numEntry = WebDiscView_LE32(header + 4);
	if (numEntry > (headBytes - 8) / 8)
	{
		free(header);
		return 0;
	}
	for (u32 i = 0; i < numEntry; i++)
	{
		u32 offset = WebDiscView_LE32(header + 8 + 8 * i);
		firstData = (offset < firstData) ? offset : firstData;
	}

	// The US layout : the header must fit before the first entry's data.
	if ((firstData == 0) || (firstData > 3) || (8 + 8 * WEB_DISC_VIEW_BIG_ENTRIES > firstData * WEB_DISC_VIEW_SECTOR) ||
	    (numEntry != (s_webViewPal ? 723u : (u32)WEB_DISC_VIEW_BIG_ENTRIES)))
	{
		free(header);
		return 0;
	}

	{
		// LNG entries are not language copies : the same PAL index in every language's map.
		u32 entry = s_webViewPal ? s_webViewBigfile[BI_LANGUAGEFILE + lngSlot] : BI_LANGUAGEFILE + lngSlot;
		u32 offset = WebDiscView_LE32(header + 8 + 8 * entry);
		u32 size = WebDiscView_LE32(header + 12 + 8 * entry);

		lngSrc = WebDiscView_ReadReal(&view->real, offset * WEB_DISC_VIEW_SECTOR, size);
		lng = (lngSrc != NULL) ? WebDiscView_BuildLng(lngSrc, size, &lngSize) : NULL;
		free(lngSrc);
	}
	if (lng == NULL)
	{
		free(header);
		return 0;
	}

	view->head = (u8 *)calloc(firstData, WEB_DISC_VIEW_SECTOR);
	view->headSectors = firstData;
	view->realSectors = WebDiscView_Sectors(view->real.size);
	view->size = view->realSectors * WEB_DISC_VIEW_SECTOR;
	if ((view->head == NULL) || !WebDiscView_AddPart(view, lng, lngSize, -1, &lngSector))
	{
		free(header);
		free(lng);
		return 0;
	}

	WebDiscView_Put32(view->head + 4, WEB_DISC_VIEW_BIG_ENTRIES);
	for (u32 u = 0; u < WEB_DISC_VIEW_BIG_ENTRIES; u++)
	{
		u32 from = s_webViewPal ? s_webViewBigfile[WEB_DISC_VIEW_BIG_ENTRIES * s_webViewLanguage + u] : u;

		memcpy(view->head + 8 + 8 * u, header + 8 + 8 * from, 8);
	}
	WebDiscView_Put32(view->head + 8 + 8 * (BI_LANGUAGEFILE + 1), lngSector);
	WebDiscView_Put32(view->head + 12 + 8 * (BI_LANGUAGEFILE + 1), lngSize);

	free(header);
	return 1;
}

// ---- XNF ----

internal int WebDiscView_BuildXnf(struct WebDiscViewFile *view)
{
	local_persist const s16 *maps[3] = {s_webViewXaMusic, s_webViewXaExtra, s_webViewXaGame};
	local_persist const u32 counts[3] = {sizeof(s_webViewXaMusic) / sizeof(s16), sizeof(s_webViewXaExtra) / sizeof(s16), sizeof(s_webViewXaGame) / sizeof(s16)};
	char path[16];
	struct NativeDiscImageFile file;
	u8 *src;
	u8 *out;
	u32 numXAs;
	u32 numTracks;
	u32 songsAt;
	u32 total = counts[0] + counts[1] + counts[2];
	u32 first = 0;

	snprintf(path, sizeof(path), "XA/%s.XNF", s_webViewXaCodes[s_webViewLanguage]);
	if (!NativeDiscImage_FindFile(path, &file) || (file.size < WEB_DISC_VIEW_XNF_HEADER))
	{
		return 0;
	}

	src = WebDiscView_ReadReal(&file, 0, file.size);
	if (src == NULL)
	{
		return 0;
	}

	numXAs = WebDiscView_LE32(src + 0x0c);
	numTracks = WebDiscView_LE32(src + 0x10);
	songsAt = WEB_DISC_VIEW_XNF_HEADER + 4 * numXAs;
	if ((WebDiscView_LE32(src + 8) != 3) || (numXAs > file.size / 4) || (songsAt + 4 * numTracks > file.size))
	{
		free(src);
		return 0;
	}

	view->size = songsAt + 4 * total;
	out = (u8 *)calloc(WebDiscView_Sectors(view->size), WEB_DISC_VIEW_SECTOR);
	if (out == NULL)
	{
		free(src);
		return 0;
	}

	// Same files and channels (numXA, firstXaIndex, positions), a US-ordered song table.
	memcpy(out, src, songsAt);
	WebDiscView_Put32(out + 0x10, total);
	for (u32 c = 0; c < 3; c++)
	{
		u32 palFirst = WebDiscView_LE32(src + 0x38 + 4 * c);
		u32 palCount = WebDiscView_LE32(src + 0x2c + 4 * c);

		WebDiscView_Put32(out + 0x2c + 4 * c, counts[c]);
		WebDiscView_Put32(out + 0x38 + 4 * c, first);
		for (u32 i = 0; i < counts[c]; i++)
		{
			s32 j = maps[c][i];

			// A US song with no PAL counterpart : an empty entry, silence.
			if ((j >= 0) && ((u32)j < palCount) && (palFirst + (u32)j < numTracks))
			{
				memcpy(out + songsAt + 4 * (first + i), src + songsAt + 4 * (palFirst + (u32)j), 4);
			}
		}
		first += counts[c];
	}

	free(src);
	view->head = out;
	view->headSectors = WebDiscView_Sectors(view->size);
	view->realSectors = view->headSectors;
	return 1;
}

// ---- KART.HWL ----

internal int WebDiscView_BuildHwl(struct WebDiscViewFile *view)
{
	const u16 *otherFX = &s_webViewOtherFX[WEB_DISC_VIEW_OTHERFX * s_webViewLanguage];
	const s16 *banks = &s_webViewBanks[WEB_DISC_VIEW_BANKS * s_webViewLanguage];
	u8 first[WEB_DISC_VIEW_HWL_HEADER];
	u8 *src;
	u8 *out;
	u32 srcSize;
	u32 numSpu, numFX, numEngine, numBanks, numSongs;
	u32 outSize;
	u8 *w;

	if (!NativeDiscImage_ReadDataBytes(&view->real, 0, first, sizeof(first)))
	{
		return 0;
	}

	srcSize = WEB_DISC_VIEW_HWL_HEADER + WebDiscView_LE32(first + 0x24);
	numSpu = WebDiscView_LE32(first + 0x10);
	numFX = WebDiscView_LE32(first + 0x14);
	numEngine = WebDiscView_LE32(first + 0x18);
	numBanks = WebDiscView_LE32(first + 0x1c);
	numSongs = WebDiscView_LE32(first + 0x20);
	if ((numFX != 428) || (numBanks != 172) || (srcSize != WEB_DISC_VIEW_HWL_HEADER + 4 * numSpu + 8 * (numFX + numEngine) + 2 * (numBanks + numSongs)))
	{
		return 0;
	}

	src = WebDiscView_ReadReal(&view->real, 0, srcSize);
	if (src == NULL)
	{
		return 0;
	}

	outSize = WEB_DISC_VIEW_HWL_HEADER + 4 * numSpu + 8 * (WEB_DISC_VIEW_OTHERFX + numEngine) + 2 * (WEB_DISC_VIEW_BANKS + numSongs);
	view->headSectors = WebDiscView_Sectors(srcSize);
	view->realSectors = WebDiscView_Sectors(view->real.size);
	view->size = view->realSectors * WEB_DISC_VIEW_SECTOR;
	view->head = (u8 *)calloc(view->headSectors, WEB_DISC_VIEW_SECTOR);
	out = view->head;
	if (out == NULL)
	{
		free(src);
		return 0;
	}

	{
		const u8 *spu = src + WEB_DISC_VIEW_HWL_HEADER;
		const u8 *fx = spu + 4 * numSpu;
		const u8 *engine = fx + 8 * numFX;
		const u8 *bankOffsets = engine + 8 * numEngine;
		const u8 *songs = bankOffsets + 2 * numBanks;

		view->palBanksAt = (u32)(bankOffsets - src);

		memcpy(out, src, WEB_DISC_VIEW_HWL_HEADER);
		WebDiscView_Put32(out + 0x14, WEB_DISC_VIEW_OTHERFX);
		WebDiscView_Put32(out + 0x1c, WEB_DISC_VIEW_BANKS);
		WebDiscView_Put32(out + 0x24, outSize - WEB_DISC_VIEW_HWL_HEADER);
		w = out + WEB_DISC_VIEW_HWL_HEADER;
		memcpy(w, spu, 4 * numSpu);
		w += 4 * numSpu;
		for (u32 k = 0; k < WEB_DISC_VIEW_OTHERFX; k++, w += 8)
		{
			memcpy(w, fx + 8 * otherFX[k], 8);
		}
		memcpy(w, engine, 8 * numEngine);
		w += 8 * numEngine;
		for (u32 b = 0; b < WEB_DISC_VIEW_BANKS; b++, w += 2)
		{
			if (banks[b] >= 0)
			{
				memcpy(w, bankOffsets + 2 * banks[b], 2);
			}
			else
			{
				// Assembled : a sample block header sector, then the samples' bytes.
				u32 k = (u32)(-2 - banks[b]);
				const u16 *list = &s_webViewAssembled[s_webViewAssembledAt[k]];
				u32 bytes = WEB_DISC_VIEW_SECTOR;
				u32 sector;

				for (u32 n = 0; n < list[0]; n++)
				{
					bytes += 8 * (u32)WebDiscView_LE16(spu + 4 * list[1 + 2 * n] + 2);
				}
				if (!WebDiscView_AddPart(view, NULL, bytes, (int)k, &sector) || (sector > 0xffff))
				{
					free(src);
					return 0;
				}
				WebDiscView_Put16(w, sector);
			}
		}
		memcpy(w, songs, 2 * numSongs);
	}

	free(src);
	return 1;
}

// An assembled bank's bytes : the sample block header (count, spu indices), then each sample
// from the PAL bank that holds it.
internal u8 *WebDiscView_AssembleBank(const struct WebDiscViewFile *view, const struct WebDiscViewPart *part)
{
	const u16 *list = &s_webViewAssembled[s_webViewAssembledAt[part->assembled]];
	const u8 *spu = view->head + WEB_DISC_VIEW_HWL_HEADER;
	u8 *out = (u8 *)calloc(part->count, WEB_DISC_VIEW_SECTOR);
	u8 blockHeader[WEB_DISC_VIEW_SECTOR];
	u32 at = WEB_DISC_VIEW_SECTOR;

	if (out == NULL)
	{
		return NULL;
	}

	WebDiscView_Put16(out, list[0]);
	for (u32 n = 0; n < list[0]; n++)
	{
		u32 j = list[1 + 2 * n];
		u32 bank = list[2 + 2 * n];
		u32 bankSector;
		u32 offset = 0;
		u32 numSamples;
		int found = 0;

		WebDiscView_Put16(out + 2 + 2 * n, j);

		// The PAL bank offsets are not in the view's header : read the disc's own entry.
		if (!NativeDiscImage_ReadDataBytes(&view->real, view->palBanksAt + 2 * bank, blockHeader, 2))
		{
			free(out);
			return NULL;
		}
		bankSector = WebDiscView_LE16(blockHeader);
		if (!NativeDiscImage_ReadDataBytes(&view->real, bankSector * WEB_DISC_VIEW_SECTOR, blockHeader, WEB_DISC_VIEW_SECTOR))
		{
			free(out);
			return NULL;
		}
		numSamples = WebDiscView_LE16(blockHeader);
		for (u32 s = 0; (s < numSamples) && (s < WEB_DISC_VIEW_SECTOR / 2 - 1); s++)
		{
			u32 i = WebDiscView_LE16(blockHeader + 2 + 2 * s);

			if (i == j)
			{
				found = 1;
				break;
			}
			offset += 8 * (u32)WebDiscView_LE16(spu + 4 * i + 2);
		}

		{
			u32 size = 8 * (u32)WebDiscView_LE16(spu + 4 * j + 2);

			if (!found || (at + size > part->count * WEB_DISC_VIEW_SECTOR) ||
			    !NativeDiscImage_ReadDataBytes(&view->real, (bankSector + 1) * WEB_DISC_VIEW_SECTOR + offset, out + at, size))
			{
				free(out);
				return NULL;
			}
			at += size;
		}
	}

	return out;
}

// ---- the hooks ----

internal int WebDiscView_ReadDataSector(u32 lba, u8 *payload)
{
	u32 index = (lba - WEB_DISC_VIEW_LBA_BASE) / WEB_DISC_VIEW_LBA_SPAN;
	u32 sector = (lba - WEB_DISC_VIEW_LBA_BASE) % WEB_DISC_VIEW_LBA_SPAN;
	struct WebDiscViewFile *view;

	if ((index >= WEB_DISC_VIEW_FILES) || !s_webViewFiles[index].active)
	{
		return 0;
	}

	view = &s_webViewFiles[index];
	if (sector < view->headSectors)
	{
		memcpy(payload, view->head + sector * WEB_DISC_VIEW_SECTOR, WEB_DISC_VIEW_SECTOR);
		return 1;
	}
	if (sector < view->realSectors)
	{
		return NativeDiscImage_ReadDataSector(view->real.lba + sector, payload);
	}
	for (u32 i = 0; i < view->numParts; i++)
	{
		struct WebDiscViewPart *part = &view->parts[i];

		if ((sector >= part->first) && (sector < part->first + part->count))
		{
			if ((part->data == NULL) && (part->assembled >= 0))
			{
				part->data = WebDiscView_AssembleBank(view, part);
			}
			if (part->data == NULL)
			{
				return 0;
			}
			memcpy(payload, part->data + (sector - part->first) * WEB_DISC_VIEW_SECTOR, WEB_DISC_VIEW_SECTOR);
			return 1;
		}
	}

	return 0;
}

// A raw (2352-byte) read of a view file : only the disc file's own sectors have one (the track
// previews are BIGFILE entries read raw, native_str.c) ; the rewritten head and parts do not.
internal u32 WebDiscView_RawLba(u32 lba)
{
	u32 index = (lba - WEB_DISC_VIEW_LBA_BASE) / WEB_DISC_VIEW_LBA_SPAN;
	u32 sector = (lba - WEB_DISC_VIEW_LBA_BASE) % WEB_DISC_VIEW_LBA_SPAN;

	if ((index >= WEB_DISC_VIEW_FILES) || !s_webViewFiles[index].active || (sector < s_webViewFiles[index].headSectors) ||
	    (sector >= s_webViewFiles[index].realSectors))
	{
		return 0xffffffffu;
	}

	return s_webViewFiles[index].real.lba + sector;
}

// Compares a disc path with a view path, ignoring case, the leading separators and the
// separator kind.
internal int WebDiscView_PathIs(const char *path, const char *want, size_t wantLen, int prefix)
{
	size_t i;

	while ((*path == '/') || (*path == '\\'))
	{
		path++;
	}
	for (i = 0; i < wantLen; i++)
	{
		char a = path[i];
		char b = want[i];

		a = (a == '\\') ? '/' : ((a >= 'a') && (a <= 'z')) ? (char)(a - 32) : a;
		if ((a == 0) || (a != b))
		{
			return 0;
		}
	}

	return prefix || (path[i] == 0) || (path[i] == ';');
}

// 1 : `path` is a view file (fileOut set) ; -1 : read `alias` instead ; 0 : untouched.
internal int WebDiscView_FindFile(const char *path, struct NativeDiscImageFile *fileOut, char *alias, size_t aliasSize)
{
	if (path == NULL)
	{
		return 0;
	}

	for (u32 i = 0; s_webViewReady && (i < WEB_DISC_VIEW_FILES); i++)
	{
		if (s_webViewFiles[i].active && WebDiscView_PathIs(path, s_webViewPaths[i], strlen(s_webViewPaths[i]), 0))
		{
			fileOut->lba = WEB_DISC_VIEW_LBA_BASE + i * WEB_DISC_VIEW_LBA_SPAN;
			fileOut->size = s_webViewFiles[i].size;
			return 1;
		}
	}

	while ((*path == '/') || (*path == '\\'))
	{
		path++;
	}
	if (s_webViewReady && s_webViewPal && (s_webViewLanguage != 0) && WebDiscView_PathIs(path, "XA/ENG/", 7, 1))
	{
		int written = snprintf(alias, aliasSize, "XA/%s/%s", s_webViewXaCodes[s_webViewLanguage], path + 7);
		if ((written <= 0) || ((size_t)written >= aliasSize))
		{
			return 0;
		}
		snprintf(s_webViewLastXa, sizeof(s_webViewLastXa), "%s", alias);
		return -1;
	}
	if (WebDiscView_PathIs(path, "XA/", 3, 1) && (strchr(path, '.') != NULL) && (strstr(path, ".XNF") == NULL))
	{
		snprintf(s_webViewLastXa, sizeof(s_webViewLastXa), "%s", path);
	}

	return 0;
}

internal void WebDiscView_Free(void)
{
	for (u32 i = 0; i < WEB_DISC_VIEW_FILES; i++)
	{
		free(s_webViewFiles[i].head);
		for (u32 p = 0; p < s_webViewFiles[i].numParts; p++)
		{
			free(s_webViewFiles[i].parts[p].data);
		}
	}
	memset(s_webViewFiles, 0, sizeof(s_webViewFiles));
	s_webViewReady = 0;
}

// Called once the disc is open : detects the region, builds the views for the chosen language.
internal void WebDiscView_Init(void)
{
	struct NativeDiscImageFile exe;
	int ok = 1;

	WebDiscView_Free();
	s_webViewPal = NativeDiscImage_FindFile("SCES_021.05", &exe);
	s_webViewLanguage = CTRWeb_DiscLanguage();

	if (!s_webViewPal && (s_webViewLanguage == 0))
	{
		return; // the US disc in English : as it is
	}

	for (u32 i = 0; i < WEB_DISC_VIEW_FILES; i++)
	{
		struct WebDiscViewFile *view = &s_webViewFiles[i];

		// On a US disc only the language changes : the BIGFILE's LNG slot.
		if (!s_webViewPal && (i != WEB_DISC_VIEW_BIGFILE))
		{
			continue;
		}
		if ((i != WEB_DISC_VIEW_XNF) && !NativeDiscImage_FindFile(s_webViewPaths[i], &view->real))
		{
			ok = 0;
			break;
		}

		ok = (i == WEB_DISC_VIEW_BIGFILE) ? WebDiscView_BuildBigfile(view) : (i == WEB_DISC_VIEW_HWL) ? WebDiscView_BuildHwl(view) : WebDiscView_BuildXnf(view);
		if (!ok)
		{
			break;
		}
		view->active = 1;
	}

	if (!ok)
	{
		fprintf(stderr, "[CTR Web] the %s disc's US view could not be built : read as it is\n", s_webViewPal ? "PAL" : "US");
		WebDiscView_Free();
		return;
	}

	fprintf(stderr, "[CTR Web] %s disc, language %s\n", s_webViewPal ? "PAL" : "US", s_webViewXaCodes[s_webViewLanguage]);
	s_webViewReady = 1;
}
