import { inflateSync } from 'node:zlib';
import { detectAiSignals } from './ai-signals.js';

export const ONLINE_CLEANER_URL = 'https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker';

const MAX_TEXT_BYTES = 1024 * 1024;
const EXIF_TAG_NAMES = new Map([
  [0x010e, 'ImageDescription'],
  [0x010f, 'Make'],
  [0x0110, 'Model'],
  [0x0131, 'Software'],
  [0x0132, 'DateTime'],
  [0x013b, 'Artist'],
  [0x8298, 'Copyright'],
  [0x9003, 'DateTimeOriginal'],
  [0x9004, 'DateTimeDigitized'],
  [0x9286, 'UserComment'],
  [0xa420, 'ImageUniqueID'],
  [0xa434, 'LensModel'],
]);

const EXIF_TYPE_SIZES = new Map([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 4],
  [5, 8],
  [7, 1],
  [9, 4],
  [10, 8],
]);

export class UnsupportedImageError extends Error {
  constructor() {
    super('Unsupported image. Expected a JPEG, PNG, or WebP file.');
    this.name = 'UnsupportedImageError';
  }
}

function isPng(buffer) {
  return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isJpeg(buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function isWebP(buffer) {
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function detectAuthenticitySignals(text) {
  return /\bc2pa\b|jumbf|content credentials/i.test(text ?? '');
}

function createCollector(format, size) {
  const findings = new Map();
  const informational = new Set();

  return {
    add(type, label, risk = 'medium', details = []) {
      const normalizedDetails = Array.isArray(details) ? details : [details];
      const existing = findings.get(type);

      if (existing) {
        for (const detail of normalizedDetails) {
          if (detail) existing.details.add(detail);
        }
        if (risk === 'high') existing.risk = 'high';
        return;
      }

      findings.set(type, {
        type,
        label,
        risk,
        details: new Set(normalizedDetails.filter(Boolean)),
      });
    },

    info(label) {
      informational.add(label);
    },

    finish() {
      const resultFindings = [...findings.values()]
        .map((finding) => ({
          ...finding,
          details: [...finding.details].sort(),
        }))
        .sort((left, right) => {
          if (left.risk !== right.risk) return left.risk === 'high' ? -1 : 1;
          return left.type.localeCompare(right.type);
        });

      return {
        format,
        size,
        risk: resultFindings.some((finding) => finding.risk === 'high')
          ? 'high'
          : resultFindings.length > 0
            ? 'medium'
            : 'none',
        findings: resultFindings,
        informational: [...informational].sort(),
      };
    },
  };
}

function safeInflate(buffer) {
  try {
    return inflateSync(buffer, { maxOutputLength: MAX_TEXT_BYTES });
  } catch {
    return Buffer.alloc(0);
  }
}

function boundedText(buffer, encoding = 'utf8') {
  return buffer.subarray(0, MAX_TEXT_BYTES).toString(encoding);
}

function inspectText(text, source, collector) {
  const aiSignals = detectAiSignals(text);
  if (aiSignals.length > 0) {
    collector.add('ai_metadata', 'AI generation metadata', 'medium', aiSignals);
  }

  if (detectAuthenticitySignals(text)) {
    collector.add('c2pa', 'C2PA/JUMBF container or reference', 'medium', source);
  }
}

function parseExif(payload) {
  const hasExifHeader = payload.length >= 6
    && payload.toString('ascii', 0, 6) === 'Exif\u0000\u0000';
  const tiff = hasExifHeader ? payload.subarray(6) : payload;

  if (tiff.length < 8) return { tags: [], hasGps: false };

  const byteOrder = tiff.toString('ascii', 0, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return { tags: [], hasGps: false };

  const readUInt16 = (offset) => {
    if (offset < 0 || offset + 2 > tiff.length) return null;
    return littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  };
  const readUInt32 = (offset) => {
    if (offset < 0 || offset + 4 > tiff.length) return null;
    return littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  };

  if (readUInt16(2) !== 42) return { tags: [], hasGps: false };

  const firstIfdOffset = readUInt32(4);
  if (firstIfdOffset === null) return { tags: [], hasGps: false };

  const tags = new Set();
  const visited = new Set();
  let hasGps = false;

  function readInlineNumber(entryOffset, type) {
    if (type === 3) return readUInt16(entryOffset + 8);
    if (type === 4) return readUInt32(entryOffset + 8);
    return null;
  }

  function parseIfd(ifdOffset, depth = 0) {
    if (
      depth > 3
      || visited.has(ifdOffset)
      || ifdOffset < 0
      || ifdOffset + 2 > tiff.length
    ) return;

    visited.add(ifdOffset);
    const entryCount = readUInt16(ifdOffset);
    if (entryCount === null || entryCount > 4096) return;

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + (index * 12);
      if (entryOffset + 12 > tiff.length) break;

      const tag = readUInt16(entryOffset);
      const type = readUInt16(entryOffset + 2);
      const count = readUInt32(entryOffset + 4);
      if (tag === null || type === null || count === null) continue;

      if (EXIF_TAG_NAMES.has(tag)) tags.add(EXIF_TAG_NAMES.get(tag));

      const typeSize = EXIF_TYPE_SIZES.get(type);
      if (typeSize && count <= Number.MAX_SAFE_INTEGER / typeSize) {
        const valueSize = typeSize * count;
        if (valueSize > 4) {
          const valueOffset = readUInt32(entryOffset + 8);
          if (valueOffset !== null && valueOffset + valueSize > tiff.length) continue;
        }
      }

      if (tag === 0x8825) {
        hasGps = true;
        const gpsOffset = readInlineNumber(entryOffset, type);
        if (gpsOffset !== null && gpsOffset > 0) parseIfd(gpsOffset, depth + 1);
      }

      if (tag === 0x8769 || tag === 0xa005) {
        const nestedOffset = readInlineNumber(entryOffset, type);
        if (nestedOffset !== null && nestedOffset > 0) parseIfd(nestedOffset, depth + 1);
      }
    }
  }

  parseIfd(firstIfdOffset);
  return { tags: [...tags].sort(), hasGps };
}

function addExifFindings(payload, source, collector) {
  const exif = parseExif(payload);
  const details = exif.tags.length > 0
    ? [`${source} tags: ${exif.tags.join(', ')}`]
    : [`${source} container`];

  collector.add('exif', 'EXIF metadata', 'medium', details);
  if (exif.hasGps) {
    collector.add('gps', 'GPS location metadata', 'high', `${source} GPS IFD`);
  }

  const text = boundedText(payload, 'latin1');
  inspectText(text, source, collector);
}

function inspectJpeg(buffer, collector) {
  let offset = 2;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

    const payload = buffer.subarray(offset + 2, offset + segmentLength);
    const asciiPrefix = payload.toString('ascii', 0, Math.min(payload.length, 64));

    if (marker === 0xe1 && asciiPrefix.startsWith('Exif\u0000\u0000')) {
      addExifFindings(payload, 'JPEG', collector);
    } else if (
      marker === 0xe1
      && (
        asciiPrefix.includes('http://ns.adobe.com/xap/1.0/')
        || boundedText(payload).includes('<x:xmpmeta')
      )
    ) {
      collector.add('xmp', 'XMP metadata', 'medium', 'JPEG APP1 segment');
      inspectText(boundedText(payload), 'JPEG XMP', collector);
    } else if (marker === 0xed) {
      collector.add('iptc', 'IPTC/Photoshop metadata', 'medium', 'JPEG APP13 segment');
      inspectText(boundedText(payload, 'latin1'), 'JPEG APP13', collector);
    } else if (marker === 0xfe) {
      collector.add('comment', 'JPEG comment', 'medium');
      inspectText(boundedText(payload, 'latin1'), 'JPEG comment', collector);
    } else if (marker === 0xeb) {
      collector.add('c2pa', 'C2PA/JUMBF container or reference', 'medium', 'JPEG APP11 segment');
    } else if (marker === 0xe2 && asciiPrefix.startsWith('ICC_PROFILE')) {
      collector.info('ICC color profile (not treated as a privacy risk)');
    }

    offset += segmentLength;
  }
}

function parsePngTextChunk(type, data) {
  const separator = data.indexOf(0);
  if (separator < 0) return { keyword: '', text: '' };

  const keyword = data.subarray(0, separator).toString('latin1');
  if (type === 'tEXt') {
    return { keyword, text: boundedText(data.subarray(separator + 1), 'latin1') };
  }

  if (type === 'zTXt') {
    const compressed = data.subarray(separator + 2);
    return { keyword, text: boundedText(safeInflate(compressed)) };
  }

  let cursor = separator + 1;
  const compressionFlag = data[cursor];
  cursor += 2;

  for (let field = 0; field < 2; field += 1) {
    const nextSeparator = data.indexOf(0, cursor);
    if (nextSeparator < 0) return { keyword, text: '' };
    cursor = nextSeparator + 1;
  }

  const textBytes = data.subarray(cursor);
  const decoded = compressionFlag === 1 ? safeInflate(textBytes) : textBytes;
  return { keyword, text: boundedText(decoded) };
}

function inspectPng(buffer, collector) {
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > buffer.length) break;

    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'eXIf') {
      addExifFindings(data, 'PNG', collector);
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const { keyword, text } = parsePngTextChunk(type, data);
      const label = keyword || `${type} chunk`;
      const normalizedKeyword = keyword.toLowerCase();

      collector.add('png_text', 'PNG text metadata', 'medium', `Keyword: ${label}`);

      if (normalizedKeyword.includes('xmp') || text.includes('<x:xmpmeta')) {
        collector.add('xmp', 'XMP metadata', 'medium', `PNG ${type} chunk`);
      }
      if (normalizedKeyword.includes('iptc')) {
        collector.add('iptc', 'IPTC metadata', 'medium', `PNG ${type} chunk`);
      }

      inspectText(`${keyword}\n${text}`, `PNG ${type} chunk`, collector);
    } else if (type === 'caBX') {
      collector.add('c2pa', 'C2PA/JUMBF container or reference', 'medium', 'PNG caBX chunk');
    } else if (type === 'iCCP') {
      collector.info('ICC color profile (not treated as a privacy risk)');
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }
}

function inspectWebP(buffer, collector) {
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd < dataStart || dataEnd > buffer.length) break;

    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'EXIF') {
      addExifFindings(data, 'WebP', collector);
    } else if (type === 'XMP ') {
      collector.add('xmp', 'XMP metadata', 'medium', 'WebP XMP chunk');
      inspectText(boundedText(data), 'WebP XMP', collector);
    } else if (type === 'ICCP') {
      collector.info('ICC color profile (not treated as a privacy risk)');
    } else if (type === 'C2PA') {
      collector.add('c2pa', 'C2PA/JUMBF container or reference', 'medium', 'WebP C2PA chunk');
    }

    offset = dataEnd + (length % 2);
  }
}

export function inspectImage(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  if (isJpeg(buffer)) {
    const collector = createCollector('JPEG', buffer.length);
    inspectJpeg(buffer, collector);
    return collector.finish();
  }

  if (isPng(buffer)) {
    const collector = createCollector('PNG', buffer.length);
    inspectPng(buffer, collector);
    return collector.finish();
  }

  if (isWebP(buffer)) {
    const collector = createCollector('WebP', buffer.length);
    inspectWebP(buffer, collector);
    return collector.finish();
  }

  throw new UnsupportedImageError();
}
