import { inflateSync } from 'node:zlib';
import { classifyAiText } from './ai-signals.js';
import { UnsupportedImageError } from './metadata-viewer.js';

export const ONLINE_AI_METADATA_REMOVER_URL = 'https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover';

const MAX_TEXT_BYTES = 1024 * 1024;

export class MalformedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedImageError';
  }
}

function detectFormat(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'JPEG';
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return 'PNG';
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'WebP';
  throw new UnsupportedImageError();
}

function createResult(buffer) {
  return {
    buffer,
    removedByType: { pngText: 0, xmp: 0 },
    warnings: [],
  };
}

function mergeWarning(result, warning) {
  if (warning && !result.warnings.includes(warning)) result.warnings.push(warning);
}

function isXmpPayload(payload) {
  const prefix = payload.toString('ascii', 0, Math.min(payload.length, 96));
  return prefix.includes('http://ns.adobe.com/xap/1.0/')
    || prefix.includes('http://ns.adobe.com/xmp/extension/')
    || payload.includes(Buffer.from('<x:xmpmeta'))
    || payload.includes(Buffer.from('<?xpacket'));
}

function isAiMarkedXmp(payload) {
  const text = payload.subarray(0, MAX_TEXT_BYTES).toString('utf8');
  return classifyAiText('XMP', text).marked;
}

function rewriteJpeg(buffer) {
  const result = createResult(buffer);
  const parts = [buffer.subarray(0, 2)];
  let offset = 2;
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
      foundImageDataOrEnd = true;
      offset = buffer.length;
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

    const payload = buffer.subarray(offset + 2, segmentEnd);
    const remove = marker === 0xe1 && isXmpPayload(payload) && isAiMarkedXmp(payload);
    if (remove) result.removedByType.xmp += 1;
    else parts.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  if (!foundImageDataOrEnd) {
    throw new MalformedImageError('Malformed JPEG: image scan data or the end marker is missing.');
  }
  result.buffer = Buffer.concat(parts);
  return result;
}

function boundedInflate(buffer) {
  try {
    const value = inflateSync(buffer, { maxOutputLength: MAX_TEXT_BYTES + 1 });
    return { text: value.subarray(0, MAX_TEXT_BYTES).toString('utf8'), warning: '' };
  } catch {
    return {
      text: '',
      warning: `A compressed PNG text chunk could not be inspected within the ${MAX_TEXT_BYTES}-byte safety limit and was preserved.`,
    };
  }
}

function parsePngText(type, data) {
  const separator = data.indexOf(0);
  if (separator <= 0 || separator > 79) {
    return {
      keyword: type,
      text: '',
      warning: 'A PNG text chunk had an invalid keyword and was preserved.',
    };
  }
  const keyword = data.subarray(0, separator).toString('latin1');

  if (type === 'tEXt') {
    return {
      keyword,
      text: data.subarray(separator + 1, separator + 1 + MAX_TEXT_BYTES).toString('latin1'),
      warning: '',
    };
  }
  if (type === 'zTXt') {
    const inflated = boundedInflate(data.subarray(separator + 2));
    return { keyword, ...inflated };
  }

  let cursor = separator + 1;
  const compressed = data[cursor] === 1;
  cursor += 2;
  for (let index = 0; index < 2; index += 1) {
    const next = data.indexOf(0, cursor);
    if (next < 0) return { keyword, text: '', warning: '' };
    cursor = next + 1;
  }

  if (compressed) {
    const inflated = boundedInflate(data.subarray(cursor));
    return { keyword, ...inflated };
  }
  return {
    keyword,
    text: data.subarray(cursor, cursor + MAX_TEXT_BYTES).toString('utf8'),
    warning: '',
  };
}

function rewritePng(buffer) {
  const result = createResult(buffer);
  const parts = [buffer.subarray(0, 8)];
  let offset = 8;
  let foundEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > buffer.length) {
      throw new MalformedImageError('Malformed PNG: invalid chunk length.');
    }

    let remove = false;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const parsed = parsePngText(type, buffer.subarray(dataStart, dataEnd));
      mergeWarning(result, parsed.warning);
      remove = !parsed.warning && classifyAiText(parsed.keyword, parsed.text).marked;
      if (remove) {
        if (/xmp/i.test(parsed.keyword)) result.removedByType.xmp += 1;
        else result.removedByType.pngText += 1;
      }
    }

    if (!remove) parts.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === 'IEND') {
      foundEnd = true;
      break;
    }
  }

  if (!foundEnd) throw new MalformedImageError('Malformed PNG: IEND chunk is missing.');
  if (offset !== buffer.length) parts.push(buffer.subarray(offset));
  result.buffer = Buffer.concat(parts);
  return result;
}

function rewriteWebP(buffer) {
  const declaredEnd = buffer.readUInt32LE(4) + 8;
  if (declaredEnd !== buffer.length) {
    throw new MalformedImageError('Malformed WebP: RIFF size does not match the file size.');
  }

  const result = createResult(buffer);
  const chunks = [];
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length % 2);
    if (dataEnd < dataStart || chunkEnd > buffer.length) {
      throw new MalformedImageError('Malformed WebP: invalid chunk length.');
    }

    const bytes = buffer.subarray(offset, chunkEnd);
    const remove = type === 'XMP '
      && classifyAiText('XMP', buffer.subarray(dataStart, Math.min(dataEnd, dataStart + MAX_TEXT_BYTES)).toString('utf8')).marked;
    if (remove) result.removedByType.xmp += 1;
    else chunks.push({ type, bytes });
    offset = chunkEnd;
  }

  if (offset !== buffer.length) throw new MalformedImageError('Malformed WebP: incomplete trailing chunk.');
  if (result.removedByType.xmp === 0) {
    result.buffer = Buffer.from(buffer);
    return result;
  }

  const hasRemainingXmp = chunks.some(({ type }) => type === 'XMP ');
  const rewrittenChunks = chunks.map(({ type, bytes }) => {
    if (type !== 'VP8X' || bytes.length < 9 || hasRemainingXmp) return bytes;
    const copy = Buffer.from(bytes);
    copy[8] &= ~0x04;
    return copy;
  });
  const body = Buffer.concat([Buffer.from('WEBP'), ...rewrittenChunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  result.buffer = Buffer.concat([header, body]);
  return result;
}

function rewrite(buffer, format) {
  if (format === 'JPEG') return rewriteJpeg(buffer);
  if (format === 'PNG') return rewritePng(buffer);
  return rewriteWebP(buffer);
}

export function removeAiMetadata(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const format = detectFormat(buffer);
  const cleaned = rewrite(buffer, format);
  const verification = rewrite(cleaned.buffer, format);
  const remaining = verification.removedByType.pngText + verification.removedByType.xmp;
  if (remaining > 0) {
    throw new Error('AI metadata verification failed: a recognized AI-marked text or XMP container remains.');
  }

  const containersRemoved = cleaned.removedByType.pngText + cleaned.removedByType.xmp;
  return {
    buffer: cleaned.buffer,
    report: {
      schemaVersion: 1,
      format,
      inputBytes: buffer.length,
      outputBytes: cleaned.buffer.length,
      bytesRemoved: buffer.length - cleaned.buffer.length,
      containersRemoved,
      removedByType: cleaned.removedByType,
      warnings: cleaned.warnings,
      verified: true,
    },
  };
}
