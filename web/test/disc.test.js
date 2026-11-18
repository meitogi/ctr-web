// node --test web/test/disc.test.js
//
// Builds a minimal synthetic raw MODE2/2352 disc (PVD at LBA 16, a root
// directory at LBA 17 with one SYSTEM.CNF entry at LBA 18) entirely in
// memory and runs it through disc.js's probeDisc(), the same function the
// drop zone uses on a real ctr-u.bin. No DOM, no OPFS — just Node's global
// Blob/File (Node 20+) backing the byte slicing probeDisc() does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRawSectorHeader, probeDisc } from '../disc.js';
import { PAL_SERIAL } from '../disc.js';
import { CNF_LBA, EXPECTED_SERIAL, ROOT_LBA, buildDisc, formDataOffset, writeDirRecord } from './fixtures.js';

const RAW_SECTOR_SIZE = 2352;

test('checkRawSectorHeader accepts a well-formed MODE2/2352 sync pattern', () => {
  const sector = new Uint8Array(RAW_SECTOR_SIZE);
  sector[11] = 0x00;
  sector[15] = 0x02;
  for (let i = 1; i < 11; i++) sector[i] = 0xff;
  assert.equal(checkRawSectorHeader(sector), true);
});

test('checkRawSectorHeader rejects a corrupt sync pattern', () => {
  const sector = new Uint8Array(RAW_SECTOR_SIZE);
  assert.equal(checkRawSectorHeader(sector), false);
});

test('probeDisc accepts a valid synthetic NTSC-U disc', async () => {
  const result = await probeDisc(buildDisc());
  assert.deepEqual(result, { ok: true, serial: EXPECTED_SERIAL, region: 'us' });
});

test('probeDisc accepts the PAL disc (SCES-02105), region detected from SYSTEM.CNF', async () => {
  const result = await probeDisc(buildDisc({ serial: PAL_SERIAL, name: 'Crash Team Racing (Europe).bin' }));
  assert.deepEqual(result, { ok: true, serial: PAL_SERIAL, region: 'pal' });
});

test('probeDisc rejects a cooked .iso of the PAL disc too', async () => {
  const file = buildDisc({ serial: PAL_SERIAL });
  const cooked = new File([await file.arrayBuffer().then((b) => b.slice(0, file.size - 304))], 'ctr-pal.iso');
  const result = await probeDisc(cooked);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'size');
});

test('probeDisc rejects a size that is not a multiple of 2352 (cooked .iso)', async () => {
  const file = buildDisc();
  const truncated = new File([await file.arrayBuffer().then((b) => b.slice(0, file.size - 1))], 'ctr.iso');
  const result = await probeDisc(truncated);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'size');
});

test('probeDisc rejects a bad raw-sector sync pattern', async () => {
  const buf = new Uint8Array(await buildDisc().arrayBuffer());
  buf[16 * RAW_SECTOR_SIZE] = 0xaa; // corrupt the PVD sector's sync byte
  const result = await probeDisc(new File([buf], 'ctr-u.bin'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'format');
});

test('probeDisc rejects another serial (another game, another release)', async () => {
  const result = await probeDisc(buildDisc({ serial: 'SCES_123.45' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'region');
  assert.match(result.message, /SCES_123\.45/);
});

test('probeDisc rejects a disc with no SYSTEM.CNF at the root', async () => {
  // A disc whose root entry name does not match SYSTEM.CNF at all.
  const bytes = new Uint8Array(await buildDisc().arrayBuffer());
  const root = formDataOffset(ROOT_LBA);
  writeDirRecord(bytes, root, { lba: CNF_LBA, size: 10, flags: 0x00, name: 'OTHER.TXT;1' });
  const probed = await probeDisc(new File([bytes], 'ctr-u.bin'));
  assert.equal(probed.ok, false);
  assert.equal(probed.reason, 'missing-system-cnf');
});
