// What the player dropped → the disc image to store : a raw .bin as is, or the .bin inside a .zip.
// Every candidate goes through the same probeDisc (web/disc.js : raw MODE2/2352 size, sector
// sync, an NTSC-U or PAL serial in SYSTEM.CNF) before a byte is copied.
//
// In a zip : one .bin → that one (a .cue beside it is ignored) ; several → the first, largest
// first, that probes, an NTSC-U one before a PAL one (the other is dropped on its own) ; none →
// 'zip-no-bin'. A refused candidate gives its own reason
// (region, size…) when nothing else passes.
import { ZipError, entryView, openEntry, readZipDirectory } from './zip.js'

const isBin = (name) => /\.bin$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name)

async function looksLikeZip(file) {
  if (/\.zip$/i.test(file.name ?? '')) return true
  if (file.size < 4) return false
  const b = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/**
 * @param {File|Blob} file - what was dropped or picked
 * @param {(f: Blob) => Promise<{ok: boolean, reason?: string, message?: string, serial?: string, region?: 'us'|'pal'}>} probeDisc
 * @returns {Promise<{ok: true, kind: 'bin'|'zip', serial: string, region: 'us'|'pal', name: string, size: number, source?: string, open: () => Promise<ReadableStream<Uint8Array>>}
 *                 | {ok: false, reason: string, message: string, serial?: string}>}
 */
export async function resolveDisc(file, probeDisc) {
  if (!(await looksLikeZip(file))) {
    const probe = await probeDisc(file)
    if (!probe.ok) return probe
    return { ok: true, kind: 'bin', serial: probe.serial, region: probe.region, name: file.name, size: file.size, open: async () => file.stream() }
  }
  let entries
  try {
    entries = await readZipDirectory(file)
  } catch (e) {
    if (e instanceof ZipError) return { ok: false, reason: `zip-${e.code}`, message: e.message }
    throw e
  }
  const bins = entries.filter((e) => !e.directory && isBin(e.name)).sort((a, b) => b.size - a.size)
  if (!bins.length) return { ok: false, reason: 'zip-no-bin', message: 'There is no .bin disc image in this archive.' }
  let firstFailure = null
  let pal = null
  for (const entry of bins) {
    let view
    try {
      view = await entryView(file, entry)
      const probe = await probeDisc(view)
      if (probe.ok) {
        const found = {
          ok: true, kind: 'zip', serial: probe.serial, region: probe.region, name: view.name, size: entry.size, source: file.name,
          open: () => openEntry(file, entry),
        }
        if (probe.region === 'us') return found
        pal ??= found
        continue
      }
      firstFailure ??= probe
    } catch (e) {
      if (!(e instanceof ZipError)) throw e
      firstFailure ??= { ok: false, reason: `zip-${e.code}`, message: e.message }
    } finally {
      view?.close?.()
    }
  }
  return pal ?? firstFailure
}
