import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { editImageMetadata } from '../src/metadata-editor.js';
import { MetadataRemovalError, removeMetadata } from '../src/metadata-remover.js';
import { viewMetadata } from '../src/metadata-viewer.js';

function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function writeEntry(buffer, offset, tag, type, count, value) {
  buffer.writeUInt16LE(tag, offset);
  buffer.writeUInt16LE(type, offset + 2);
  buffer.writeUInt32LE(count, offset + 4);
  if (type === 3 && count === 1) buffer.writeUInt16LE(value, offset + 8);
  else buffer.writeUInt32LE(value, offset + 8);
}

function editableTiff(orientation = 1) {
  const tiff = Buffer.alloc(240);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(5, 8);
  writeEntry(tiff, 10, 0x010e, 2, 32, 80);
  writeEntry(tiff, 22, 0x013b, 2, 24, 112);
  writeEntry(tiff, 34, 0x8298, 2, 32, 136);
  writeEntry(tiff, 46, 0x0132, 2, 20, 168);
  writeEntry(tiff, 58, 0x0112, 3, 1, orientation);
  tiff.writeUInt32LE(0, 70);
  tiff.write('Private launch photo\0', 80, 'ascii');
  tiff.write('Private Studio\0', 112, 'ascii');
  tiff.write('Copyright Private 2026\0', 136, 'ascii');
  tiff.write('2026:08:29 09:30:00\0', 168, 'ascii');
  return tiff;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function pngWithChunks(...chunks) {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, pngChunk('IEND')]);
}

function webpChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function webpWithChunks(...chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertEditedExifCrc(png) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (type === 'eXIf') {
      assert.equal(png.readUInt32BE(dataEnd), crc32(png.subarray(offset + 4, dataEnd)));
      return;
    }
    offset = dataEnd + 4;
  }
  assert.fail('PNG fixture did not contain eXIf.');
}

function imageFixture(format, orientation = 1) {
  const tiff = editableTiff(orientation);
  if (format === 'JPEG') {
    return Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])),
      jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>private xmp</x:xmpmeta>')),
      jpegSegment(0xed, Buffer.from('private iptc')),
      jpegSegment(0xfe, Buffer.from('private comment')),
      jpegSegment(0xeb, Buffer.from('private jumbf')),
      jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0preserved color')),
      Buffer.from([0xff, 0xda, 0x00, 0x02, 0x01, 0x02, 0x03, 0xff, 0xd9]),
    ]);
  }
  if (format === 'PNG') {
    return pngWithChunks(
      pngChunk('eXIf', tiff),
      pngChunk('tEXt', Buffer.from('Comment\0private text')),
      pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>private xmp</x:xmpmeta>')),
      pngChunk('caBX', Buffer.from('private c2pa')),
      pngChunk('iCCP', Buffer.from('profile\0preserved color')),
      pngChunk('IDAT', Buffer.from('UNCHANGED-PIXELS')),
    );
  }
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x2c;
  return webpWithChunks(
    webpChunk('VP8X', vp8x),
    webpChunk('EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])),
    webpChunk('XMP ', Buffer.from('<x:xmpmeta>private xmp</x:xmpmeta>')),
    webpChunk('C2PA', Buffer.from('private c2pa')),
    webpChunk('ICCP', Buffer.from('preserved color')),
    webpChunk('VP8 ', Buffer.from('UNCHANGED-PIXELS')),
  );
}

test('general image remover clears supported private containers and preserves ICC and image payloads', () => {
  for (const format of ['JPEG', 'PNG', 'WebP']) {
    const source = imageFixture(format);
    const cleaned = removeMetadata(source);
    const after = viewMetadata(cleaned.buffer);
    assert.equal(cleaned.report.verified, true);
    assert.ok(cleaned.report.containersRemoved >= 3);
    assert.ok(after.containers.some((container) => container.type === 'icc'));
    assert.ok(!after.containers.some((container) => container.type !== 'icc'));
    assert.ok(cleaned.buffer.includes(Buffer.from(format === 'JPEG' ? [0x01, 0x02, 0x03] : 'UNCHANGED-PIXELS')));
  }
});

test('general image remover protects non-standard EXIF orientation by default', () => {
  assert.throws(() => removeMetadata(imageFixture('JPEG', 6)), MetadataRemovalError);
  assert.equal(removeMetadata(imageFixture('JPEG', 6), { allowOrientationChange: true }).report.orientationOverrideUsed, true);
});

test('focused image editor updates existing fixed-size EXIF fields in JPEG, PNG, and WebP', () => {
  for (const format of ['JPEG', 'PNG', 'WebP']) {
    const source = imageFixture(format);
    const edited = editImageMetadata(source, { title: 'Public photo', creator: 'Public Studio', copyright: null });
    const report = viewMetadata(edited.buffer);
    assert.equal(edited.buffer.length, source.length);
    assert.equal(edited.report.verified, true);
    assert.equal(report.fields.find((field) => field.name === 'ImageDescription')?.value, 'Public photo');
    assert.equal(report.fields.find((field) => field.name === 'Artist')?.value, 'Public Studio');
    assert.equal(report.fields.find((field) => field.name === 'Copyright')?.value, '');
    assert.ok(edited.buffer.includes(Buffer.from(format === 'JPEG' ? [0x01, 0x02, 0x03] : 'UNCHANGED-PIXELS')));
    if (format === 'PNG') assertEditedExifCrc(edited.buffer);
  }
});

test('focused image editor refuses missing fields and values that exceed the existing slot', () => {
  assert.throws(() => editImageMetadata(imageFixture('JPEG'), { title: 'x'.repeat(40) }), /existing 32-byte EXIF slot/);
  assert.throws(() => editImageMetadata(imageFixture('JPEG'), { title: 'Unicode 不支持' }), /printable ASCII/);
});

test('new image CLIs write verified promotional-link-free JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'image-write-tools-'));
  const input = join(directory, 'private.jpg');
  const edited = join(directory, 'edited.jpg');
  const cleaned = join(directory, 'cleaned.jpg');
  await writeFile(input, imageFixture('JPEG'));

  const editRun = spawnSync(process.execPath, ['./bin/metadata-edit.js', '--json', '--title', 'Public photo', '--output', edited, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(editRun.status, 0, editRun.stderr);
  assert.doesNotMatch(editRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(editRun.stdout).result.verified, true);

  const removeRun = spawnSync(process.execPath, ['./bin/metadata-remove.js', '--json', '--output', cleaned, edited], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(removeRun.stdout).result.verified, true);
  assert.ok((await readFile(cleaned)).length < (await readFile(edited)).length);
});
