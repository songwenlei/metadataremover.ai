import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { removeAiMetadata } from '../src/ai-metadata-remover.js';
import { classifyAiText } from '../src/ai-signals.js';
import { viewMetadata } from '../src/metadata-viewer.js';

function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function pngWithChunks(...chunks) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
    pngChunk('IEND'),
  ]);
}

function pngInternationalText(keyword, text) {
  return Buffer.concat([
    Buffer.from(`${keyword}\0`, 'latin1'),
    Buffer.from([0, 0]),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from(text),
  ]);
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

test('AI signal classifier recognizes common workflows but not a generic camera model', () => {
  assert.equal(classifyAiText('workflow', '{"nodes":[]}').marked, true);
  assert.equal(classifyAiText('Comment', 'Stable Diffusion; Seed: 42; Sampler: Euler').marked, true);
  assert.equal(classifyAiText('Comment', 'Camera model Canon R5').marked, false);
});

test('AI remover deletes marked PNG text and XMP while preserving unrelated metadata', () => {
  const aiText = pngChunk('tEXt', Buffer.from('parameters\0Prompt: private concept; Seed: 42; Sampler: Euler'));
  const aiXmp = pngChunk('iTXt', pngInternationalText(
    'XML:com.adobe.xmp',
    '<x:xmpmeta>digitalSourceType="trainedAlgorithmicMedia"</x:xmpmeta>',
  ));
  const genericText = pngChunk('tEXt', Buffer.from('Comment\0Camera model Canon R5'));
  const exif = pngChunk('eXIf', Buffer.from('kept-exif'));
  const icc = pngChunk('iCCP', Buffer.from('profile\0kept-icc'));
  const c2pa = pngChunk('caBX', Buffer.from('kept-c2pa'));
  const png = pngWithChunks(aiText, aiXmp, genericText, exif, icc, c2pa);

  const cleaned = removeAiMetadata(png);
  assert.deepEqual(cleaned.report.removedByType, { pngText: 1, xmp: 1 });
  assert.equal(cleaned.report.verified, true);
  assert.ok(!cleaned.buffer.includes(aiText));
  assert.ok(!cleaned.buffer.includes(aiXmp));
  assert.ok(cleaned.buffer.includes(genericText));
  assert.ok(cleaned.buffer.includes(exif));
  assert.ok(cleaned.buffer.includes(icc));
  assert.ok(cleaned.buffer.includes(c2pa));

  const after = viewMetadata(cleaned.buffer);
  assert.ok(after.containers.some((container) => container.type === 'exif'));
  assert.ok(after.containers.some((container) => container.type === 'icc'));
  assert.ok(after.containers.some((container) => container.type === 'c2pa'));
});

test('AI remover deletes AI-marked JPEG XMP but keeps EXIF, generic XMP, comments, and IPTC', () => {
  const exif = jpegSegment(0xe1, Buffer.from('Exif\0\0kept-exif'));
  const aiXmp = jpegSegment(0xe1, Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>ComfyUI workflow prompt seed sampler</x:xmpmeta>',
  ));
  const genericXmp = jpegSegment(0xe1, Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>copyright 2026</x:xmpmeta>',
  ));
  const comment = jpegSegment(0xfe, Buffer.from('Prompt discussion kept because this is a JPEG comment'));
  const iptc = jpegSegment(0xed, Buffer.from('kept-iptc'));
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    exif,
    aiXmp,
    genericXmp,
    comment,
    iptc,
    scan,
  ]);

  const cleaned = removeAiMetadata(jpeg);
  assert.deepEqual(cleaned.report.removedByType, { pngText: 0, xmp: 1 });
  assert.ok(!cleaned.buffer.includes(aiXmp));
  assert.ok(cleaned.buffer.includes(exif));
  assert.ok(cleaned.buffer.includes(genericXmp));
  assert.ok(cleaned.buffer.includes(comment));
  assert.ok(cleaned.buffer.includes(iptc));
  assert.ok(cleaned.buffer.subarray(-scan.length).equals(scan));
});

test('AI remover deletes WebP AI XMP, clears its VP8X flag, and preserves other chunks', () => {
  const vp8xData = Buffer.alloc(10);
  vp8xData[0] = 0x24;
  const aiXmp = webpChunk('XMP ', Buffer.from('<x:xmpmeta>Stable Diffusion prompt seed</x:xmpmeta>'));
  const exif = webpChunk('EXIF', Buffer.from('kept-exif'));
  const icc = webpChunk('ICCP', Buffer.from('kept-icc'));
  const c2pa = webpChunk('C2PA', Buffer.from('kept-c2pa'));
  const webp = webpWithChunks(webpChunk('VP8X', vp8xData), aiXmp, exif, icc, c2pa);

  const cleaned = removeAiMetadata(webp);
  assert.equal(cleaned.report.removedByType.xmp, 1);
  assert.equal(cleaned.buffer[20] & 0x04, 0);
  assert.equal(cleaned.buffer[20] & 0x20, 0x20);
  assert.ok(!cleaned.buffer.includes(aiXmp));
  assert.ok(cleaned.buffer.includes(exif));
  assert.ok(cleaned.buffer.includes(icc));
  assert.ok(cleaned.buffer.includes(c2pa));
});

test('WebP XMP flag stays set when an unrelated XMP chunk remains', () => {
  const vp8xData = Buffer.alloc(10);
  vp8xData[0] = 0x04;
  const aiXmp = webpChunk('XMP ', Buffer.from('<x:xmpmeta>InvokeAI prompt seed</x:xmpmeta>'));
  const genericXmp = webpChunk('XMP ', Buffer.from('<x:xmpmeta>copyright 2026</x:xmpmeta>'));
  const cleaned = removeAiMetadata(webpWithChunks(webpChunk('VP8X', vp8xData), aiXmp, genericXmp));

  assert.equal(cleaned.buffer[20] & 0x04, 0x04);
  assert.ok(cleaned.buffer.includes(genericXmp));
});

test('unreadable compressed PNG text is preserved with an explicit warning', () => {
  const invalidCompressedText = pngChunk(
    'zTXt',
    Buffer.concat([Buffer.from('parameters\0', 'latin1'), Buffer.from([0, 1, 2, 3, 4])]),
  );
  const png = pngWithChunks(invalidCompressedText);
  const cleaned = removeAiMetadata(png);

  assert.equal(cleaned.report.containersRemoved, 0);
  assert.ok(cleaned.buffer.equals(png));
  assert.match(cleaned.report.warnings.join(' '), /preserved/);
});

test('AI remover CLI writes verified JSON without promotional URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-metadata-remove-'));
  const input = join(directory, 'input.png');
  const output = join(directory, 'output.png');
  await writeFile(input, pngWithChunks(
    pngChunk('tEXt', Buffer.from('workflow\0{"class_type":"KSampler","seed":42}')),
  ));

  const run = spawnSync(
    process.execPath,
    ['./bin/ai-metadata-remove.js', '--json', '--output', output, input],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /metadataremover\.ai/);
  const result = JSON.parse(run.stdout).result;
  assert.equal(result.verified, true);
  assert.equal(result.removedByType.pngText, 1);
  assert.ok((await readFile(output)).length < (await readFile(input)).length);
});
