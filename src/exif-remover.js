import { viewMetadata } from './metadata-viewer.js';

export const ONLINE_EXIF_REMOVER_URL = 'https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover';

export class ExifOrientationError extends Error {
  constructor(orientations) {
    super(`Refusing lossless EXIF removal because Orientation is ${orientations.join(', ')}. Removing it may change how the image is displayed.`);
    this.name = 'ExifOrientationError';
    this.orientations = orientations;
  }
}

export class MalformedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedImageError';
  }
}

function removeJpegExif(buffer) {
  const parts = [buffer.subarray(0, 2)];
  let offset = 2;
  let removed = 0;
  let foundImageDataOrEnd = false;

  while (offset < buffer.length) {
    const markerStart = offset;
    if (buffer[offset] !== 0xff) {
      throw new MalformedImageError('Malformed JPEG: expected a marker before image scan data.');
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw new MalformedImageError('Malformed JPEG: incomplete marker.');

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xda || marker === 0xd9) {
      parts.push(buffer.subarray(markerStart));
      offset = buffer.length;
      foundImageDataOrEnd = true;
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buffer.subarray(markerStart, offset));
      continue;
    }

    if (offset + 2 > buffer.length) throw new MalformedImageError('Malformed JPEG: missing segment length.');
    const segmentLength = buffer.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      throw new MalformedImageError('Malformed JPEG: invalid segment length.');
    }

    const payloadStart = offset + 2;
    const isExif = marker === 0xe1
      && segmentEnd - payloadStart >= 6
      && buffer.toString('ascii', payloadStart, payloadStart + 6) === 'Exif\0\0';

    if (isExif) removed += 1;
    else parts.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  if (!foundImageDataOrEnd) {
    throw new MalformedImageError('Malformed JPEG: image scan data or the end marker is missing.');
  }

  return { buffer: Buffer.concat(parts), removed };
}

function removePngExif(buffer) {
  const parts = [buffer.subarray(0, 8)];
  let offset = 8;
  let removed = 0;
  let foundEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd < offset || chunkEnd > buffer.length) {
      throw new MalformedImageError('Malformed PNG: invalid chunk length.');
    }

    if (type === 'eXIf') removed += 1;
    else parts.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;

    if (type === 'IEND') {
      foundEnd = true;
      break;
    }
  }

  if (!foundEnd) throw new MalformedImageError('Malformed PNG: IEND chunk is missing.');
  if (offset !== buffer.length) parts.push(buffer.subarray(offset));
  return { buffer: Buffer.concat(parts), removed };
}

function removeWebPExif(buffer) {
  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd !== buffer.length) {
    throw new MalformedImageError('Malformed WebP: RIFF size does not match the file size.');
  }

  const chunks = [];
  let offset = 12;
  let removed = 0;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + length;
    const chunkEnd = dataEnd + (length % 2);
    if (dataEnd < offset || chunkEnd > buffer.length) {
      throw new MalformedImageError('Malformed WebP: invalid chunk length.');
    }

    if (type === 'EXIF') removed += 1;
    else chunks.push({ type, bytes: buffer.subarray(offset, chunkEnd) });
    offset = chunkEnd;
  }

  if (offset !== buffer.length) throw new MalformedImageError('Malformed WebP: incomplete trailing chunk.');
  if (removed === 0) return { buffer: Buffer.from(buffer), removed };

  const rewrittenChunks = chunks.map(({ type, bytes }) => {
    if (type !== 'VP8X' || bytes.length < 9) return bytes;
    const copy = Buffer.from(bytes);
    copy[8] &= ~0x08;
    return copy;
  });
  const body = Buffer.concat([Buffer.from('WEBP'), ...rewrittenChunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return { buffer: Buffer.concat([header, body]), removed };
}

export function removeExif(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const before = viewMetadata(buffer);
  const orientations = before.fields
    .filter((field) => field.group === 'exif' && field.name === 'Orientation')
    .map((field) => Number.parseInt(field.value, 10))
    .filter((value) => Number.isInteger(value) && value !== 1);

  if (orientations.length > 0 && !options.allowOrientationChange) {
    throw new ExifOrientationError([...new Set(orientations)]);
  }

  let cleaned;
  if (before.format === 'JPEG') cleaned = removeJpegExif(buffer);
  else if (before.format === 'PNG') cleaned = removePngExif(buffer);
  else cleaned = removeWebPExif(buffer);

  const after = viewMetadata(cleaned.buffer);
  const remainingExif = after.containers.filter((container) => container.type === 'exif');
  if (remainingExif.length > 0) {
    throw new Error('EXIF verification failed: a supported EXIF container remains.');
  }

  return {
    buffer: cleaned.buffer,
    report: {
      schemaVersion: 1,
      format: before.format,
      inputBytes: buffer.length,
      outputBytes: cleaned.buffer.length,
      bytesRemoved: buffer.length - cleaned.buffer.length,
      containersRemoved: cleaned.removed,
      orientationOverrideUsed: orientations.length > 0,
      verified: true,
    },
  };
}
