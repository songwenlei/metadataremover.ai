import { inflateSync } from 'node:zlib';
import { detectAiSignals } from './ai-signals.js';

export const ONLINE_METADATA_VIEWER_URL = 'https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer';

const MAX_FIELD_BYTES = 64 * 1024;
const MAX_FIELDS = 4096;

const EXIF_TAG_NAMES = new Map([
  [0x0100, 'ImageWidth'],
  [0x0101, 'ImageLength'],
  [0x010e, 'ImageDescription'],
  [0x010f, 'Make'],
  [0x0110, 'Model'],
  [0x0112, 'Orientation'],
  [0x011a, 'XResolution'],
  [0x011b, 'YResolution'],
  [0x0128, 'ResolutionUnit'],
  [0x0131, 'Software'],
  [0x0132, 'DateTime'],
  [0x013b, 'Artist'],
  [0x8298, 'Copyright'],
  [0x829a, 'ExposureTime'],
  [0x829d, 'FNumber'],
  [0x8822, 'ExposureProgram'],
  [0x8827, 'ISOSpeedRatings'],
  [0x9000, 'ExifVersion'],
  [0x9003, 'DateTimeOriginal'],
  [0x9004, 'DateTimeDigitized'],
  [0x9010, 'OffsetTime'],
  [0x9011, 'OffsetTimeOriginal'],
  [0x9012, 'OffsetTimeDigitized'],
  [0x9101, 'ComponentsConfiguration'],
  [0x9201, 'ShutterSpeedValue'],
  [0x9202, 'ApertureValue'],
  [0x9203, 'BrightnessValue'],
  [0x9204, 'ExposureBiasValue'],
  [0x9205, 'MaxApertureValue'],
  [0x9206, 'SubjectDistance'],
  [0x9207, 'MeteringMode'],
  [0x9208, 'LightSource'],
  [0x9209, 'Flash'],
  [0x920a, 'FocalLength'],
  [0x9290, 'SubSecTime'],
  [0x9291, 'SubSecTimeOriginal'],
  [0x9292, 'SubSecTimeDigitized'],
  [0x9286, 'UserComment'],
  [0xa001, 'ColorSpace'],
  [0xa002, 'PixelXDimension'],
  [0xa003, 'PixelYDimension'],
  [0xa217, 'SensingMethod'],
  [0xa401, 'CustomRendered'],
  [0xa402, 'ExposureMode'],
  [0xa403, 'WhiteBalance'],
  [0xa404, 'DigitalZoomRatio'],
  [0xa405, 'FocalLengthIn35mmFilm'],
  [0xa406, 'SceneCaptureType'],
  [0xa407, 'GainControl'],
  [0xa408, 'Contrast'],
  [0xa409, 'Saturation'],
  [0xa40a, 'Sharpness'],
  [0xa40c, 'SubjectDistanceRange'],
  [0xa420, 'ImageUniqueID'],
  [0xa430, 'CameraOwnerName'],
  [0xa431, 'BodySerialNumber'],
  [0xa432, 'LensSpecification'],
  [0xa433, 'LensMake'],
  [0xa434, 'LensModel'],
  [0xa435, 'LensSerialNumber'],
]);

const GPS_TAG_NAMES = new Map([
  [0x0000, 'GPSVersionID'],
  [0x0001, 'GPSLatitudeRef'],
  [0x0002, 'GPSLatitude'],
  [0x0003, 'GPSLongitudeRef'],
  [0x0004, 'GPSLongitude'],
  [0x0005, 'GPSAltitudeRef'],
  [0x0006, 'GPSAltitude'],
  [0x0007, 'GPSTimeStamp'],
  [0x0008, 'GPSSatellites'],
  [0x0009, 'GPSStatus'],
  [0x000a, 'GPSMeasureMode'],
  [0x000b, 'GPSDOP'],
  [0x000c, 'GPSSpeedRef'],
  [0x000d, 'GPSSpeed'],
  [0x000e, 'GPSTrackRef'],
  [0x000f, 'GPSTrack'],
  [0x0010, 'GPSImgDirectionRef'],
  [0x0011, 'GPSImgDirection'],
  [0x0012, 'GPSMapDatum'],
  [0x001d, 'GPSDateStamp'],
  [0x001f, 'GPSHPositioningError'],
]);

const TYPE_SIZES = new Map([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 4],
  [5, 8],
  [6, 1],
  [7, 1],
  [8, 2],
  [9, 4],
  [10, 8],
  [11, 4],
  [12, 8],
]);

const POINTER_TAGS = new Set([0x8769, 0x8825, 0xa005]);
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

function boundedText(buffer, encoding = 'utf8') {
  const truncated = buffer.length > MAX_FIELD_BYTES;
  return {
    text: buffer.subarray(0, MAX_FIELD_BYTES).toString(encoding).replace(/\0+$/g, ''),
    truncated,
  };
}

function createReport(format, size) {
  const fields = [];
  const containers = [];
  const warnings = new Set();

  return {
    addContainer(type, source, length, privacy = 'medium') {
      containers.push({ type, source, length, privacy });
      if (type === 'c2pa') {
        warnings.add('C2PA/JUMBF markers are detected only; signatures and trust chains are not validated.');
      }
    },
    addField(group, name, value, source, privacy = 'info', truncated = false) {
      if (fields.length >= MAX_FIELDS) {
        warnings.add(`Field output was limited to ${MAX_FIELDS} entries.`);
        return;
      }
      fields.push({
        group,
        name,
        value: String(value),
        source,
        privacy,
        ...(truncated ? { truncated: true } : {}),
      });
      if (truncated) {
        warnings.add(`Long field values were truncated to ${MAX_FIELD_BYTES} bytes.`);
      }
    },
    warn(message) {
      warnings.add(message);
    },
    finish() {
      return {
        schemaVersion: 1,
        format,
        size,
        fields,
        containers,
        warnings: [...warnings],
      };
    },
  };
}

function privacyForExif(name, group) {
  if (group === 'gps') return 'high';
  if (/serial|uniqueid|owner|artist|copyright|description/i.test(name)) return 'high';
  if (/date|time|make|model|software|lens/i.test(name)) return 'medium';
  return 'info';
}

function printableUndefined(bytes) {
  let payload = bytes;
  if (bytes.length >= 8 && bytes.toString('ascii', 0, 8) === 'ASCII\0\0\0') {
    payload = bytes.subarray(8);
  }

  const sample = payload.subarray(0, MAX_FIELD_BYTES);
  let printableBytes = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printableBytes += 1;
  }
  const printable = sample.length > 0 && printableBytes / sample.length > 0.8;
  if (printable) return boundedText(payload, 'utf8');

  const truncated = payload.length > 64;
  return {
    text: `0x${payload.subarray(0, 64).toString('hex')}${truncated ? '…' : ''}`,
    truncated,
  };
}

function parseExif(payload, source, report) {
  const hasHeader = payload.length >= 6 && payload.toString('ascii', 0, 6) === 'Exif\0\0';
  const tiff = hasHeader ? payload.subarray(6) : payload;
  if (tiff.length < 8) {
    report.warn(`${source} EXIF payload is too short to parse.`);
    return;
  }

  const order = tiff.toString('ascii', 0, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') {
    report.warn(`${source} EXIF byte order is not supported.`);
    return;
  }

  const readUInt16 = (offset) => {
    if (offset < 0 || offset + 2 > tiff.length) return null;
    return little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  };
  const readInt16 = (offset) => {
    if (offset < 0 || offset + 2 > tiff.length) return null;
    return little ? tiff.readInt16LE(offset) : tiff.readInt16BE(offset);
  };
  const readUInt32 = (offset) => {
    if (offset < 0 || offset + 4 > tiff.length) return null;
    return little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  };
  const readInt32 = (offset) => {
    if (offset < 0 || offset + 4 > tiff.length) return null;
    return little ? tiff.readInt32LE(offset) : tiff.readInt32BE(offset);
  };

  if (readUInt16(2) !== 42) {
    report.warn(`${source} EXIF TIFF marker is invalid.`);
    return;
  }

  function decodeEntry(type, count, entryOffset) {
    const typeSize = TYPE_SIZES.get(type);
    if (!typeSize || count > Number.MAX_SAFE_INTEGER / typeSize) return null;
    const byteLength = typeSize * count;
    const dataOffset = byteLength <= 4 ? entryOffset + 8 : readUInt32(entryOffset + 8);
    if (dataOffset === null || dataOffset < 0 || dataOffset + byteLength > tiff.length) return null;

    const bytes = tiff.subarray(dataOffset, dataOffset + byteLength);
    if (type === 2) {
      const value = boundedText(bytes, 'utf8');
      return { value: value.text, raw: value.text, truncated: value.truncated };
    }
    if (type === 7) {
      const value = printableUndefined(bytes);
      return { value: value.text, raw: value.text, truncated: value.truncated };
    }

    if (byteLength > MAX_FIELD_BYTES || count > 256) {
      return { value: `[${byteLength} bytes]`, raw: null, truncated: true };
    }

    const values = [];
    for (let index = 0; index < count; index += 1) {
      const offset = dataOffset + (index * typeSize);
      let value;
      if (type === 1) value = tiff.readUInt8(offset);
      else if (type === 3) value = readUInt16(offset);
      else if (type === 4) value = readUInt32(offset);
      else if (type === 5) {
        const numerator = readUInt32(offset);
        const denominator = readUInt32(offset + 4);
        value = denominator ? numerator / denominator : null;
      } else if (type === 6) value = tiff.readInt8(offset);
      else if (type === 8) value = readInt16(offset);
      else if (type === 9) value = readInt32(offset);
      else if (type === 10) {
        const numerator = readInt32(offset);
        const denominator = readInt32(offset + 4);
        value = denominator ? numerator / denominator : null;
      } else if (type === 11) value = little ? tiff.readFloatLE(offset) : tiff.readFloatBE(offset);
      else if (type === 12) value = little ? tiff.readDoubleLE(offset) : tiff.readDoubleBE(offset);
      if (value !== undefined) values.push(value);
    }

    const raw = values.length === 1 ? values[0] : values;
    return {
      value: values.map((value) => value === null ? 'undefined' : Number(value.toFixed?.(8) ?? value)).join(', '),
      raw,
      truncated: false,
    };
  }

  const visited = new Set();
  const gpsValues = new Map();

  function parseIfd(ifdOffset, kind = 'ifd', depth = 0) {
    if (depth > 5 || visited.has(ifdOffset) || ifdOffset < 0 || ifdOffset + 2 > tiff.length) return;
    visited.add(ifdOffset);

    const count = readUInt16(ifdOffset);
    if (count === null || count > MAX_FIELDS) {
      report.warn(`${source} contains an invalid or oversized EXIF directory.`);
      return;
    }

    for (let index = 0; index < count; index += 1) {
      const entryOffset = ifdOffset + 2 + (index * 12);
      if (entryOffset + 12 > tiff.length) {
        report.warn(`${source} contains a truncated EXIF directory.`);
        break;
      }

      const tag = readUInt16(entryOffset);
      const type = readUInt16(entryOffset + 2);
      const valueCount = readUInt32(entryOffset + 4);
      if (tag === null || type === null || valueCount === null) continue;
      const decoded = decodeEntry(type, valueCount, entryOffset);
      if (!decoded) continue;

      if (tag === 0x8769 && typeof decoded.raw === 'number') {
        parseIfd(decoded.raw, 'exif', depth + 1);
      } else if (tag === 0x8825 && typeof decoded.raw === 'number') {
        parseIfd(decoded.raw, 'gps', depth + 1);
      } else if (tag === 0xa005 && typeof decoded.raw === 'number') {
        parseIfd(decoded.raw, 'interop', depth + 1);
      }

      if (POINTER_TAGS.has(tag)) continue;

      const group = kind === 'gps' ? 'gps' : 'exif';
      const tagNames = kind === 'gps' ? GPS_TAG_NAMES : EXIF_TAG_NAMES;
      const name = tagNames.get(tag) ?? `Tag0x${tag.toString(16).padStart(4, '0')}`;
      const ifdLabel = kind === 'gps' ? 'GPS IFD' : kind === 'exif' ? 'Exif IFD' : kind === 'interop' ? 'Interop IFD' : 'IFD';
      report.addField(group, name, decoded.value, `${source} ${ifdLabel}`, privacyForExif(name, group), decoded.truncated);
      if (kind === 'gps') gpsValues.set(tag, decoded.raw);
    }

    const nextPointerOffset = ifdOffset + 2 + (count * 12);
    const nextIfd = readUInt32(nextPointerOffset);
    if (kind === 'ifd' && nextIfd) parseIfd(nextIfd, 'thumbnail', depth + 1);
  }

  const firstIfd = readUInt32(4);
  if (firstIfd !== null) parseIfd(firstIfd);

  function decimalCoordinate(parts, ref) {
    if (!Array.isArray(parts) || parts.length < 3 || typeof ref !== 'string') return null;
    const decimal = Number(parts[0]) + (Number(parts[1]) / 60) + (Number(parts[2]) / 3600);
    if (!Number.isFinite(decimal)) return null;
    return ['S', 'W'].includes(ref.trim().toUpperCase()) ? -decimal : decimal;
  }

  const latitude = decimalCoordinate(gpsValues.get(0x0002), gpsValues.get(0x0001));
  const longitude = decimalCoordinate(gpsValues.get(0x0004), gpsValues.get(0x0003));
  if (latitude !== null) report.addField('gps', 'GPSLatitudeDecimal', latitude.toFixed(8), `${source} derived`, 'high');
  if (longitude !== null) report.addField('gps', 'GPSLongitudeDecimal', longitude.toFixed(8), `${source} derived`, 'high');
}

function addAiSignals(text, source, report) {
  const signals = detectAiSignals(text);
  if (signals.length > 0) {
    report.addField('ai', 'DetectedSignals', signals.join(', '), source, 'medium');
  }
}

function inspectJpeg(buffer, report) {
  let offset = 2;
  while (offset + 1 < buffer.length) {
    const markerStart = offset;
    if (buffer[offset] !== 0xff) {
      report.warn('JPEG metadata parsing stopped at an unexpected byte.');
      break;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      report.warn('JPEG contains a truncated metadata segment.');
      break;
    }

    const payload = buffer.subarray(offset + 2, segmentEnd);
    const prefix = payload.toString('ascii', 0, Math.min(payload.length, 64));
    const source = `JPEG APP${marker - 0xe0}`;
    if (marker === 0xe1 && prefix.startsWith('Exif\0\0')) {
      report.addContainer('exif', source, payload.length, 'medium');
      parseExif(payload, source, report);
    } else if (marker === 0xe1 && (prefix.includes('http://ns.adobe.com/xap/1.0/') || payload.includes(Buffer.from('<x:xmpmeta')))) {
      report.addContainer('xmp', source, payload.length, 'medium');
      const xmlStart = payload.indexOf(Buffer.from('<'));
      const value = boundedText(xmlStart >= 0 ? payload.subarray(xmlStart) : payload);
      report.addField('xmp', 'XMPPacket', value.text, source, 'medium', value.truncated);
      addAiSignals(value.text, source, report);
    } else if (marker === 0xed) {
      report.addContainer('iptc', 'JPEG APP13', payload.length, 'medium');
    } else if (marker === 0xfe) {
      report.addContainer('comment', 'JPEG COM', payload.length, 'medium');
      const value = boundedText(payload, 'latin1');
      report.addField('comment', 'Comment', value.text, 'JPEG COM', 'medium', value.truncated);
      addAiSignals(value.text, 'JPEG COM', report);
    } else if (marker === 0xeb) {
      report.addContainer('c2pa', 'JPEG APP11', payload.length, 'medium');
    } else if (marker === 0xe2 && prefix.startsWith('ICC_PROFILE')) {
      report.addContainer('icc', 'JPEG APP2', payload.length, 'info');
    }
    offset = segmentEnd;
    if (markerStart >= offset) break;
  }
}

function inflateText(buffer, report, source) {
  try {
    const inflated = inflateSync(buffer, { maxOutputLength: MAX_FIELD_BYTES + 1 });
    return boundedText(inflated);
  } catch {
    report.warn(`${source} could not be decompressed within the safety limit.`);
    return { text: '', truncated: false };
  }
}

function parsePngText(type, data, report, source) {
  const separator = data.indexOf(0);
  if (separator < 0) return { keyword: type, text: '', truncated: false };
  const keyword = data.subarray(0, separator).toString('latin1');
  if (type === 'tEXt') {
    const value = boundedText(data.subarray(separator + 1), 'latin1');
    return { keyword, ...value };
  }
  if (type === 'zTXt') {
    const value = inflateText(data.subarray(separator + 2), report, source);
    return { keyword, ...value };
  }

  let cursor = separator + 1;
  const compressed = data[cursor] === 1;
  cursor += 2;
  for (let index = 0; index < 2; index += 1) {
    const next = data.indexOf(0, cursor);
    if (next < 0) return { keyword, text: '', truncated: false };
    cursor = next + 1;
  }
  const value = compressed
    ? inflateText(data.subarray(cursor), report, source)
    : boundedText(data.subarray(cursor));
  return { keyword, ...value };
}

function inspectPng(buffer, report) {
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > buffer.length) {
      report.warn('PNG contains a truncated chunk.');
      break;
    }

    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'eXIf') {
      report.addContainer('exif', 'PNG eXIf', length, 'medium');
      parseExif(data, 'PNG eXIf', report);
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const source = `PNG ${type}`;
      const value = parsePngText(type, data, report, source);
      const aiSignals = detectAiSignals(`${value.keyword}\n${value.text}`);
      const group = aiSignals.length > 0 ? 'ai' : /xmp/i.test(value.keyword) ? 'xmp' : /iptc/i.test(value.keyword) ? 'iptc' : 'png_text';
      report.addContainer(group, `${source} (${value.keyword || 'unnamed'})`, length, group === 'png_text' ? 'medium' : 'medium');
      report.addField(group, value.keyword || type, value.text, source, 'medium', value.truncated);
      if (aiSignals.length > 0) report.addField('ai', 'DetectedSignals', aiSignals.join(', '), source, 'medium');
    } else if (type === 'caBX') {
      report.addContainer('c2pa', 'PNG caBX', length, 'medium');
    } else if (type === 'iCCP') {
      report.addContainer('icc', 'PNG iCCP', length, 'info');
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }
}

function inspectWebP(buffer, report) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length % 2);
    if (dataEnd < dataStart || chunkEnd > buffer.length) {
      report.warn('WebP contains a truncated chunk.');
      break;
    }

    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'EXIF') {
      report.addContainer('exif', 'WebP EXIF', length, 'medium');
      parseExif(data, 'WebP EXIF', report);
    } else if (type === 'XMP ') {
      report.addContainer('xmp', 'WebP XMP', length, 'medium');
      const value = boundedText(data);
      report.addField('xmp', 'XMPPacket', value.text, 'WebP XMP', 'medium', value.truncated);
      addAiSignals(value.text, 'WebP XMP', report);
    } else if (type === 'ICCP') {
      report.addContainer('icc', 'WebP ICCP', length, 'info');
    } else if (type === 'C2PA') {
      report.addContainer('c2pa', 'WebP C2PA', length, 'medium');
    }
    offset = chunkEnd;
  }
}

export function viewMetadata(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let format;
  if (isJpeg(buffer)) format = 'JPEG';
  else if (isPng(buffer)) format = 'PNG';
  else if (isWebP(buffer)) format = 'WebP';
  else throw new UnsupportedImageError();

  const report = createReport(format, buffer.length);
  if (format === 'JPEG') inspectJpeg(buffer, report);
  else if (format === 'PNG') inspectPng(buffer, report);
  else inspectWebP(buffer, report);
  return report.finish();
}
