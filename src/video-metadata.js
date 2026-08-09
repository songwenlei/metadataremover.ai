import { createHash } from 'node:crypto';

export const ONLINE_VIDEO_METADATA_VIEWER_URL = 'https://metadataremover.ai/video-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_viewer';
export const ONLINE_VIDEO_METADATA_REMOVER_URL = 'https://metadataremover.ai/video-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_remover';

const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_REWRITE_BYTES = 64 * 1024 * 1024;
const ADOBE_XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
const MP4_EPOCH_OFFSET_SECONDS = 2_082_844_800;

const MP4_CONTAINER_BOXES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf',
]);
const MP4_METADATA_BOXES = new Set([
  'udta', 'meta', 'ilst', 'XMP_', 'xmp ', '©nam', '©ART', '©alb', '©cmt', '©cpy',
  '©day', '©gen', '©too', '©xyz',
]);
const MP4_DIRECT_METADATA = new Map([
  ['©nam', ['Title', 'medium']],
  ['©ART', ['Artist', 'high']],
  ['©alb', ['Album', 'medium']],
  ['©cmt', ['Comment', 'medium']],
  ['©cpy', ['Copyright', 'medium']],
  ['©day', ['Date', 'medium']],
  ['©gen', ['Genre', 'low']],
  ['©too', ['Encoder / application', 'medium']],
  ['©xyz', ['Location', 'high']],
]);
const MP4_TIME_BOXES = new Set(['mvhd', 'tkhd', 'mdhd']);

const WEBM_SEGMENT_ID = '18538067';
const WEBM_INFO_ID = '1549a966';
const WEBM_TAGS_ID = '1254c367';
const WEBM_ATTACHMENTS_ID = '1941a469';
const WEBM_CLUSTER_ID = '1f43b675';
const WEBM_SIMPLE_TAG_ID = '67c8';
const WEBM_TAG_NAME_ID = '45a3';
const WEBM_TAG_STRING_ID = '4487';
const WEBM_TAG_BINARY_ID = '4485';
const WEBM_INFO_FIELDS = new Map([
  ['7ba9', ['Segment title', 'medium', 'text']],
  ['4461', ['UTC creation date', 'medium', 'date']],
  ['4d80', ['Muxing application', 'medium', 'text']],
  ['5741', ['Writing application', 'medium', 'text']],
]);

export class VideoMetadataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VideoMetadataError';
    this.code = code;
  }
}

function asBuffer(input) {
  let buffer;
  if (Buffer.isBuffer(input)) buffer = input;
  else if (input instanceof Uint8Array) buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  else if (input instanceof ArrayBuffer) buffer = Buffer.from(input);
  else throw new TypeError('Video input must be a Buffer, Uint8Array, or ArrayBuffer.');
  if (!buffer.length) throw new VideoMetadataError('unsupported_video', 'The video file is empty.');
  if (buffer.length > MAX_VIDEO_BYTES) throw new VideoMetadataError('file_too_large', 'Video files larger than 4 GiB are not supported.');
  return buffer;
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function hex(input) {
  return Buffer.from(input).toString('hex');
}

function detectFormat(buffer) {
  if (buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buffer.toString('latin1', 8, 12);
    const quickTime = brand.trim() === 'qt';
    return {
      kind: quickTime ? 'quicktime' : 'iso-bmff',
      format: quickTime ? 'MOV / QuickTime' : 'MP4 / ISO Base Media',
      brand: brand.trim() || brand,
    };
  }
  if (buffer.length >= 4 && hex(buffer.subarray(0, 4)) === '1a45dfa3') {
    return { kind: 'webm', format: 'WebM', brand: null };
  }
  throw new VideoMetadataError('unsupported_video', 'Unsupported video signature: expected MP4, MOV, or WebM container bytes.');
}

function uint64(buffer, offset) {
  if (offset + 8 > buffer.length) throw new VideoMetadataError('malformed_video', 'A 64-bit container value is truncated.');
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VideoMetadataError('unsafe_size', 'A container size exceeds the safe integer range.');
  }
  return Number(value);
}

function mp4BoxHeader(buffer, start, boundary) {
  if (start + 8 > boundary) return null;
  const size32 = buffer.readUInt32BE(start);
  const type = buffer.toString('latin1', start + 4, start + 8);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (start + 16 > boundary) throw new VideoMetadataError('malformed_video', `The ${type || 'unknown'} box has a truncated extended size.`);
    size = uint64(buffer, start + 8);
    headerSize = 16;
  } else if (size32 === 0) {
    size = boundary - start;
  }
  if (size < headerSize || start + size > boundary) {
    throw new VideoMetadataError('malformed_video', `The ${type || 'unknown'} box has an invalid size or crosses its parent boundary.`);
  }
  return { start, end: start + size, size, headerSize, dataStart: start + headerSize, type };
}

function cleanText(bytes) {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start += 1;
  const bounded = bytes.subarray(start, Math.min(bytes.length, start + MAX_TEXT_BYTES));
  const value = new TextDecoder('utf-8', { fatal: false }).decode(bounded)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  return { value, truncated: bytes.length - start > MAX_TEXT_BYTES };
}

function addField(context, field) {
  if (!field.value) return;
  context.fields.push({
    id: `${field.path}:${context.fields.length + 1}`,
    source: field.source,
    path: field.path,
    name: field.name,
    value: field.value,
    privacy: field.privacy,
    truncated: Boolean(field.truncated),
  });
}

function mp4MetadataValue(buffer, box) {
  let firstChild = null;
  try {
    firstChild = mp4BoxHeader(buffer, box.dataStart, box.end);
  } catch {
    // QuickTime user-data atoms may store a raw string rather than child boxes.
  }
  if (firstChild?.type === 'data') {
    const valueStart = Math.min(firstChild.end, firstChild.dataStart + 8);
    return cleanText(buffer.subarray(valueStart, firstChild.end));
  }
  return cleanText(buffer.subarray(box.dataStart, box.end));
}

function mp4Seconds(buffer, offset, width) {
  if (offset + width > buffer.length) return 0;
  return width === 8 ? uint64(buffer, offset) : buffer.readUInt32BE(offset);
}

function mp4Date(seconds) {
  if (!seconds) return '';
  const milliseconds = (seconds - MP4_EPOCH_OFFSET_SECONDS) * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? String(seconds) : date.toISOString();
}

function inspectMp4(buffer, signature) {
  const context = {
    fields: [],
    containers: [],
    warnings: [],
    mediaHash: createHash('sha256'),
    mediaPartCount: 0,
    foundMoov: false,
    unknownUuidCount: 0,
  };

  function readMetadataItem(box, path) {
    const definition = MP4_DIRECT_METADATA.get(box.type) ?? [box.type.trim() || 'Metadata value', 'medium'];
    const decoded = mp4MetadataValue(buffer, box);
    addField(context, {
      path: path.join('/'),
      source: 'MP4 user data',
      name: definition[0],
      value: decoded.value,
      privacy: definition[1],
      truncated: decoded.truncated,
    });
  }

  function scanRange(start, end, path = [], mode = 'normal') {
    let cursor = start;
    while (cursor + 8 <= end) {
      const box = mp4BoxHeader(buffer, cursor, end);
      if (!box) break;
      const boxPath = [...path, box.type];
      if (box.type === 'moov') context.foundMoov = true;
      if (box.type === 'mdat') {
        context.mediaHash.update(buffer.subarray(box.dataStart, box.end));
        context.mediaPartCount += 1;
      } else if (MP4_TIME_BOXES.has(box.type)) {
        if (box.dataStart + 4 <= box.end) {
          const version = buffer[box.dataStart];
          if (version === 0 || version === 1) {
            const width = version === 1 ? 8 : 4;
            const creation = mp4Seconds(buffer, box.dataStart + 4, width);
            const modification = mp4Seconds(buffer, box.dataStart + 4 + width, width);
            if (creation) addField(context, { path: `${boxPath.join('/')}#creation`, source: 'MP4 full box', name: `${box.type} creation time`, value: mp4Date(creation), privacy: 'medium' });
            if (modification) addField(context, { path: `${boxPath.join('/')}#modification`, source: 'MP4 full box', name: `${box.type} modification time`, value: mp4Date(modification), privacy: 'medium' });
          } else {
            context.warnings.push(`${boxPath.join('/')} uses unsupported full-box version ${version}.`);
          }
        }
      } else if (box.type === 'uuid') {
        const userType = buffer.subarray(box.dataStart, Math.min(box.end, box.dataStart + 16));
        if (userType.length === 16 && hex(userType) === ADOBE_XMP_UUID) {
          context.containers.push({ type: 'xmp', path: boxPath.join('/'), size: box.size, privacy: 'medium' });
          const decoded = cleanText(buffer.subarray(box.dataStart + 16, box.end));
          addField(context, { path: boxPath.join('/'), source: 'Adobe XMP UUID', name: 'XMP packet', value: decoded.value, privacy: 'medium', truncated: decoded.truncated });
        } else context.unknownUuidCount += 1;
      } else if (mode === 'ilst-item') {
        readMetadataItem(box, boxPath);
      } else if (MP4_DIRECT_METADATA.has(box.type) || box.type === 'XMP_' || box.type === 'xmp ') {
        readMetadataItem(box, boxPath);
      }

      if (box.type === 'udta') {
        context.containers.push({ type: 'user-data', path: boxPath.join('/'), size: box.size, privacy: 'medium' });
        scanRange(box.dataStart, box.end, boxPath);
      } else if (box.type === 'meta') {
        context.containers.push({ type: 'metadata', path: boxPath.join('/'), size: box.size, privacy: 'medium' });
        scanRange(Math.min(box.end, box.dataStart + 4), box.end, boxPath);
      } else if (box.type === 'ilst') {
        context.containers.push({ type: 'item-list', path: boxPath.join('/'), size: box.size, privacy: 'medium' });
        scanRange(box.dataStart, box.end, boxPath, 'ilst-item');
      } else if (MP4_CONTAINER_BOXES.has(box.type)) {
        scanRange(box.dataStart, box.end, boxPath);
      }
      cursor = box.end;
    }
    if (cursor !== end && end - cursor >= 8) context.warnings.push(`Container scanning stopped at byte ${cursor} inside ${path.join('/') || 'file'}.`);
  }

  scanRange(0, buffer.length);
  if (!context.foundMoov) throw new VideoMetadataError('malformed_video', 'The MP4 or MOV does not expose a standard moov box.');
  if (context.unknownUuidCount) context.warnings.push(`${context.unknownUuidCount} unrecognized UUID box(es) were preserved and not decoded.`);
  if (signature.kind === 'quicktime') context.warnings.push('Vendor-private QuickTime atoms outside supported user-data containers may remain unreadable.');
  return {
    fields: context.fields,
    containers: context.containers,
    warnings: context.warnings,
    mediaPayloadSha256: context.mediaPartCount ? context.mediaHash.digest('hex') : null,
    mediaPartCount: context.mediaPartCount,
  };
}

function vintLength(firstByte, maximum) {
  for (let length = 1; length <= maximum; length += 1) {
    if (firstByte & (1 << (8 - length))) return length;
  }
  return 0;
}

function ebmlHeader(buffer, start, boundary) {
  if (start + 2 > boundary) return null;
  const idLength = vintLength(buffer[start], 4);
  if (!idLength || start + idLength >= boundary) return null;
  const sizeLength = vintLength(buffer[start + idLength], 8);
  if (!sizeLength || start + idLength + sizeLength > boundary) return null;
  const firstMask = (1 << (8 - sizeLength)) - 1;
  let sizeValue = buffer[start + idLength] & firstMask;
  let unknownSize = sizeValue === firstMask;
  for (let index = 1; index < sizeLength; index += 1) {
    if (sizeValue > Math.floor(Number.MAX_SAFE_INTEGER / 256)) {
      throw new VideoMetadataError('unsafe_size', 'An EBML element size exceeds the safe integer range.');
    }
    const byte = buffer[start + idLength + index];
    sizeValue = sizeValue * 256 + byte;
    if (byte !== 0xff) unknownSize = false;
  }
  const dataStart = start + idLength + sizeLength;
  const dataSize = unknownSize ? boundary - dataStart : sizeValue;
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataStart + dataSize > boundary) {
    throw new VideoMetadataError('malformed_video', 'The WebM contains an invalid EBML element size.');
  }
  return {
    id: hex(buffer.subarray(start, start + idLength)),
    start,
    dataStart,
    end: dataStart + dataSize,
    totalSize: idLength + sizeLength + dataSize,
    unknownSize,
  };
}

function webmDate(buffer, element) {
  const bytes = buffer.subarray(element.dataStart, element.end);
  if (bytes.length !== 8) return '';
  const nanoseconds = bytes.readBigInt64BE(0);
  const milliseconds = Number(nanoseconds / 1_000_000n) + Date.UTC(2001, 0, 1);
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function webmPrivacy(name) {
  if (/location|gps|latitude|longitude/i.test(name)) return 'high';
  if (/artist|author|owner|email|account|device|model/i.test(name)) return 'high';
  return 'medium';
}

function inspectWebm(buffer) {
  const context = {
    fields: [],
    containers: [],
    warnings: [],
    mediaHash: createHash('sha256'),
    mediaPartCount: 0,
  };
  let cursor = 0;
  let segment = null;
  while (cursor < buffer.length) {
    const element = ebmlHeader(buffer, cursor, buffer.length);
    if (!element) break;
    if (element.id === WEBM_SEGMENT_ID) {
      segment = element;
      break;
    }
    cursor = element.end;
  }
  if (!segment) throw new VideoMetadataError('malformed_video', 'The WebM does not expose a standard Segment.');

  function parseSimpleTag(start, end, path) {
    let tagName = '';
    let tagValue = '';
    let valueTruncated = false;
    const nested = [];
    let position = start;
    while (position < end) {
      const child = ebmlHeader(buffer, position, end);
      if (!child) break;
      if (child.id === WEBM_TAG_NAME_ID) tagName = cleanText(buffer.subarray(child.dataStart, child.end)).value;
      else if (child.id === WEBM_TAG_STRING_ID || child.id === WEBM_TAG_BINARY_ID) {
        const decoded = cleanText(buffer.subarray(child.dataStart, child.end));
        tagValue = decoded.value;
        valueTruncated = decoded.truncated;
      } else if (child.id === WEBM_SIMPLE_TAG_ID) nested.push(child);
      position = child.end;
    }
    if (tagName && tagValue) addField(context, { path: `${path}/${tagName}`, source: 'WebM SimpleTag', name: tagName, value: tagValue, privacy: webmPrivacy(tagName), truncated: valueTruncated });
    for (const child of nested) parseSimpleTag(child.dataStart, child.end, `${path}/${tagName || 'nested'}`);
  }

  function parseTags(element) {
    const stack = [{ start: element.dataStart, end: element.end, path: 'Segment/Tags' }];
    while (stack.length) {
      const range = stack.pop();
      let position = range.start;
      while (position < range.end) {
        const child = ebmlHeader(buffer, position, range.end);
        if (!child) break;
        if (child.id === WEBM_SIMPLE_TAG_ID) parseSimpleTag(child.dataStart, child.end, range.path);
        else if (['7373', '63c0'].includes(child.id)) stack.push({ start: child.dataStart, end: child.end, path: range.path });
        position = child.end;
      }
    }
  }

  cursor = segment.dataStart;
  while (cursor < segment.end) {
    const element = ebmlHeader(buffer, cursor, segment.end);
    if (!element) break;
    if (element.id === WEBM_CLUSTER_ID) {
      context.mediaHash.update(buffer.subarray(element.start, element.end));
      context.mediaPartCount += 1;
    } else if (element.id === WEBM_TAGS_ID) {
      context.containers.push({ type: 'tags', path: 'Segment/Tags', size: element.totalSize, privacy: 'medium' });
      parseTags(element);
    } else if (element.id === WEBM_ATTACHMENTS_ID) {
      context.containers.push({ type: 'attachments', path: 'Segment/Attachments', size: element.totalSize, privacy: 'high' });
      addField(context, { path: 'Segment/Attachments', source: 'WebM container', name: 'Embedded attachments', value: `${element.totalSize} bytes`, privacy: 'high' });
    } else if (element.id === WEBM_INFO_ID) {
      let infoCursor = element.dataStart;
      while (infoCursor < element.end) {
        const child = ebmlHeader(buffer, infoCursor, element.end);
        if (!child) break;
        const definition = WEBM_INFO_FIELDS.get(child.id);
        if (definition) {
          const value = definition[2] === 'date'
            ? { value: webmDate(buffer, child), truncated: false }
            : cleanText(buffer.subarray(child.dataStart, child.end));
          addField(context, { path: `Segment/Info/${definition[0].replaceAll(' ', '')}`, source: 'WebM Info', name: definition[0], value: value.value, privacy: definition[1], truncated: value.truncated });
        }
        infoCursor = child.end;
      }
    }
    if (element.unknownSize && element.id !== WEBM_SEGMENT_ID) {
      context.warnings.push(`An unknown-size WebM element (${element.id}) stopped later metadata scanning.`);
      break;
    }
    cursor = element.end;
  }
  return {
    fields: context.fields,
    containers: context.containers,
    warnings: context.warnings,
    mediaPayloadSha256: context.mediaPartCount ? context.mediaHash.digest('hex') : null,
    mediaPartCount: context.mediaPartCount,
  };
}

export function viewVideoMetadata(input) {
  const buffer = asBuffer(input);
  const signature = detectFormat(buffer);
  const inspected = signature.kind === 'webm' ? inspectWebm(buffer) : inspectMp4(buffer, signature);
  return {
    schemaVersion: 1,
    format: signature.format,
    container: signature.kind,
    brand: signature.brand,
    size: buffer.length,
    sha256: sha256(buffer),
    mediaPayloadSha256: inspected.mediaPayloadSha256,
    mediaPartCount: inspected.mediaPartCount,
    fields: inspected.fields,
    containers: inspected.containers,
    warnings: inspected.warnings,
    limitations: [
      'The viewer reads a focused set of MP4/MOV user-data atoms, container timestamps, Adobe XMP UUID data, WebM Info values, Tags, and attachment presence.',
      'Codec bitstreams, visible frames, spoken audio, burned-in text, unknown vendor-private atoms, and filesystem metadata are not inspected.',
      'Track names, language, chapters, HDR/VR data, and arbitrary binary values may be preserved without a field-level report.',
      'A missing supported field is not proof that the video contains no private or identifying information.',
    ],
  };
}

function zeroReplacement(length) {
  if (length > MAX_REWRITE_BYTES) throw new VideoMetadataError('rewrite_too_large', 'A metadata area exceeds the 64 MiB rewrite safety limit.');
  return Buffer.alloc(length);
}

function freeBoxReplacement(buffer, box) {
  const replacement = zeroReplacement(box.size);
  buffer.copy(replacement, 0, box.start, box.start + box.headerSize);
  replacement.write('free', 4, 'latin1');
  return replacement;
}

function planMp4Removal(buffer, signature) {
  const patches = [];
  const warnings = [];
  let foundMoov = false;
  let unknownUuidCount = 0;

  function scanRange(start, end, path = []) {
    let cursor = start;
    while (cursor + 8 <= end) {
      const box = mp4BoxHeader(buffer, cursor, end);
      if (!box) break;
      const boxPath = [...path, box.type];
      if (MP4_METADATA_BOXES.has(box.type)) {
        patches.push({ start: box.start, end: box.end, replacement: freeBoxReplacement(buffer, box), label: `${box.type.trim() || 'metadata'} metadata box`, path: boxPath.join('/'), kind: 'metadata' });
      } else if (box.type === 'uuid') {
        const userType = buffer.subarray(box.dataStart, Math.min(box.end, box.dataStart + 16));
        if (userType.length === 16 && hex(userType) === ADOBE_XMP_UUID) {
          patches.push({ start: box.start, end: box.end, replacement: freeBoxReplacement(buffer, box), label: 'Adobe XMP UUID box', path: boxPath.join('/'), kind: 'metadata' });
        } else unknownUuidCount += 1;
      } else if (MP4_TIME_BOXES.has(box.type) && box.dataStart + 4 <= box.end) {
        const version = buffer[box.dataStart];
        if (version === 0 || version === 1) {
          const timeLength = version === 1 ? 16 : 8;
          const timeStart = box.dataStart + 4;
          if (timeStart + timeLength <= box.end) {
            patches.push({ start: timeStart, end: timeStart + timeLength, replacement: zeroReplacement(timeLength), label: `${box.type} creation and modification times`, path: boxPath.join('/'), kind: 'timestamp' });
          }
        } else warnings.push(`${boxPath.join('/')} uses unsupported full-box version ${version}; timestamps were preserved.`);
      }
      if (box.type === 'moov') foundMoov = true;
      if (MP4_CONTAINER_BOXES.has(box.type)) scanRange(box.dataStart, box.end, boxPath);
      cursor = box.end;
    }
  }
  scanRange(0, buffer.length);
  if (!foundMoov) throw new VideoMetadataError('malformed_video', 'The MP4 or MOV does not expose a standard moov box that can be cleaned safely.');
  if (unknownUuidCount) warnings.push(`${unknownUuidCount} unrecognized UUID box(es) were preserved because their structural role is unknown.`);
  if (signature.kind === 'quicktime') warnings.push('Vendor-private QuickTime atoms outside standard user-data containers are preserved.');
  return { patches, warnings };
}

function encodeEbmlSize(value, length) {
  const bytes = Buffer.alloc(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 1 << (8 - length);
  return bytes;
}

function voidElement(totalSize) {
  if (totalSize > MAX_REWRITE_BYTES) throw new VideoMetadataError('rewrite_too_large', 'A WebM metadata element exceeds the 64 MiB rewrite safety limit.');
  for (let sizeLength = 1; sizeLength <= 8; sizeLength += 1) {
    const payloadLength = totalSize - 1 - sizeLength;
    const maximum = 2 ** (7 * sizeLength) - 2;
    if (payloadLength >= 0 && payloadLength <= maximum) {
      return Buffer.concat([Buffer.from([0xec]), encodeEbmlSize(payloadLength, sizeLength), Buffer.alloc(payloadLength)]);
    }
  }
  throw new VideoMetadataError('unsafe_size', 'A WebM metadata element cannot be replaced with a same-length Void element.');
}

function planWebmRemoval(buffer) {
  const patches = [];
  const warnings = [];
  let cursor = 0;
  let segment = null;
  while (cursor < buffer.length) {
    const element = ebmlHeader(buffer, cursor, buffer.length);
    if (!element) break;
    if (element.id === WEBM_SEGMENT_ID) {
      segment = element;
      break;
    }
    cursor = element.end;
  }
  if (!segment) throw new VideoMetadataError('malformed_video', 'The WebM does not expose a standard Segment that can be cleaned safely.');
  cursor = segment.dataStart;
  while (cursor < segment.end) {
    const element = ebmlHeader(buffer, cursor, segment.end);
    if (!element) break;
    if (element.id === WEBM_TAGS_ID || element.id === WEBM_ATTACHMENTS_ID) {
      patches.push({
        start: element.start,
        end: element.end,
        replacement: voidElement(element.totalSize),
        label: element.id === WEBM_TAGS_ID ? 'WebM Tags' : 'WebM Attachments',
        path: `Segment/${element.id === WEBM_TAGS_ID ? 'Tags' : 'Attachments'}`,
        kind: 'metadata',
      });
    } else if (element.id === WEBM_INFO_ID) {
      let infoCursor = element.dataStart;
      while (infoCursor < element.end) {
        const child = ebmlHeader(buffer, infoCursor, element.end);
        if (!child) break;
        const definition = WEBM_INFO_FIELDS.get(child.id);
        if (definition) patches.push({ start: child.start, end: child.end, replacement: voidElement(child.totalSize), label: definition[0], path: `Segment/Info/${definition[0].replaceAll(' ', '')}`, kind: child.id === '4461' ? 'timestamp' : 'metadata' });
        infoCursor = child.end;
      }
    }
    if (element.unknownSize && element.id !== WEBM_SEGMENT_ID) {
      warnings.push(`An unknown-size WebM element (${element.id}) stopped deeper scanning; later metadata may remain.`);
      break;
    }
    cursor = element.end;
  }
  warnings.push('Track names, language, codec identifiers, chapter structure, and codec bitstreams are preserved.');
  return { patches, warnings };
}

function validatePatches(patches, sourceSize) {
  const sorted = [...patches].sort((left, right) => left.start - right.start);
  let cursor = 0;
  let rewritten = 0;
  for (const patch of sorted) {
    if (patch.start < cursor || patch.start < 0 || patch.end <= patch.start || patch.end > sourceSize || patch.replacement.length !== patch.end - patch.start) {
      throw new VideoMetadataError('invalid_patch_plan', 'The remover produced an overlapping or size-changing patch plan.');
    }
    rewritten += patch.replacement.length;
    if (rewritten > MAX_REWRITE_BYTES) throw new VideoMetadataError('rewrite_too_large', 'Combined metadata rewrites exceed the 64 MiB safety limit.');
    cursor = patch.end;
  }
  return sorted;
}

export function removeVideoMetadata(input) {
  const buffer = asBuffer(input);
  const signature = detectFormat(buffer);
  const before = viewVideoMetadata(buffer);
  const planned = signature.kind === 'webm' ? planWebmRemoval(buffer) : planMp4Removal(buffer, signature);
  const patches = validatePatches(planned.patches, buffer.length);
  if (!patches.length) throw new VideoMetadataError('no_supported_metadata', 'No supported video metadata boxes or timestamps were found to remove without remuxing.');
  const output = Buffer.from(buffer);
  for (const patch of patches) patch.replacement.copy(output, patch.start);
  const after = viewVideoMetadata(output);
  const checks = [
    { id: 'same-length', passed: output.length === buffer.length, detail: `${buffer.length} bytes before and after.` },
    { id: 'same-container', passed: before.container === after.container, detail: `${after.format} signature remained readable.` },
    { id: 'media-payload', passed: Boolean(before.mediaPayloadSha256) && before.mediaPayloadSha256 === after.mediaPayloadSha256, detail: before.mediaPayloadSha256 ? 'Media payload hash stayed unchanged.' : 'No standard mdat or Cluster payload was available for hashing.' },
    { id: 'supported-fields', passed: after.fields.length === 0, detail: `${before.fields.length - after.fields.length} supported readable metadata field(s) no longer appear.` },
  ];
  if (!checks.every((check) => check.passed)) {
    throw new VideoMetadataError('verification_failed', 'The cleaned video did not pass same-length, container, media-payload, and readback verification.');
  }
  return {
    buffer: output,
    report: {
      format: after.format,
      container: after.container,
      sourceSize: buffer.length,
      outputSize: output.length,
      fieldsRemoved: before.fields.length - after.fields.length,
      removedAreas: patches.map((patch) => ({ label: patch.label, path: patch.path, byteLength: patch.end - patch.start, kind: patch.kind })),
      mediaPayloadSha256: after.mediaPayloadSha256,
      verified: true,
      checks,
      warnings: [...before.warnings, ...planned.warnings],
      limitations: after.limitations,
    },
  };
}
