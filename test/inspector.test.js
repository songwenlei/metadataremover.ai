import assert from 'node:assert/strict';
import test from 'node:test';
import { UnsupportedImageError, inspectImage } from '../src/inspector.js';

function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function tiffWithGpsPointer() {
  const tiff = Buffer.alloc(44);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);

  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(1, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(2, 32);
  tiff.write('N\0', 36, 'ascii');
  tiff.writeUInt32LE(0, 40);
  return tiff;
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
  const padding = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, data, padding]);
}

function webpWithChunks(...chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('detects high-risk GPS metadata in JPEG EXIF', () => {
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiffWithGpsPointer()]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, exif),
    Buffer.from([0xff, 0xd9]),
  ]);

  const result = inspectImage(jpeg);
  assert.equal(result.format, 'JPEG');
  assert.equal(result.risk, 'high');
  assert.deepEqual(result.findings.map(({ type }) => type), ['gps', 'exif']);
});

test('detects PNG text and AI generation parameters', () => {
  const text = Buffer.from('parameters\0Stable Diffusion prompt; Sampler: Euler; Steps: 20');
  const result = inspectImage(pngWithChunks(pngChunk('tEXt', text)));

  assert.equal(result.risk, 'medium');
  assert.ok(result.findings.some(({ type }) => type === 'png_text'));
  assert.ok(result.findings.some(({ type }) => type === 'ai_metadata'));
});

test('detects WebP XMP and AI workflow metadata', () => {
  const xmp = Buffer.from('<x:xmpmeta>ComfyUI workflow prompt</x:xmpmeta>');
  const result = inspectImage(webpWithChunks(webpChunk('XMP ', xmp)));

  assert.equal(result.format, 'WebP');
  assert.ok(result.findings.some(({ type }) => type === 'xmp'));
  assert.ok(result.findings.some(({ type }) => type === 'ai_metadata'));
});

test('reports an ICC profile as informational instead of a privacy risk', () => {
  const profile = Buffer.from('profile-name\0compressed-profile');
  const result = inspectImage(pngWithChunks(pngChunk('iCCP', profile)));

  assert.equal(result.risk, 'none');
  assert.equal(result.findings.length, 0);
  assert.equal(result.informational.length, 1);
});

test('detects a PNG C2PA caBX chunk without claiming signature validation', () => {
  const result = inspectImage(pngWithChunks(pngChunk('caBX', Buffer.from('jumbf'))));

  assert.equal(result.risk, 'medium');
  assert.ok(result.findings.some(({ type }) => type === 'c2pa'));
});

test('reports no findings for a minimal PNG', () => {
  const result = inspectImage(pngWithChunks());

  assert.equal(result.format, 'PNG');
  assert.equal(result.risk, 'none');
  assert.deepEqual(result.findings, []);
});

test('rejects unsupported input', () => {
  assert.throws(
    () => inspectImage(Buffer.from('not an image')),
    UnsupportedImageError,
  );
});

