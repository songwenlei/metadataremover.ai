import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  ExifOrientationError,
  removeExif,
} from '../src/exif-remover.js';
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
  if (Buffer.isBuffer(value)) value.copy(buffer, offset + 8, 0, 4);
  else if (type === 3 && count === 1) buffer.writeUInt16LE(value, offset + 8);
  else buffer.writeUInt32LE(value, offset + 8);
}

function tiffWithMetadata(orientation = 1) {
  const tiff = Buffer.alloc(180);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  tiff.writeUInt16LE(3, 8);
  writeEntry(tiff, 10, 0x010f, 2, 9, 104);
  writeEntry(tiff, 22, 0x0112, 3, 1, orientation);
  writeEntry(tiff, 34, 0x8825, 4, 1, 50);
  tiff.writeUInt32LE(0, 46);

  tiff.writeUInt16LE(4, 50);
  writeEntry(tiff, 52, 0x0001, 2, 2, Buffer.from('N\0'));
  writeEntry(tiff, 64, 0x0002, 5, 3, 120);
  writeEntry(tiff, 76, 0x0003, 2, 2, Buffer.from('W\0'));
  writeEntry(tiff, 88, 0x0004, 5, 3, 144);
  tiff.writeUInt32LE(0, 100);

  tiff.write('CameraCo\0', 104, 'ascii');
  [37, 47, 30].forEach((value, index) => {
    tiff.writeUInt32LE(value, 120 + (index * 8));
    tiff.writeUInt32LE(1, 124 + (index * 8));
  });
  [122, 25, 0].forEach((value, index) => {
    tiff.writeUInt32LE(value, 144 + (index * 8));
    tiff.writeUInt32LE(1, 148 + (index * 8));
  });
  return tiff;
}

function exifPayload(orientation = 1) {
  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiffWithMetadata(orientation)]);
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function pngWithChunks(...chunks) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, ...chunks, pngChunk('IEND')]);
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

test('metadata viewer reads EXIF values and derives GPS coordinates', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exifPayload()),
    Buffer.from([0xff, 0xd9]),
  ]);
  const report = viewMetadata(jpeg);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.format, 'JPEG');
  assert.equal(report.fields.find((field) => field.name === 'Make')?.value, 'CameraCo');
  assert.equal(report.fields.find((field) => field.name === 'Orientation')?.value, '1');
  assert.equal(report.fields.find((field) => field.name === 'GPSLatitudeDecimal')?.value, '37.79166667');
  assert.equal(report.fields.find((field) => field.name === 'GPSLongitudeDecimal')?.value, '-122.41666667');
  assert.equal(report.fields.find((field) => field.name === 'GPSLongitudeDecimal')?.privacy, 'high');
});

test('metadata viewer separates AI text and ICC color information in PNG', () => {
  const png = pngWithChunks(
    pngChunk('tEXt', Buffer.from('parameters\0Stable Diffusion prompt; Sampler: Euler')),
    pngChunk('iCCP', Buffer.from('profile\0compressed')),
  );
  const report = viewMetadata(png);

  assert.ok(report.fields.some((field) => field.group === 'ai' && field.name === 'parameters'));
  assert.ok(report.containers.some((container) => container.type === 'icc' && container.privacy === 'info'));
});

test('metadata viewer reports C2PA markers without signature-validation claims', () => {
  const report = viewMetadata(pngWithChunks(pngChunk('caBX', Buffer.from('jumbf'))));
  assert.ok(report.containers.some((container) => container.type === 'c2pa'));
  assert.match(report.warnings.join(' '), /not validated/);
});

test('EXIF remover strips JPEG EXIF while preserving XMP and scan bytes', () => {
  const xmp = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>keep me</x:xmpmeta>');
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x01, 0x02, 0xff, 0xd9]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exifPayload()),
    jpegSegment(0xe1, xmp),
    scan,
  ]);
  const cleaned = removeExif(jpeg);
  const after = viewMetadata(cleaned.buffer);

  assert.equal(cleaned.report.containersRemoved, 1);
  assert.equal(cleaned.report.verified, true);
  assert.ok(after.containers.some((container) => container.type === 'xmp'));
  assert.ok(cleaned.buffer.subarray(-scan.length).equals(scan));
  assert.ok(!after.containers.some((container) => container.type === 'exif'));
});

test('EXIF remover refuses non-standard orientation unless explicitly allowed', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exifPayload(6)),
    Buffer.from([0xff, 0xd9]),
  ]);

  assert.throws(() => removeExif(jpeg), ExifOrientationError);
  assert.equal(removeExif(jpeg, { allowOrientationChange: true }).report.orientationOverrideUsed, true);
});

test('EXIF remover rejects a truncated JPEG instead of rewriting it', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exifPayload()),
  ]);
  assert.throws(() => removeExif(jpeg), /image scan data or the end marker is missing/);
});

test('EXIF remover strips PNG eXIf but preserves text and ICC chunks', () => {
  const text = pngChunk('tEXt', Buffer.from('Comment\0keep'));
  const icc = pngChunk('iCCP', Buffer.from('profile\0keep'));
  const png = pngWithChunks(pngChunk('eXIf', tiffWithMetadata()), text, icc);
  const cleaned = removeExif(png);

  assert.equal(cleaned.report.containersRemoved, 1);
  assert.ok(cleaned.buffer.includes(text));
  assert.ok(cleaned.buffer.includes(icc));
  assert.ok(!viewMetadata(cleaned.buffer).containers.some((container) => container.type === 'exif'));
});

test('EXIF remover strips WebP EXIF, clears the VP8X flag, and preserves XMP', () => {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c;
  const xmp = webpChunk('XMP ', Buffer.from('<x:xmpmeta>keep</x:xmpmeta>'));
  const webp = webpWithChunks(
    webpChunk('VP8X', vp8x),
    webpChunk('EXIF', exifPayload()),
    xmp,
  );
  const cleaned = removeExif(webp);

  assert.equal(cleaned.report.containersRemoved, 1);
  assert.equal(cleaned.buffer[20] & 0x08, 0);
  assert.ok(cleaned.buffer.includes(xmp));
  assert.ok(!viewMetadata(cleaned.buffer).containers.some((container) => container.type === 'exif'));
});

test('machine-readable CLI output stays free of promotional URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'metadata-tools-'));
  const input = join(directory, 'input.png');
  const output = join(directory, 'output.png');
  await writeFile(input, pngWithChunks(pngChunk('eXIf', tiffWithMetadata())));

  const viewRun = spawnSync(process.execPath, ['./bin/metadata-view.js', '--json', input], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(viewRun.status, 0, viewRun.stderr);
  assert.doesNotMatch(viewRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(viewRun.stdout).results[0].format, 'PNG');

  const removeRun = spawnSync(process.execPath, ['./bin/exif-remove.js', '--json', '--output', output, input], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(removeRun.stdout).result.verified, true);
  assert.ok((await readFile(output)).length < (await readFile(input)).length);
});
