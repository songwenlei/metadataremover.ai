import { createHash } from 'node:crypto';

export const ONLINE_MP3_METADATA_EDITOR_URL = 'https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor';
export const ONLINE_MP3_METADATA_REMOVER_URL = 'https://metadataremover.ai/mp3-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_remover';
export const EDITABLE_MP3_FIELDS = [
  'title', 'artist', 'album', 'albumArtist', 'date', 'genre', 'track', 'disc', 'comment', 'coverArt',
];

const MAX_MP3_BYTES = 500 * 1024 * 1024;
const MAX_ID3_TAG_BYTES = 64 * 1024 * 1024;
const MAX_ID3_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_COVER_ART_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_FRAME_COUNT = 4096;
const MAX_APE_ITEM_COUNT = 1024;

const TEXT_FRAMES = new Map([
  ['TIT2', ['title', 'Title', 'medium']],
  ['TPE1', ['artist', 'Artist', 'high']],
  ['TALB', ['album', 'Album', 'medium']],
  ['TPE2', ['albumArtist', 'Album artist', 'high']],
  ['TDRC', ['date', 'Date', 'medium']],
  ['TYER', ['date', 'Year', 'medium']],
  ['TCON', ['genre', 'Genre', 'low']],
  ['TRCK', ['track', 'Track', 'low']],
  ['TPOS', ['disc', 'Disc', 'low']],
]);
const FIELD_FRAMES = new Map([
  ['title', ['TIT2']],
  ['artist', ['TPE1']],
  ['album', ['TALB']],
  ['albumArtist', ['TPE2']],
  ['date', ['TDRC', 'TYER']],
  ['genre', ['TCON']],
  ['track', ['TRCK']],
  ['disc', ['TPOS']],
  ['comment', ['COMM']],
  ['coverArt', ['APIC']],
]);
const ID3V1_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
  'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
  'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
  'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
  'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic',
  'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret',
  'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal',
  'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
  'Folk', 'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin',
  'Revival', 'Celtic', 'Bluegrass', 'Avantgarde', 'Gothic Rock', 'Progressive Rock',
  'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening',
  'Acoustic', 'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata',
  'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam', 'Club',
  'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle',
  'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall', 'Goa',
  'Drum & Bass', 'Club-House', 'Hardcore', 'Terror', 'Indie', 'BritPop', 'Negerpunk',
  'Polsk Punk', 'Beat', 'Christian Gangsta Rap', 'Heavy Metal', 'Black Metal',
  'Crossover', 'Contemporary Christian', 'Christian Rock', 'Merengue', 'Salsa',
  'Thrash Metal', 'Anime', 'JPop', 'SynthPop',
];

export class Mp3MetadataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Mp3MetadataError';
    this.code = code;
  }
}

function asBuffer(input) {
  let buffer;
  if (Buffer.isBuffer(input)) buffer = input;
  else if (input instanceof Uint8Array) buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else if (input instanceof ArrayBuffer) buffer = Buffer.from(input);
  else throw new TypeError('MP3 input must be a Buffer, Uint8Array, or ArrayBuffer.');
  if (!buffer.length) throw new Mp3MetadataError('unsupported_mp3', 'The MP3 file is empty.');
  if (buffer.length > MAX_MP3_BYTES) throw new Mp3MetadataError('file_too_large', 'MP3 files larger than 500 MiB are not supported.');
  return buffer;
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function readSyncSafe(buffer, offset, label) {
  if (offset < 0 || offset + 4 > buffer.length) throw new Mp3MetadataError('malformed_id3', `${label} is truncated.`);
  const bytes = buffer.subarray(offset, offset + 4);
  if ([...bytes].some((byte) => byte & 0x80)) throw new Mp3MetadataError('malformed_id3', `${label} is not a valid sync-safe integer.`);
  return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
}

function writeSyncSafe(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new Mp3MetadataError('unsafe_size', 'An ID3 size cannot be represented safely.');
  }
  return Buffer.from([(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f]);
}

function deUnsynchronize(input) {
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    output.push(input[index]);
    if (input[index] === 0xff && input[index + 1] === 0x00) index += 1;
  }
  return Buffer.from(output);
}

function decodeUtf16(bytes, bigEndian = false) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(bytes.subarray(2));
  }
  return new TextDecoder(bigEndian ? 'utf-16be' : 'utf-16le', { fatal: false }).decode(bytes);
}

function cleanDecoded(value) {
  return value
    .replace(/^\ufeff/, '')
    .replace(/\u0000+$/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

function decodeId3Text(bytes, encoding = 0) {
  const bounded = bytes.subarray(0, Math.min(bytes.length, MAX_TEXT_BYTES));
  let value;
  if (encoding === 0) value = new TextDecoder('windows-1252', { fatal: false }).decode(bounded);
  else if (encoding === 1) value = decodeUtf16(bounded);
  else if (encoding === 2) value = decodeUtf16(bounded, true);
  else if (encoding === 3) value = new TextDecoder('utf-8', { fatal: false }).decode(bounded);
  else return { value: '', truncated: bytes.length > MAX_TEXT_BYTES, unsupportedEncoding: true };
  return { value: cleanDecoded(value), truncated: bytes.length > MAX_TEXT_BYTES, unsupportedEncoding: false };
}

function terminatorIndex(bytes, encoding) {
  if (encoding === 0 || encoding === 3) return bytes.indexOf(0);
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    if (bytes[index] === 0 && bytes[index + 1] === 0) return index;
  }
  return -1;
}

function splitEncoded(bytes, encoding) {
  const terminator = terminatorIndex(bytes, encoding);
  if (terminator < 0) return [bytes, Buffer.alloc(0)];
  const width = encoding === 0 || encoding === 3 ? 1 : 2;
  return [bytes.subarray(0, terminator), bytes.subarray(terminator + width)];
}

function frameSize(buffer, offset, major) {
  return major === 4 ? readSyncSafe(buffer, offset, 'ID3v2.4 frame size') : buffer.readUInt32BE(offset);
}

function parseId3v2(buffer, start) {
  if (start + 10 > buffer.length || buffer.toString('latin1', start, start + 3) !== 'ID3') {
    throw new Mp3MetadataError('malformed_id3', 'An ID3v2 header is truncated or missing.');
  }
  const major = buffer[start + 3];
  const revision = buffer[start + 4];
  const flags = buffer[start + 5];
  if (major !== 3 && major !== 4) {
    throw new Mp3MetadataError('unsupported_id3_version', `ID3v2.${major} is not supported; expected ID3v2.3 or ID3v2.4.`);
  }
  const size = readSyncSafe(buffer, start + 6, 'ID3v2 tag size');
  if (size > MAX_ID3_TAG_BYTES) throw new Mp3MetadataError('id3_tag_too_large', 'An ID3v2 tag exceeds the 64 MiB safety limit.');
  const footerPresent = major === 4 && Boolean(flags & 0x10);
  const bodyEnd = start + 10 + size;
  const end = bodyEnd + (footerPresent ? 10 : 0);
  if (end > buffer.length) throw new Mp3MetadataError('malformed_id3', 'The declared ID3v2 tag size crosses the file boundary.');
  if (footerPresent && buffer.toString('latin1', bodyEnd, bodyEnd + 3) !== '3DI') {
    throw new Mp3MetadataError('malformed_id3', 'The ID3v2.4 footer flag is set but a valid footer is missing.');
  }

  const unsynchronized = Boolean(flags & 0x80);
  const experimental = Boolean(flags & 0x20);
  const rawBody = buffer.subarray(start + 10, bodyEnd);
  const body = unsynchronized ? deUnsynchronize(rawBody) : rawBody;
  let cursor = 0;
  let extendedHeaderSize = 0;
  if (flags & 0x40) {
    if (body.length < 4) throw new Mp3MetadataError('malformed_id3', 'The ID3 extended header is truncated.');
    extendedHeaderSize = major === 4 ? readSyncSafe(body, 0, 'ID3v2.4 extended-header size') : body.readUInt32BE(0) + 4;
    if (extendedHeaderSize < 4 || extendedHeaderSize > body.length) {
      throw new Mp3MetadataError('malformed_id3', 'The ID3 extended header has an invalid size.');
    }
    cursor = extendedHeaderSize;
  }

  const frames = [];
  const fields = [];
  const coverArt = [];
  const warnings = [];
  let paddingSize = 0;
  while (cursor + 10 <= body.length) {
    const header = body.subarray(cursor, cursor + 10);
    if (header.every((byte) => byte === 0)) {
      paddingSize = body.length - cursor;
      break;
    }
    const id = body.toString('latin1', cursor, cursor + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      warnings.push(`ID3 frame scanning stopped at a non-standard frame identifier near tag byte ${cursor}.`);
      break;
    }
    const sizeValue = frameSize(body, cursor + 4, major);
    if (sizeValue > MAX_ID3_FRAME_BYTES) throw new Mp3MetadataError('id3_frame_too_large', `${id} exceeds the 16 MiB frame safety limit.`);
    const frameEnd = cursor + 10 + sizeValue;
    if (frameEnd > body.length) throw new Mp3MetadataError('malformed_id3', `${id} crosses the declared ID3v2 tag boundary.`);
    if (frames.length >= MAX_FRAME_COUNT) throw new Mp3MetadataError('too_many_frames', `The ID3v2 tag contains more than ${MAX_FRAME_COUNT} frames.`);
    const frameFlags = body.readUInt16BE(cursor + 8);
    let payload = body.subarray(cursor + 10, frameEnd);
    const transformedFrame = major === 3
      ? Boolean(frameFlags & 0x00e0)
      : Boolean(frameFlags & 0x004d);
    if (major === 4 && (frameFlags & 0x0002)) payload = deUnsynchronize(payload);
    const frame = {
      id,
      size: sizeValue,
      flags: frameFlags,
      raw: body.subarray(cursor, frameEnd),
      rawSha256: sha256(body.subarray(cursor, frameEnd)),
      editable: TEXT_FRAMES.has(id) || id === 'COMM' || id === 'APIC',
    };
    frames.push(frame);

    if (transformedFrame) {
      warnings.push(`${id} uses compression, encryption, grouping, or a data-length indicator and was preserved without decoding.`);
    } else if (TEXT_FRAMES.has(id) && payload.length) {
      const definition = TEXT_FRAMES.get(id);
      const decoded = decodeId3Text(payload.subarray(1), payload[0]);
      if (decoded.value) fields.push({ id: definition[0], frameId: id, source: `ID3v2.${major}`, name: definition[1], value: decoded.value, privacy: definition[2], truncated: decoded.truncated });
      if (decoded.unsupportedEncoding) warnings.push(`${id} uses unsupported text encoding ${payload[0]}.`);
    } else if (id === 'COMM' && payload.length >= 4) {
      const encoding = payload[0];
      const language = payload.toString('latin1', 1, 4);
      const [descriptionBytes, valueBytes] = splitEncoded(payload.subarray(4), encoding);
      const description = decodeId3Text(descriptionBytes, encoding);
      const value = decodeId3Text(valueBytes, encoding);
      if (value.value) fields.push({ id: 'comment', frameId: id, source: `ID3v2.${major}`, name: 'Comment', value: value.value, description: description.value, language, privacy: 'high', truncated: value.truncated || description.truncated });
    } else if (id === 'APIC' && payload.length >= 4) {
      const encoding = payload[0];
      const mimeEnd = payload.indexOf(0, 1);
      if (mimeEnd > 0 && mimeEnd + 1 < payload.length) {
        const mimeType = payload.toString('latin1', 1, mimeEnd).toLowerCase();
        const pictureType = payload[mimeEnd + 1];
        const [descriptionBytes, data] = splitEncoded(payload.subarray(mimeEnd + 2), encoding);
        const description = decodeId3Text(descriptionBytes, encoding);
        const item = { mimeType, pictureType, description: description.value, byteLength: data.length, sha256: sha256(data) };
        coverArt.push(item);
        fields.push({ id: 'coverArt', frameId: id, source: `ID3v2.${major}`, name: 'Cover art', value: `${mimeType || 'unknown type'}, ${data.length} bytes`, privacy: 'medium', truncated: false });
      } else warnings.push('An APIC frame has a malformed MIME type boundary.');
    }
    cursor = frameEnd;
  }
  if (unsynchronized) warnings.push('Tag-level ID3 unsynchronization was decoded for inspection; the focused editor treats this tag as read-only.');
  if (experimental) warnings.push('The ID3 experimental indicator is set; the focused editor treats this tag as read-only.');
  return {
    type: 'id3v2',
    label: `ID3v2.${major}.${revision}`,
    start,
    end,
    byteLength: end - start,
    major,
    revision,
    flags,
    unsynchronized,
    experimental,
    footerPresent,
    extendedHeaderSize,
    frames,
    fields,
    coverArt,
    warnings,
    paddingSize,
  };
}

function trimLatin1(bytes) {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end -= 1;
  return cleanDecoded(new TextDecoder('windows-1252', { fatal: false }).decode(bytes.subarray(0, end)));
}

function parseId3v1(buffer, start) {
  const raw = buffer.subarray(start, start + 128);
  const trackPresent = raw[125] === 0 && raw[126] !== 0;
  const genreIndex = raw[127];
  const values = {
    title: trimLatin1(raw.subarray(3, 33)),
    artist: trimLatin1(raw.subarray(33, 63)),
    album: trimLatin1(raw.subarray(63, 93)),
    date: trimLatin1(raw.subarray(93, 97)),
    comment: trimLatin1(raw.subarray(97, trackPresent ? 125 : 127)),
    track: trackPresent ? String(raw[126]) : '',
    genre: genreIndex < ID3V1_GENRES.length ? ID3V1_GENRES[genreIndex] : '',
  };
  const names = { title: 'Title', artist: 'Artist', album: 'Album', date: 'Year', comment: 'Comment', track: 'Track', genre: 'Genre' };
  const fields = Object.entries(values)
    .filter(([, value]) => value)
    .map(([id, value]) => ({ id, frameId: null, source: 'ID3v1', name: names[id], value, privacy: ['artist', 'comment'].includes(id) ? 'high' : 'medium', truncated: false }));
  return { type: 'id3v1', label: 'ID3v1', start, end: start + 128, byteLength: 128, raw, fields, values, trackPresent, genreIndex };
}

function parseApeV2(buffer, end) {
  if (end < 32 || buffer.toString('latin1', end - 32, end - 24) !== 'APETAGEX') return null;
  const footerStart = end - 32;
  const version = buffer.readUInt32LE(footerStart + 8);
  const size = buffer.readUInt32LE(footerStart + 12);
  const itemCount = buffer.readUInt32LE(footerStart + 16);
  if (size < 32 || size > MAX_ID3_TAG_BYTES || size > end) throw new Mp3MetadataError('malformed_apev2', 'The APEv2 footer declares an invalid tag size.');
  if (itemCount > MAX_APE_ITEM_COUNT) throw new Mp3MetadataError('too_many_ape_items', `The APEv2 tag declares more than ${MAX_APE_ITEM_COUNT} items.`);
  let tagStart = end - size;
  let actualStart = tagStart;
  if (tagStart >= 32 && buffer.toString('latin1', tagStart - 32, tagStart - 24) === 'APETAGEX') actualStart -= 32;
  let cursor = tagStart;
  if (buffer.toString('latin1', cursor, cursor + 8) === 'APETAGEX') cursor += 32;
  const fields = [];
  const warnings = [];
  for (let index = 0; index < itemCount; index += 1) {
    if (cursor + 8 > footerStart) throw new Mp3MetadataError('malformed_apev2', 'An APEv2 item header is truncated.');
    const valueSize = buffer.readUInt32LE(cursor);
    const itemFlags = buffer.readUInt32LE(cursor + 4);
    const keyEnd = buffer.indexOf(0, cursor + 8);
    if (keyEnd < 0 || keyEnd >= footerStart) throw new Mp3MetadataError('malformed_apev2', 'An APEv2 item key is unterminated.');
    const valueStart = keyEnd + 1;
    const valueEnd = valueStart + valueSize;
    if (valueSize > MAX_ID3_FRAME_BYTES || valueEnd > footerStart) throw new Mp3MetadataError('malformed_apev2', 'An APEv2 item crosses the tag boundary.');
    const key = buffer.toString('utf8', cursor + 8, keyEnd).slice(0, 256);
    const itemType = (itemFlags >>> 1) & 3;
    if (itemType === 0) {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(valueStart, Math.min(valueEnd, valueStart + MAX_TEXT_BYTES)));
      const value = cleanDecoded(decoded.replaceAll('\u0000', '; '));
      if (value) fields.push({ id: `ape:${key.toLowerCase()}`, frameId: null, source: 'APEv2', name: key || 'APE item', value, privacy: /artist|comment|contact|location|owner|url/i.test(key) ? 'high' : 'medium', truncated: valueSize > MAX_TEXT_BYTES });
    } else warnings.push(`APEv2 item ${key || index + 1} is binary or external and was not decoded.`);
    cursor = valueEnd;
  }
  return { type: 'apev2', label: `APEv2.${version}`, start: actualStart, end, byteLength: end - actualStart, fields, warnings, rawSha256: sha256(buffer.subarray(actualStart, end)) };
}

function parseLyrics3v2(buffer, end) {
  if (end < 15 || buffer.toString('latin1', end - 9, end) !== 'LYRICS200') return null;
  const sizeText = buffer.toString('latin1', end - 15, end - 9);
  if (!/^\d{6}$/.test(sizeText)) throw new Mp3MetadataError('malformed_lyrics3', 'The Lyrics3v2 size footer is invalid.');
  const size = Number(sizeText);
  const start = end - 15 - size;
  if (start < 0 || buffer.toString('latin1', start, start + 11) !== 'LYRICSBEGIN') {
    throw new Mp3MetadataError('malformed_lyrics3', 'The Lyrics3v2 start marker does not match its declared size.');
  }
  return { type: 'lyrics3v2', label: 'Lyrics3v2', start, end, byteLength: end - start, fields: [], warnings: ['Lyrics3v2 contents are detected as a container but not decoded by the focused viewer.'], rawSha256: sha256(buffer.subarray(start, end)) };
}

function locateTags(buffer) {
  const leadingTags = [];
  let audioStart = 0;
  while (buffer.toString('latin1', audioStart, audioStart + 3) === 'ID3') {
    const tag = parseId3v2(buffer, audioStart);
    leadingTags.push(tag);
    audioStart = tag.end;
  }

  const trailingTags = [];
  let audioEnd = buffer.length;
  const seen = new Set();
  while (true) {
    let tag = null;
    if (!seen.has('id3v1') && audioEnd >= 128 && buffer.toString('latin1', audioEnd - 128, audioEnd - 125) === 'TAG') {
      tag = parseId3v1(buffer, audioEnd - 128);
    } else {
      tag = parseApeV2(buffer, audioEnd) ?? parseLyrics3v2(buffer, audioEnd);
    }
    if (!tag || seen.has(tag.type)) break;
    seen.add(tag.type);
    trailingTags.push(tag);
    audioEnd = tag.start;
  }
  trailingTags.sort((left, right) => left.start - right.start);
  if (audioEnd <= audioStart) throw new Mp3MetadataError('malformed_mp3', 'Metadata tags leave no MPEG audio payload.');
  return { leadingTags, trailingTags, audioStart, audioEnd };
}

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function parseMpegHeader(buffer, offset, boundary) {
  if (offset + 4 > boundary) return null;
  const value = buffer.readUInt32BE(offset);
  if (((value & 0xffe00000) >>> 0) !== 0xffe00000) return null;
  const versionBits = (value >>> 19) & 3;
  const layerBits = (value >>> 17) & 3;
  const bitrateIndex = (value >>> 12) & 15;
  const sampleRateIndex = (value >>> 10) & 3;
  const padding = (value >>> 9) & 1;
  const emphasis = value & 3;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3 || emphasis === 2) return null;
  const bitrate = (versionBits === 3 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[versionBits][sampleRateIndex];
  const frameLength = Math.floor(((versionBits === 3 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding;
  if (frameLength < 24 || offset + frameLength > boundary) return null;
  return {
    offset,
    version: versionBits === 3 ? 'MPEG-1' : versionBits === 2 ? 'MPEG-2' : 'MPEG-2.5',
    versionBits,
    layer: 'Layer III',
    bitrateKbps: bitrate,
    sampleRateHz: sampleRate,
    channelMode: ['Stereo', 'Joint stereo', 'Dual channel', 'Mono'][(value >>> 6) & 3],
    frameLength,
    samplesPerFrame: versionBits === 3 ? 1152 : 576,
    signature: buffer.subarray(offset, offset + 4).toString('hex'),
  };
}

function inspectMpegAudio(buffer, start, end) {
  const first = parseMpegHeader(buffer, start, end);
  if (!first) throw new Mp3MetadataError('unsupported_mp3', 'Expected a complete MPEG Layer III frame at the audio boundary.');
  const second = parseMpegHeader(buffer, start + first.frameLength, end);
  if (!second || second.versionBits !== first.versionBits || second.sampleRateHz !== first.sampleRateHz) {
    throw new Mp3MetadataError('unsupported_mp3', 'The file does not contain consecutive compatible MPEG Layer III frame headers.');
  }
  return {
    ...first,
    audioOffset: start,
    audioLength: end - start,
    audioSha256: sha256(buffer.subarray(start, end)),
    consecutiveFramesValidated: 2,
  };
}

function inspectInternal(input) {
  const buffer = asBuffer(input);
  const layout = locateTags(buffer);
  const mpeg = inspectMpegAudio(buffer, layout.audioStart, layout.audioEnd);
  const tags = [...layout.leadingTags, ...layout.trailingTags];
  return { buffer, layout, mpeg, tags };
}

function publicTag(tag) {
  const result = { type: tag.type, label: tag.label, byteLength: tag.byteLength, fieldCount: tag.fields.length };
  if (tag.type === 'id3v2') {
    result.version = `${tag.major}.${tag.revision}`;
    result.frameCount = tag.frames.length;
    result.coverArtCount = tag.coverArt.length;
    result.unsynchronized = tag.unsynchronized;
    result.extendedHeader = tag.extendedHeaderSize > 0;
  }
  return result;
}

export function viewMp3Metadata(input) {
  const inspected = inspectInternal(input);
  const warnings = inspected.tags.flatMap((tag) => tag.warnings ?? []);
  if (inspected.tags.some((tag) => tag.type === 'apev2')) warnings.push('APEv2 is reported and preserved by the editor; text items can disagree with ID3 values.');
  if (inspected.tags.some((tag) => tag.type === 'lyrics3v2')) warnings.push('Lyrics3v2 is reported and preserved by the editor.');
  return {
    schemaVersion: 1,
    format: 'MP3 / MPEG Layer III',
    size: inspected.buffer.length,
    sha256: sha256(inspected.buffer),
    mpeg: {
      version: inspected.mpeg.version,
      layer: inspected.mpeg.layer,
      sampleRateHz: inspected.mpeg.sampleRateHz,
      firstFrameBitrateKbps: inspected.mpeg.bitrateKbps,
      channelMode: inspected.mpeg.channelMode,
      firstFrameSignature: inspected.mpeg.signature,
      consecutiveFramesValidated: inspected.mpeg.consecutiveFramesValidated,
    },
    audio: {
      offset: inspected.mpeg.audioOffset,
      byteLength: inspected.mpeg.audioLength,
      sha256: inspected.mpeg.audioSha256,
    },
    tags: inspected.tags.map(publicTag),
    fields: inspected.tags.flatMap((tag) => tag.fields),
    coverArt: inspected.layout.leadingTags.flatMap((tag) => tag.coverArt),
    warnings,
    limitations: [
      'The viewer accepts ID3v2.3, ID3v2.4, ID3v1, trailing APEv2, and Lyrics3v2 around consecutive MPEG Layer III frames.',
      'APEv2 binary items and Lyrics3v2 fields are not decoded; malformed, encrypted, compressed, or vendor-private frame data may remain unreadable.',
      'The MPEG check validates consecutive frame structure, not audible content, ownership, authenticity, DRM, or copyright status.',
      'Filenames, filesystem attributes, spoken names, audible watermarks, and service-side records are outside MP3 tag inspection.',
    ],
  };
}

function normalizeChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Mp3MetadataError('invalid_changes', 'MP3 metadata changes must be an object.');
  const normalized = {};
  for (const [field, rawValue] of Object.entries(changes)) {
    if (!EDITABLE_MP3_FIELDS.includes(field)) throw new Mp3MetadataError('unsupported_field', `Unsupported MP3 field: ${field}`);
    if (field === 'coverArt') {
      if (rawValue === null) normalized.coverArt = null;
      else if (rawValue && typeof rawValue === 'object') normalized.coverArt = normalizeCoverArt(rawValue);
      else throw new Mp3MetadataError('invalid_cover_art', 'coverArt must be null or an object containing local image bytes.');
      continue;
    }
    if (rawValue === null) normalized[field] = null;
    else {
      const value = String(rawValue);
      if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) throw new Mp3MetadataError('text_too_large', `${field} exceeds the 64 KiB text limit.`);
      if (value.includes('\u0000')) throw new Mp3MetadataError('invalid_text', `${field} cannot contain NUL characters.`);
      normalized[field] = value === '' ? null : value;
    }
  }
  if (!Object.keys(normalized).length) throw new Mp3MetadataError('no_changes', 'At least one supported field change is required.');
  return normalized;
}

function detectCoverMime(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  throw new Mp3MetadataError('unsupported_cover_art', 'Cover art must contain JPEG, PNG, or WebP image bytes.');
}

function normalizeCoverArt(raw) {
  const data = asByteBuffer(raw.data);
  if (!data.length || data.length > MAX_COVER_ART_BYTES) throw new Mp3MetadataError('cover_art_too_large', 'Cover art must be between 1 byte and 16 MiB.');
  const mimeType = detectCoverMime(data);
  if (raw.mimeType && String(raw.mimeType).toLowerCase() !== mimeType) throw new Mp3MetadataError('cover_mime_mismatch', 'The supplied cover MIME type does not match its image signature.');
  const pictureType = raw.pictureType === undefined ? 3 : Number(raw.pictureType);
  if (!Number.isInteger(pictureType) || pictureType < 0 || pictureType > 20) throw new Mp3MetadataError('invalid_picture_type', 'ID3 pictureType must be an integer from 0 through 20.');
  const description = raw.description === undefined ? '' : String(raw.description);
  if (Buffer.byteLength(description, 'utf8') > 1024 || description.includes('\u0000')) throw new Mp3MetadataError('invalid_cover_description', 'The cover description must be at most 1024 UTF-8 bytes without NUL characters.');
  return { data, mimeType, pictureType, description };
}

function asByteBuffer(input) {
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new Mp3MetadataError('invalid_cover_art', 'Cover art data must be a Buffer, Uint8Array, or ArrayBuffer.');
}

function encodeTextPayload(value, major) {
  if (major === 4) return Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]);
  return Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
}

function encodeCommentPayload(value, major) {
  if (major === 4) return Buffer.concat([Buffer.from([3]), Buffer.from('eng'), Buffer.from([0]), Buffer.from(value, 'utf8')]);
  return Buffer.concat([Buffer.from([1]), Buffer.from('eng'), Buffer.from([0xff, 0xfe, 0, 0]), Buffer.from(value, 'utf16le')]);
}

function encodeApicPayload(cover, major) {
  const description = major === 4
    ? Buffer.concat([Buffer.from([3]), Buffer.from(cover.mimeType, 'latin1'), Buffer.from([0, cover.pictureType]), Buffer.from(cover.description, 'utf8'), Buffer.from([0])])
    : Buffer.concat([Buffer.from([1]), Buffer.from(cover.mimeType, 'latin1'), Buffer.from([0, cover.pictureType, 0xff, 0xfe]), Buffer.from(cover.description, 'utf16le'), Buffer.from([0, 0])]);
  return Buffer.concat([description, cover.data]);
}

function buildFrame(id, payload, major) {
  if (payload.length > MAX_ID3_FRAME_BYTES) throw new Mp3MetadataError('id3_frame_too_large', `${id} exceeds the 16 MiB frame safety limit.`);
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'latin1');
  if (major === 4) writeSyncSafe(payload.length).copy(header, 4);
  else header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function buildId3v2(existing, changes) {
  const major = existing?.major ?? 4;
  if (existing && (existing.unsynchronized || existing.extendedHeaderSize || existing.experimental)) {
    throw new Mp3MetadataError('read_only_id3', 'The focused editor will not rewrite tag-level unsynchronized, extended-header, or experimental ID3 tags.');
  }
  const replacedIds = new Set();
  for (const field of Object.keys(changes)) for (const id of FIELD_FRAMES.get(field) ?? []) replacedIds.add(id);
  const frames = existing ? existing.frames.filter((frame) => !replacedIds.has(frame.id)).map((frame) => Buffer.from(frame.raw)) : [];
  for (const [field, value] of Object.entries(changes)) {
    if (value === null) continue;
    if (field === 'coverArt') frames.push(buildFrame('APIC', encodeApicPayload(value, major), major));
    else if (field === 'comment') frames.push(buildFrame('COMM', encodeCommentPayload(value, major), major));
    else {
      let id = FIELD_FRAMES.get(field)?.[0];
      let encodedValue = value;
      if (field === 'date' && major === 3) {
        id = 'TYER';
        encodedValue = value.slice(0, 4);
      }
      if (id) frames.push(buildFrame(id, encodeTextPayload(encodedValue, major), major));
    }
  }
  if (!frames.length) return Buffer.alloc(0);
  const paddingLength = Math.min(existing?.paddingSize ?? 0, 4096);
  const body = Buffer.concat([...frames, Buffer.alloc(paddingLength)]);
  if (body.length > MAX_ID3_TAG_BYTES) throw new Mp3MetadataError('id3_tag_too_large', 'The edited ID3v2 tag exceeds the 64 MiB safety limit.');
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'latin1');
  header[3] = major;
  header[4] = 0;
  header[5] = existing?.footerPresent ? 0x10 : 0;
  writeSyncSafe(body.length).copy(header, 6);
  if (!existing?.footerPresent) return Buffer.concat([header, body]);
  const footer = Buffer.alloc(10);
  footer.write('3DI', 0, 3, 'latin1');
  footer[3] = major;
  footer[4] = 0;
  footer[5] = 0x10;
  writeSyncSafe(body.length).copy(footer, 6);
  return Buffer.concat([header, body, footer]);
}

function latin1Bytes(value, length) {
  const bytes = Buffer.alloc(length);
  let cursor = 0;
  for (const character of String(value)) {
    if (cursor >= length) break;
    const point = character.codePointAt(0);
    bytes[cursor] = point <= 0xff ? point : 0x3f;
    cursor += 1;
  }
  return bytes;
}

function id3v1Genre(value) {
  if (/^\d{1,3}$/.test(value) && Number(value) <= 255) return Number(value);
  const index = ID3V1_GENRES.findIndex((genre) => genre.toLowerCase() === value.toLowerCase());
  return index >= 0 ? index : 255;
}

function updateId3v1(tag, changes) {
  if (!tag) return null;
  const output = Buffer.from(tag.raw);
  const write = (start, length, value) => {
    output.fill(0, start, start + length);
    if (value !== null) latin1Bytes(value, length).copy(output, start);
  };
  if ('title' in changes) write(3, 30, changes.title);
  if ('artist' in changes) write(33, 30, changes.artist);
  if ('album' in changes) write(63, 30, changes.album);
  if ('date' in changes) write(93, 4, changes.date === null ? null : changes.date.slice(0, 4));
  let trackPresent = output[125] === 0 && output[126] !== 0;
  if ('track' in changes) {
    const number = changes.track === null ? 0 : Number.parseInt(changes.track.split('/')[0], 10);
    if (changes.track !== null && (!Number.isInteger(number) || number < 1 || number > 255)) {
      throw new Mp3MetadataError('invalid_id3v1_track', 'When ID3v1 is present, track must begin with an integer from 1 through 255.');
    }
    output[125] = 0;
    output[126] = number || 0;
    trackPresent = Boolean(number);
  }
  if ('comment' in changes && !('track' in changes) && !trackPresent) {
    output[125] = 0;
    output[126] = 0;
  }
  if ('comment' in changes) write(97, trackPresent ? 28 : 30, changes.comment);
  if ('genre' in changes) output[127] = changes.genre === null ? 255 : id3v1Genre(changes.genre);
  return output;
}

function targetValueFromTag(tag, field) {
  if (!tag) return undefined;
  if (field === 'coverArt') return tag.coverArt[0];
  return tag.fields.find((item) => item.id === field)?.value;
}

function expectedId3v2Value(field, value, major) {
  if (value === null) return undefined;
  if (field === 'date' && major === 3) return value.slice(0, 4);
  return value;
}

function expectedId3v1Value(field, value, afterTag) {
  if (value === null) return '';
  if (field === 'date') return trimLatin1(latin1Bytes(value.slice(0, 4), 4));
  if (field === 'track') return String(Number.parseInt(value.split('/')[0], 10));
  if (field === 'genre') return id3v1Genre(value) === 255 ? '' : ID3V1_GENRES[id3v1Genre(value)];
  const length = field === 'comment' && afterTag?.trackPresent ? 28 : field === 'comment' ? 30 : 30;
  return trimLatin1(latin1Bytes(value, length));
}

function changedFrameIds(changes) {
  const ids = new Set();
  for (const field of Object.keys(changes)) for (const id of FIELD_FRAMES.get(field) ?? []) ids.add(id);
  return ids;
}

export function editMp3Metadata(input, requestedChanges) {
  const changes = normalizeChanges(requestedChanges);
  const before = inspectInternal(input);
  if (before.layout.leadingTags.length > 1) throw new Mp3MetadataError('multiple_id3v2', 'The focused editor refuses multiple leading ID3v2 tags; use the remover or online review first.');
  const existingV2 = before.layout.leadingTags[0] ?? null;
  const existingV1 = before.layout.trailingTags.find((tag) => tag.type === 'id3v1') ?? null;
  const newV2 = buildId3v2(existingV2, changes);
  const newV1 = updateId3v1(existingV1, changes);
  const trailing = Buffer.from(before.buffer.subarray(before.layout.audioEnd));
  if (existingV1 && newV1) newV1.copy(trailing, existingV1.start - before.layout.audioEnd);
  const output = Buffer.concat([newV2, before.buffer.subarray(before.layout.audioStart, before.layout.audioEnd), trailing]);
  const after = inspectInternal(output);
  const afterV2 = after.layout.leadingTags[0] ?? null;
  const afterV1 = after.layout.trailingTags.find((tag) => tag.type === 'id3v1') ?? null;
  const checks = [
    { id: 'mpeg-audio', passed: before.mpeg.audioLength === after.mpeg.audioLength && before.mpeg.audioSha256 === after.mpeg.audioSha256, detail: 'The complete MPEG audio byte range stayed unchanged.' },
    { id: 'mpeg-structure', passed: before.mpeg.version === after.mpeg.version && before.mpeg.sampleRateHz === after.mpeg.sampleRateHz && before.mpeg.signature === after.mpeg.signature, detail: 'MPEG version, sample rate, and first-frame signature stayed unchanged.' },
  ];
  for (const [field, value] of Object.entries(changes)) {
    let passed;
    if (field === 'coverArt') {
      const actual = targetValueFromTag(afterV2, field);
      passed = value === null
        ? !actual
        : Boolean(actual)
          && actual.sha256 === sha256(value.data)
          && actual.mimeType === value.mimeType
          && actual.pictureType === value.pictureType
          && actual.description === value.description;
    } else passed = targetValueFromTag(afterV2, field) === expectedId3v2Value(field, value, afterV2?.major ?? existingV2?.major ?? 4);
    checks.push({ id: `id3v2-${field}`, passed, detail: value === null ? `${field} is absent from ID3v2.` : `${field} was read back from ID3v2.` });
    if (existingV1 && ['title', 'artist', 'album', 'date', 'genre', 'track', 'comment'].includes(field)) {
      const actualV1 = afterV1?.values[field];
      const expectedV1 = expectedId3v1Value(field, value, afterV1);
      checks.push({ id: `id3v1-${field}`, passed: actualV1 === expectedV1, detail: `${field} was also read back from the existing ID3v1 tag.` });
    }
  }
  const replaced = changedFrameIds(changes);
  const preservedBefore = (existingV2?.frames ?? []).filter((frame) => !replaced.has(frame.id)).map((frame) => frame.rawSha256).sort();
  const preservedAfter = (afterV2?.frames ?? []).filter((frame) => !replaced.has(frame.id)).map((frame) => frame.rawSha256).sort();
  checks.push({ id: 'untouched-id3-frames', passed: JSON.stringify(preservedBefore) === JSON.stringify(preservedAfter), detail: `${preservedBefore.length} untouched ID3v2 frame(s) stayed byte-identical.` });
  for (const type of ['apev2', 'lyrics3v2']) {
    const oldTag = before.layout.trailingTags.find((tag) => tag.type === type);
    const newTag = after.layout.trailingTags.find((tag) => tag.type === type);
    if (oldTag) checks.push({ id: `preserve-${type}`, passed: oldTag.rawSha256 === newTag?.rawSha256, detail: `${oldTag.label} stayed byte-identical.` });
  }
  if (!checks.every((check) => check.passed)) throw new Mp3MetadataError('verification_failed', 'The edited MP3 did not pass field, frame-preservation, and MPEG audio verification.');
  return {
    buffer: output,
    report: {
      format: 'MP3 / MPEG Layer III',
      sourceSize: before.buffer.length,
      outputSize: output.length,
      changedFields: Object.entries(changes).map(([field, value]) => ({ field, action: value === null ? 'clear' : 'set' })),
      audioSha256: after.mpeg.audioSha256,
      verified: true,
      checks,
      warnings: [
        ...(before.tags.some((tag) => tag.type === 'apev2') ? ['APEv2 was preserved and can contain values that disagree with edited ID3 fields.'] : []),
        ...(before.tags.some((tag) => tag.type === 'lyrics3v2') ? ['Lyrics3v2 was preserved without field-level editing.'] : []),
      ],
      limitations: viewMp3Metadata(output).limitations,
    },
  };
}

export function removeMp3Metadata(input) {
  const before = inspectInternal(input);
  if (!before.tags.length) throw new Mp3MetadataError('no_supported_metadata', 'No supported ID3v2, ID3v1, APEv2, or Lyrics3v2 tag was found.');
  const output = Buffer.from(before.buffer.subarray(before.layout.audioStart, before.layout.audioEnd));
  const after = inspectInternal(output);
  const checks = [
    { id: 'supported-tags', passed: after.tags.length === 0, detail: `${before.tags.length} supported tag container(s) no longer appear.` },
    { id: 'audio-length', passed: output.length === before.mpeg.audioLength && after.mpeg.audioLength === before.mpeg.audioLength, detail: `${before.mpeg.audioLength} MPEG audio bytes were copied.` },
    { id: 'audio-sha256', passed: after.mpeg.audioSha256 === before.mpeg.audioSha256, detail: 'The complete MPEG audio byte-range SHA-256 stayed unchanged.' },
    { id: 'mpeg-structure', passed: after.mpeg.version === before.mpeg.version && after.mpeg.sampleRateHz === before.mpeg.sampleRateHz && after.mpeg.signature === before.mpeg.signature, detail: 'MPEG version, sample rate, and first-frame signature stayed unchanged.' },
  ];
  if (!checks.every((check) => check.passed)) throw new Mp3MetadataError('verification_failed', 'The cleaned MP3 did not pass tag absence and MPEG audio verification.');
  return {
    buffer: output,
    report: {
      format: 'MP3 / MPEG Layer III',
      sourceSize: before.buffer.length,
      outputSize: output.length,
      tagsRemoved: before.tags.map((tag) => ({ type: tag.type, label: tag.label, byteLength: tag.byteLength })),
      bytesRemoved: before.buffer.length - output.length,
      audioSha256: after.mpeg.audioSha256,
      verified: true,
      checks,
      limitations: after.tags.length === 0 ? viewMp3Metadata(output).limitations : [],
    },
  };
}
