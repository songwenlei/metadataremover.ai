import { viewMetadata } from './metadata-viewer.js';

export const ONLINE_METADATA_REMOVER_URL = 'https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_remover';

const REMOVABLE_CONTAINER_TYPES = new Set([
  'exif',
  'xmp',
  'iptc',
  'comment',
  'c2pa',
  'png_text',
  'ai',
]);

export class MetadataRemovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MetadataRemovalError';
    this.code = code;
  }
}

function jpegMetadataType(marker, payload) {
  const prefix = payload.toString('ascii', 0, Math.min(payload.length, 96));
  if (marker === 0xe1 && prefix.startsWith('Exif\0\0')) return 'exif';
  if (
    marker === 0xe1
    && (
      prefix.includes('http://ns.adobe.com/xap/1.0/')
      || prefix.includes('http://ns.adobe.com/xmp/extension/')
      || payload.includes(Buffer.from('<x:xmpmeta'))
      || payload.includes(Buffer.from('<?xpacket'))
    )
  ) return 'xmp';
  if (marker === 0xed) return 'iptc';
  if (marker === 0xfe) return 'comment';
  if (marker === 0xeb) return 'c2pa';
  return null;
}

function rewriteJpeg(buffer) {
  const parts = [buffer.subarray(0, 2)];
  const removedByType = {};
  let offset = 2;
  let foundImageDataOrEnd = false;

  while (offset < buffer.length) {
    const markerStart = offset;
    if (buffer[offset] !== 0xff) {
      throw new MetadataRemovalError('malformed_image', 'Malformed JPEG: expected a marker before image scan data.');
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw new MetadataRemovalError('malformed_image', 'Malformed JPEG: incomplete marker.');
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xda || marker === 0xd9) {
      parts.push(buffer.subarray(markerStart));
      foundImageDataOrEnd = true;
      offset = buffer.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buffer.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw new MetadataRemovalError('malformed_image', 'Malformed JPEG: missing segment length.');
    const segmentLength = buffer.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      throw new MetadataRemovalError('malformed_image', 'Malformed JPEG: invalid segment length.');
    }
    const type = jpegMetadataType(marker, buffer.subarray(offset + 2, segmentEnd));
    if (type) removedByType[type] = (removedByType[type] ?? 0) + 1;
    else parts.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  if (!foundImageDataOrEnd) {
    throw new MetadataRemovalError('malformed_image', 'Malformed JPEG: image scan data or the end marker is missing.');
  }
  return { buffer: Buffer.concat(parts), removedByType };
}

function rewritePng(buffer) {
  const parts = [buffer.subarray(0, 8)];
  const removedByType = {};
  const typeMap = new Map([
    ['eXIf', 'exif'],
    ['tEXt', 'pngText'],
    ['zTXt', 'pngText'],
    ['iTXt', 'pngText'],
    ['caBX', 'c2pa'],
  ]);
  let offset = 8;
  let foundEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd < offset || chunkEnd > buffer.length) {
      throw new MetadataRemovalError('malformed_image', 'Malformed PNG: invalid chunk length.');
    }
    const removalType = typeMap.get(type);
    if (removalType) removedByType[removalType] = (removedByType[removalType] ?? 0) + 1;
    else parts.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === 'IEND') {
      foundEnd = true;
      break;
    }
  }

  if (!foundEnd) throw new MetadataRemovalError('malformed_image', 'Malformed PNG: IEND chunk is missing.');
  if (offset !== buffer.length) parts.push(buffer.subarray(offset));
  return { buffer: Buffer.concat(parts), removedByType };
}

function rewriteWebP(buffer) {
  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd !== buffer.length) {
    throw new MetadataRemovalError('malformed_image', 'Malformed WebP: RIFF size does not match the file size.');
  }
  const chunks = [];
  const removedByType = {};
  const typeMap = new Map([
    ['EXIF', 'exif'],
    ['XMP ', 'xmp'],
    ['C2PA', 'c2pa'],
  ]);
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + length;
    const chunkEnd = dataEnd + (length % 2);
    if (dataEnd < offset || chunkEnd > buffer.length) {
      throw new MetadataRemovalError('malformed_image', 'Malformed WebP: invalid chunk length.');
    }
    const removalType = typeMap.get(type);
    if (removalType) removedByType[removalType] = (removedByType[removalType] ?? 0) + 1;
    else chunks.push({ type, bytes: buffer.subarray(offset, chunkEnd) });
    offset = chunkEnd;
  }
  if (offset !== buffer.length) throw new MetadataRemovalError('malformed_image', 'Malformed WebP: incomplete trailing chunk.');

  const rewrittenChunks = chunks.map(({ type, bytes }) => {
    if (type !== 'VP8X' || bytes.length < 9) return bytes;
    const copy = Buffer.from(bytes);
    copy[8] &= ~(0x08 | 0x04);
    return copy;
  });
  const body = Buffer.concat([Buffer.from('WEBP'), ...rewrittenChunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return { buffer: Buffer.concat([header, body]), removedByType };
}

export function removeMetadata(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const before = viewMetadata(buffer);
  const orientations = before.fields
    .filter((field) => field.group === 'exif' && field.name === 'Orientation')
    .map((field) => Number.parseInt(field.value, 10))
    .filter((value) => Number.isInteger(value) && value !== 1);
  if (orientations.length && !options.allowOrientationChange) {
    throw new MetadataRemovalError(
      'orientation_change',
      `Refusing lossless metadata removal because EXIF Orientation is ${[...new Set(orientations)].join(', ')}. Use --allow-orientation-change only if a display-orientation change is acceptable.`,
    );
  }

  let rewritten;
  if (before.format === 'JPEG') rewritten = rewriteJpeg(buffer);
  else if (before.format === 'PNG') rewritten = rewritePng(buffer);
  else rewritten = rewriteWebP(buffer);

  const after = viewMetadata(rewritten.buffer);
  const remaining = after.containers.filter((container) => REMOVABLE_CONTAINER_TYPES.has(container.type));
  if (remaining.length) {
    throw new MetadataRemovalError('verification_failed', 'A supported privacy-sensitive metadata container remains after cleanup.');
  }
  const containersRemoved = Object.values(rewritten.removedByType).reduce((sum, count) => sum + count, 0);
  return {
    buffer: rewritten.buffer,
    report: {
      schemaVersion: 1,
      format: before.format,
      inputBytes: buffer.length,
      outputBytes: rewritten.buffer.length,
      bytesRemoved: buffer.length - rewritten.buffer.length,
      containersRemoved,
      removedByType: rewritten.removedByType,
      iccProfilesPreserved: after.containers.filter((container) => container.type === 'icc').length,
      orientationOverrideUsed: orientations.length > 0,
      verified: true,
    },
  };
}
