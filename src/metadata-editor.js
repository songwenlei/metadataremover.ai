import { viewMetadata } from './metadata-viewer.js';

export const ONLINE_METADATA_EDITOR_URL = 'https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor';

export const EDITABLE_IMAGE_FIELDS = ['title', 'creator', 'copyright', 'date'];

const FIELD_TAGS = new Map([
  [0x010e, 'title'],
  [0x013b, 'creator'],
  [0x8298, 'copyright'],
  [0x0132, 'date'],
]);

export class ImageMetadataEditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageMetadataEditError';
    this.code = code;
  }
}

function tiffStart(buffer, dataStart, dataEnd) {
  if (dataEnd - dataStart >= 6 && buffer.toString('ascii', dataStart, dataStart + 6) === 'Exif\0\0') return dataStart + 6;
  return dataStart;
}

function findExifContainers(buffer, format) {
  const containers = [];
  if (format === 'JPEG') {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) throw new ImageMetadataEditError('malformed_image', 'Malformed JPEG marker sequence.');
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) throw new ImageMetadataEditError('malformed_image', 'Malformed JPEG segment length.');
      const segmentLength = buffer.readUInt16BE(offset);
      const dataStart = offset + 2;
      const dataEnd = offset + segmentLength;
      if (segmentLength < 2 || dataEnd > buffer.length) throw new ImageMetadataEditError('malformed_image', 'Malformed JPEG segment boundary.');
      if (marker === 0xe1 && buffer.toString('ascii', dataStart, Math.min(dataEnd, dataStart + 6)) === 'Exif\0\0') {
        containers.push({ dataStart, dataEnd, tiffStart: dataStart + 6 });
      }
      offset = dataEnd;
    }
  } else if (format === 'PNG') {
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + 4;
      if (chunkEnd > buffer.length) throw new ImageMetadataEditError('malformed_image', 'Malformed PNG chunk boundary.');
      if (type === 'eXIf') containers.push({ dataStart, dataEnd, tiffStart: tiffStart(buffer, dataStart, dataEnd), crcStart: offset + 4, crcOffset: dataEnd });
      offset = chunkEnd;
      if (type === 'IEND') break;
    }
  } else {
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new ImageMetadataEditError('malformed_image', 'Malformed WebP RIFF size.');
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const type = buffer.toString('ascii', offset, offset + 4);
      const length = buffer.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + (length % 2);
      if (chunkEnd > buffer.length) throw new ImageMetadataEditError('malformed_image', 'Malformed WebP chunk boundary.');
      if (type === 'EXIF') containers.push({ dataStart, dataEnd, tiffStart: tiffStart(buffer, dataStart, dataEnd) });
      offset = chunkEnd;
    }
  }
  return containers;
}

function parseEntries(buffer, container) {
  const start = container.tiffStart;
  if (start + 8 > container.dataEnd) return [];
  const order = buffer.toString('ascii', start, start + 2);
  if (order !== 'II' && order !== 'MM') return [];
  const little = order === 'II';
  const read16 = (offset) => little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const read32 = (offset) => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (read16(start + 2) !== 42) return [];
  const ifdStart = start + read32(start + 4);
  if (ifdStart + 2 > container.dataEnd) return [];
  const count = read16(ifdStart);
  if (count > 4096 || ifdStart + 2 + (count * 12) > container.dataEnd) return [];
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entry = ifdStart + 2 + (index * 12);
    const key = FIELD_TAGS.get(read16(entry));
    if (!key) continue;
    const type = read16(entry + 2);
    const length = read32(entry + 4);
    if (type !== 2 || !length || length > 64 * 1024) continue;
    const valueStart = length <= 4 ? entry + 8 : start + read32(entry + 8);
    if (valueStart < start || valueStart + length > container.dataEnd) continue;
    const nul = buffer.indexOf(0, valueStart);
    const valueEnd = nul >= valueStart && nul < valueStart + length ? nul : valueStart + length;
    entries.push({ key, start: valueStart, length, value: buffer.toString('ascii', valueStart, valueEnd), container });
  }
  return entries;
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, value) => {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      return crc >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeChanges(changes) {
  const normalized = {};
  for (const [key, rawValue] of Object.entries(changes ?? {})) {
    if (!EDITABLE_IMAGE_FIELDS.includes(key)) throw new ImageMetadataEditError('unsupported_field', `Unsupported image metadata field: ${key}`);
    if (rawValue === null) normalized[key] = null;
    else {
      const value = String(rawValue);
      if (/[^\x20-\x7e]/.test(value)) {
        throw new ImageMetadataEditError('unsupported_text', `${key} must use printable ASCII in this focused CLI editor.`);
      }
      normalized[key] = value;
    }
  }
  if (!Object.keys(normalized).length) throw new ImageMetadataEditError('no_changes', 'Change or clear at least one supported image metadata field.');
  return normalized;
}

export function editImageMetadata(input, changes) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const format = viewMetadata(source).format;
  const normalized = normalizeChanges(changes);
  const output = Buffer.from(source);
  const containers = findExifContainers(output, format);
  const entries = containers.flatMap((container) => parseEntries(output, container));
  const missing = Object.keys(normalized).filter((key) => !entries.some((entry) => entry.key === key));
  if (missing.length) {
    throw new ImageMetadataEditError('missing_field', `The source has no editable EXIF ${missing.join(', ')} field. This focused command does not add missing fields.`);
  }

  const operations = [];
  const touchedContainers = new Set();
  for (const [key, requested] of Object.entries(normalized)) {
    const matches = entries.filter((entry) => entry.key === key);
    const expected = requested ?? '';
    for (const entry of matches) {
      if (requested !== null && Buffer.byteLength(requested, 'ascii') + 1 > entry.length) {
        throw new ImageMetadataEditError('value_too_long', `${key} is longer than the existing ${entry.length}-byte EXIF slot. Use the online editor to rebuild variable-length metadata.`);
      }
    }
    const changed = matches.some((entry) => entry.value !== expected);
    operations.push({ key, action: requested === null ? 'cleared' : 'updated', before: matches[0].value, after: expected, changed });
    if (!changed) continue;
    for (const entry of matches) {
      output.fill(0, entry.start, entry.start + entry.length);
      if (requested !== null) output.write(requested, entry.start, 'ascii');
      touchedContainers.add(entry.container);
    }
  }
  if (!operations.some((operation) => operation.changed)) {
    throw new ImageMetadataEditError('no_changes', 'The requested values already match the source metadata.');
  }
  for (const container of touchedContainers) {
    if (container.crcOffset !== undefined) {
      output.writeUInt32BE(crc32(output.subarray(container.crcStart, container.crcOffset)), container.crcOffset);
    }
  }

  const verifiedEntries = findExifContainers(output, format).flatMap((container) => parseEntries(output, container));
  for (const [key, requested] of Object.entries(normalized)) {
    const expected = requested ?? '';
    const matches = verifiedEntries.filter((entry) => entry.key === key);
    if (!matches.length || matches.some((entry) => entry.value !== expected)) {
      throw new ImageMetadataEditError('verification_failed', `The edited ${key} value did not pass EXIF readback verification.`);
    }
  }
  return {
    buffer: output,
    report: {
      schemaVersion: 1,
      format,
      inputBytes: source.length,
      outputBytes: output.length,
      changedFields: operations.filter((operation) => operation.changed).map(({ changed, ...operation }) => operation),
      exifContainersChanged: touchedContainers.size,
      sameLength: output.length === source.length,
      verified: true,
    },
  };
}
