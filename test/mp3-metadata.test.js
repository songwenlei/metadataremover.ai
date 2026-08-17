import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  editMp3Metadata,
  removeMp3Metadata,
  viewMp3Metadata,
} from '../src/mp3-metadata.js';

function syncSafe(value) {
  return Buffer.from([(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f]);
}

function id3Frame(id, payload, major = 4) {
  const body = Buffer.from(payload);
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'latin1');
  if (major === 4) syncSafe(body.length).copy(header, 4);
  else header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function textFrame(id, value, major = 4) {
  return id3Frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(value)]), major);
}

function id3v2(frames, major = 4, padding = 8) {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'latin1');
  header[3] = major;
  syncSafe(body.length).copy(header, 6);
  return Buffer.concat([header, body]);
}

function id3v24WithFooter(frames) {
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'latin1');
  header[3] = 4;
  header[5] = 0x10;
  syncSafe(body.length).copy(header, 6);
  const footer = Buffer.from(header);
  footer.write('3DI', 0, 3, 'latin1');
  return Buffer.concat([header, body, footer]);
}

function mpegAudio(frameCount = 3) {
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  const frameLength = 417;
  return Buffer.concat(Array.from({ length: frameCount }, (_, index) => {
    const frame = Buffer.alloc(frameLength, index + 1);
    header.copy(frame);
    return frame;
  }));
}

function id3v1({ title = 'Legacy title', artist = 'Legacy artist', album = 'Legacy album', year = '2026', comment = 'Legacy comment', track = 7, genre = 13 } = {}) {
  const tag = Buffer.alloc(128);
  tag.write('TAG', 0, 3, 'latin1');
  tag.write(title, 3, 30, 'latin1');
  tag.write(artist, 33, 30, 'latin1');
  tag.write(album, 63, 30, 'latin1');
  tag.write(year, 93, 4, 'latin1');
  tag.write(comment, 97, 28, 'latin1');
  tag[125] = 0;
  tag[126] = track;
  tag[127] = genre;
  return tag;
}

function apeV2(items = { Artist: 'APE Private Artist', Location: 'Private studio' }) {
  const encodedItems = Object.entries(items).map(([key, value]) => {
    const bytes = Buffer.from(value);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([header, Buffer.from(`${key}\0`), bytes]);
  });
  const body = Buffer.concat(encodedItems);
  const footer = Buffer.alloc(32);
  footer.write('APETAGEX', 0, 8, 'latin1');
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(body.length + footer.length, 12);
  footer.writeUInt32LE(encodedItems.length, 16);
  return Buffer.concat([body, footer]);
}

function lyrics3v2() {
  const body = Buffer.from('LYRICSBEGININD00003yes');
  return Buffer.concat([body, Buffer.from(String(body.length).padStart(6, '0')), Buffer.from('LYRICS200')]);
}

function coverPayload() {
  const image = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  return Buffer.concat([
    Buffer.from([3]),
    Buffer.from('image/png\0', 'latin1'),
    Buffer.from([3]),
    Buffer.from('Front cover\0'),
    image,
  ]);
}

function fullFixture(major = 4) {
  const dateFrame = major === 3 ? 'TYER' : 'TDRC';
  const leading = id3v2([
    textFrame('TIT2', 'Private episode', major),
    textFrame('TPE1', 'Private speaker', major),
    textFrame(dateFrame, '2026', major),
    id3Frame('COMM', Buffer.concat([Buffer.from([3]), Buffer.from('eng\0Internal note')]), major),
    id3Frame('APIC', coverPayload(), major),
    id3Frame('PRIV', Buffer.from('vendor.example\0opaque-private-bytes'), major),
  ], major);
  return Buffer.concat([leading, mpegAudio(), lyrics3v2(), apeV2(), id3v1()]);
}

test('MP3 viewer reads ID3v2.3/v2.4, ID3v1, APEv2, Lyrics3v2, and cover art', () => {
  for (const major of [3, 4]) {
    const report = viewMp3Metadata(fullFixture(major));
    assert.equal(report.format, 'MP3 / MPEG Layer III');
    assert.equal(report.mpeg.version, 'MPEG-1');
    assert.equal(report.mpeg.sampleRateHz, 44100);
    assert.equal(report.mpeg.consecutiveFramesValidated, 2);
    assert.deepEqual(report.tags.map((tag) => tag.type), ['id3v2', 'lyrics3v2', 'apev2', 'id3v1']);
    assert.equal(report.fields.find((field) => field.source.startsWith('ID3v2') && field.id === 'title')?.value, 'Private episode');
    assert.equal(report.fields.find((field) => field.source === 'APEv2' && field.name === 'Location')?.value, 'Private studio');
    assert.equal(report.fields.find((field) => field.source === 'ID3v1' && field.id === 'track')?.value, '7');
    assert.equal(report.coverArt[0].mimeType, 'image/png');
    assert.equal(report.coverArt[0].pictureType, 3);
  }
});

test('MP3 remover copies only the MPEG range and verifies all supported tags are absent', () => {
  const source = fullFixture();
  const before = viewMp3Metadata(source);
  const cleaned = removeMp3Metadata(source);
  const after = viewMp3Metadata(cleaned.buffer);
  assert.equal(cleaned.report.verified, true);
  assert.deepEqual(cleaned.buffer, mpegAudio());
  assert.equal(cleaned.report.tagsRemoved.length, 4);
  assert.equal(after.tags.length, 0);
  assert.equal(after.audio.sha256, before.audio.sha256);
  assert.equal(after.audio.byteLength, before.audio.byteLength);
  assert.equal(after.mpeg.firstFrameSignature, before.mpeg.firstFrameSignature);
});

test('MP3 editor changes a focused subset while preserving audio, unknown frames, APEv2, and Lyrics3v2', () => {
  const source = fullFixture();
  const before = viewMp3Metadata(source);
  const edited = editMp3Metadata(source, {
    title: 'Public episode',
    artist: null,
    album: 'Public album',
    date: '2027',
    comment: 'Reviewed note',
  });
  const after = viewMp3Metadata(edited.buffer);
  assert.equal(edited.report.verified, true);
  assert.equal(after.audio.sha256, before.audio.sha256);
  assert.equal(after.fields.find((field) => field.source.startsWith('ID3v2') && field.id === 'title')?.value, 'Public episode');
  assert.equal(after.fields.find((field) => field.source.startsWith('ID3v2') && field.id === 'artist'), undefined);
  assert.equal(after.fields.find((field) => field.source.startsWith('ID3v2') && field.id === 'album')?.value, 'Public album');
  assert.equal(after.fields.find((field) => field.source === 'APEv2' && field.name === 'Artist')?.value, 'APE Private Artist');
  assert.ok(edited.report.checks.find((check) => check.id === 'untouched-id3-frames')?.passed);
  assert.ok(edited.report.checks.find((check) => check.id === 'preserve-apev2')?.passed);
  assert.ok(edited.report.checks.find((check) => check.id === 'preserve-lyrics3v2')?.passed);
});

test('MP3 editor can replace and clear supported APIC cover art without changing audio', () => {
  const source = fullFixture();
  const replacement = Buffer.from('ffd8ffe000104a4649460001010000010001', 'hex');
  const edited = editMp3Metadata(source, { coverArt: { data: replacement, description: 'Public cover' } });
  const report = viewMp3Metadata(edited.buffer);
  assert.equal(report.coverArt.length, 1);
  assert.equal(report.coverArt[0].mimeType, 'image/jpeg');
  assert.equal(report.coverArt[0].byteLength, replacement.length);
  const cleared = editMp3Metadata(edited.buffer, { coverArt: null });
  assert.equal(viewMp3Metadata(cleared.buffer).coverArt.length, 0);
});

test('MP3 editor preserves a standards-compliant ID3v2.4 footer and verifies v2.3 encoding limits', () => {
  const footerSource = Buffer.concat([id3v24WithFooter([textFrame('TIT2', 'Old title')]), mpegAudio()]);
  const footerEdited = editMp3Metadata(footerSource, { title: 'New title' });
  const footerReport = viewMp3Metadata(footerEdited.buffer);
  assert.equal(footerReport.tags[0].version, '4.0');
  assert.equal(footerReport.fields.find((field) => field.id === 'title')?.value, 'New title');

  const v23Source = Buffer.concat([id3v2([textFrame('TIT2', 'Old title', 3)], 3), mpegAudio(), id3v1()]);
  const v23Edited = editMp3Metadata(v23Source, { title: '公开标题', date: '2027-08-13', genre: 'Rock' });
  const v23Report = viewMp3Metadata(v23Edited.buffer);
  assert.equal(v23Report.tags[0].version, '3.0');
  assert.equal(v23Report.fields.find((field) => field.source === 'ID3v2.3' && field.id === 'title')?.value, '公开标题');
  assert.equal(v23Report.fields.find((field) => field.source === 'ID3v2.3' && field.id === 'date')?.value, '2027');
  assert.equal(v23Report.fields.find((field) => field.source === 'ID3v1' && field.id === 'title')?.value, '????');
  assert.equal(v23Report.fields.find((field) => field.source === 'ID3v1' && field.id === 'genre')?.value, 'Rock');
});

test('MP3 editor creates ID3v2.4 for tagless audio and keeps complex tags read-only', () => {
  const tagless = mpegAudio();
  const edited = editMp3Metadata(tagless, { title: 'New local title' });
  const report = viewMp3Metadata(edited.buffer);
  assert.equal(report.tags[0].version, '4.0');
  assert.equal(report.fields.find((field) => field.id === 'title')?.value, 'New local title');
  assert.equal(report.audio.sha256, viewMp3Metadata(tagless).audio.sha256);

  const extendedBody = Buffer.concat([Buffer.from([0, 0, 0, 6, 1, 0]), textFrame('TIT2', 'Read only')]);
  const extendedHeader = Buffer.alloc(10);
  extendedHeader.write('ID3', 0, 3, 'latin1');
  extendedHeader[3] = 4;
  extendedHeader[5] = 0x40;
  syncSafe(extendedBody.length).copy(extendedHeader, 6);
  const complex = Buffer.concat([extendedHeader, extendedBody, mpegAudio()]);
  assert.equal(viewMp3Metadata(complex).tags[0].extendedHeader, true);
  assert.throws(() => editMp3Metadata(complex, { title: 'Refused' }), /focused editor will not rewrite/);
});

test('MP3 commands validate MPEG bytes and reject malformed or oversized ID3 declarations', () => {
  assert.throws(() => viewMp3Metadata(Buffer.from('renamed fake.mp3')), /MPEG Layer III/);
  const invalidSyncSafe = Buffer.concat([Buffer.from('ID3\x04\x00\x00', 'latin1'), Buffer.from([0x80, 0, 0, 1]), mpegAudio()]);
  assert.throws(() => viewMp3Metadata(invalidSyncSafe), /sync-safe/);
  const oversized = Buffer.concat([Buffer.from('ID3\x04\x00\x00', 'latin1'), syncSafe(64 * 1024 * 1024 + 1), mpegAudio()]);
  assert.throws(() => viewMp3Metadata(oversized), /64 MiB/);
});

test('MP3 CLIs keep JSON link-free and protect source and existing output paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mp3-metadata-'));
  const input = join(directory, 'private.mp3');
  const editedOutput = join(directory, 'edited.mp3');
  const cleanOutput = join(directory, 'clean.mp3');
  await writeFile(input, fullFixture());

  const viewRun = spawnSync(process.execPath, ['./bin/mp3-metadata-view.js', '--json', input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(viewRun.status, 0, viewRun.stderr);
  assert.doesNotMatch(viewRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(viewRun.stdout).results[0].mpeg.layer, 'Layer III');

  const editRun = spawnSync(process.execPath, ['./bin/mp3-metadata-edit.js', '--json', '--title', 'Public title', '--output', editedOutput, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(editRun.status, 0, editRun.stderr);
  assert.doesNotMatch(editRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(editRun.stdout).result.verified, true);

  const removeRun = spawnSync(process.execPath, ['./bin/mp3-metadata-remove.js', '--json', '--output', cleanOutput, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(removeRun.stdout).result.verified, true);
  assert.equal(viewMp3Metadata(await readFile(cleanOutput)).tags.length, 0);

  const existingOutputRun = spawnSync(process.execPath, ['./bin/mp3-metadata-remove.js', '--json', '--output', cleanOutput, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(existingOutputRun.status, 2);
  assert.match(JSON.parse(existingOutputRun.stdout).error.message, /EEXIST/);

  const samePathRun = spawnSync(process.execPath, ['./bin/mp3-metadata-remove.js', '--output', input, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(samePathRun.status, 2);
  assert.match(samePathRun.stderr, /must differ/);
});

test('MP3 technical boundaries do not claim audible-watermark or DRM cleanup', () => {
  const report = viewMp3Metadata(fullFixture());
  assert.match(report.limitations.join(' '), /audible watermarks/);
  assert.match(report.limitations.join(' '), /DRM/);
  assert.doesNotMatch(report.limitations.join(' '), /remove.*watermark/i);
});
