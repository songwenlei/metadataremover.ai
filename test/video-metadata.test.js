import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  removeVideoMetadata,
  viewVideoMetadata,
} from '../src/video-metadata.js';

function mp4Box(type, ...parts) {
  const payload = Buffer.concat(parts.map((part) => Buffer.from(part)));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function mp4Fixture({ quickTime = false } = {}) {
  const ftyp = mp4Box('ftyp', Buffer.from(quickTime ? 'qt  \0\0\0\0qt  ' : 'isom\0\0\0\0isom'));
  const mvhdPayload = Buffer.alloc(24);
  mvhdPayload.writeUInt32BE(2_082_844_800 + 1000, 4);
  mvhdPayload.writeUInt32BE(2_082_844_800 + 2000, 8);
  const mvhd = mp4Box('mvhd', mvhdPayload);
  const data = mp4Box('data', Buffer.alloc(8), Buffer.from('Private launch clip'));
  const title = mp4Box('©nam', data);
  const encoder = mp4Box('©too', mp4Box('data', Buffer.alloc(8), Buffer.from('Private QA Encoder')));
  const udta = mp4Box('udta', title, encoder);
  const moov = mp4Box('moov', mvhd, udta);
  const mdat = mp4Box('mdat', Buffer.from('UNCHANGED-VIDEO-PAYLOAD-1234567890'));
  return Buffer.concat([ftyp, moov, mdat]);
}

function ebmlSize(value) {
  if (value > 126) throw new Error('Fixture element is too large for a one-byte EBML size.');
  return Buffer.from([0x80 | value]);
}

function ebmlElement(id, ...parts) {
  const payload = Buffer.concat(parts.map((part) => Buffer.from(part)));
  return Buffer.concat([Buffer.from(id, 'hex'), ebmlSize(payload.length), payload]);
}

function webmFixture() {
  const ebml = ebmlElement('1a45dfa3');
  const info = ebmlElement(
    '1549a966',
    ebmlElement('7ba9', Buffer.from('Private WebM title')),
    ebmlElement('5741', Buffer.from('Private WebM Encoder')),
  );
  const simpleTag = ebmlElement(
    '67c8',
    ebmlElement('45a3', Buffer.from('LOCATION')),
    ebmlElement('4487', Buffer.from('+37.3318-122.0312/')),
  );
  const tags = ebmlElement('1254c367', ebmlElement('7373', simpleTag));
  const cluster = ebmlElement('1f43b675', Buffer.from('UNCHANGED-WEBM-CLUSTER'));
  return Buffer.concat([ebml, ebmlElement('18538067', info, tags, cluster)]);
}

test('video viewer reads focused MP4 and MOV user data and timestamps', () => {
  for (const quickTime of [false, true]) {
    const report = viewVideoMetadata(mp4Fixture({ quickTime }));
    assert.equal(report.container, quickTime ? 'quicktime' : 'iso-bmff');
    assert.equal(report.fields.find((field) => field.name === 'Title')?.value, 'Private launch clip');
    assert.equal(report.fields.find((field) => field.name === 'Encoder / application')?.value, 'Private QA Encoder');
    assert.ok(report.fields.some((field) => field.name === 'mvhd creation time'));
    assert.ok(report.mediaPayloadSha256);
  }
});

test('video viewer accepts raw QuickTime user-data strings without child boxes', () => {
  const source = mp4Fixture();
  const rawComment = mp4Box('©cmt', Buffer.from('Raw QuickTime comment'));
  const ftypEnd = source.readUInt32BE(0);
  const moovEnd = ftypEnd + source.readUInt32BE(ftypEnd);
  const rebuilt = Buffer.concat([
    source.subarray(0, ftypEnd),
    mp4Box('moov', source.subarray(ftypEnd + 8, moovEnd), mp4Box('udta', rawComment)),
    source.subarray(moovEnd),
  ]);
  assert.equal(viewVideoMetadata(rebuilt).fields.find((field) => field.name === 'Comment')?.value, 'Raw QuickTime comment');
});

test('video remover uses same-length MP4 patches and preserves media payload bytes', () => {
  const source = mp4Fixture();
  const before = viewVideoMetadata(source);
  const cleaned = removeVideoMetadata(source);
  const after = viewVideoMetadata(cleaned.buffer);
  assert.equal(cleaned.buffer.length, source.length);
  assert.equal(cleaned.report.verified, true);
  assert.equal(after.fields.length, 0);
  assert.equal(after.mediaPayloadSha256, before.mediaPayloadSha256);
  assert.ok(cleaned.report.removedAreas.some((area) => area.path === 'moov/udta'));
  assert.doesNotMatch(cleaned.buffer.toString('latin1'), /Private launch clip|Private QA Encoder/);
});

test('video viewer and remover support WebM Info and SimpleTag metadata', () => {
  const source = webmFixture();
  const before = viewVideoMetadata(source);
  assert.equal(before.container, 'webm');
  assert.equal(before.fields.find((field) => field.name === 'Segment title')?.value, 'Private WebM title');
  assert.equal(before.fields.find((field) => field.name === 'LOCATION')?.privacy, 'high');
  const cleaned = removeVideoMetadata(source);
  const after = viewVideoMetadata(cleaned.buffer);
  assert.equal(cleaned.buffer.length, source.length);
  assert.equal(cleaned.report.verified, true);
  assert.equal(after.fields.length, 0);
  assert.equal(after.mediaPayloadSha256, before.mediaPayloadSha256);
  assert.doesNotMatch(cleaned.buffer.toString('latin1'), /Private WebM title|Private WebM Encoder|37\.3318/);
});

test('video commands reject extensions without a supported container signature', () => {
  assert.throws(() => viewVideoMetadata(Buffer.from('not a video')), /Unsupported video signature/);
});

test('video CLIs keep JSON promotional-link free and protect media hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-metadata-'));
  const input = join(directory, 'private.mp4');
  const output = join(directory, 'public.mp4');
  await writeFile(input, mp4Fixture());
  const viewRun = spawnSync(process.execPath, ['./bin/video-metadata-view.js', '--json', input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(viewRun.status, 0, viewRun.stderr);
  assert.doesNotMatch(viewRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(viewRun.stdout).results[0].container, 'iso-bmff');

  const removeRun = spawnSync(process.execPath, ['./bin/video-metadata-remove.js', '--json', '--output', output, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(removeRun.stdout).result.verified, true);
  assert.equal(viewVideoMetadata(await readFile(output)).fields.length, 0);
});
