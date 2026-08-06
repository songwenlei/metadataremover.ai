import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib';

export const ONLINE_PDF_METADATA_VIEWER_URL = 'https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer';
export const ONLINE_PDF_METADATA_EDITOR_URL = 'https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor';
export const ONLINE_PDF_METADATA_REMOVER_URL = 'https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover';

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_FIELDS = 256;
const MAX_VALUE_LENGTH = 64 * 1024;
const MAX_XMP_BYTES = 1024 * 1024;
const METADATA_NAME = PDFName.of('Metadata');
const FILTER_NAME = PDFName.of('Filter');
const DECODE_PARMS_NAME = PDFName.of('DecodeParms');
const BYTE_RANGE_NAME = PDFName.of('ByteRange');
const TYPE_NAME = PDFName.of('Type');
const FIELD_TYPE_NAME = PDFName.of('FT');
const SIG_NAME = PDFName.of('Sig');

const FIELD_DEFINITIONS = {
  title: { pdfName: 'Title', kind: 'text' },
  author: { pdfName: 'Author', kind: 'text' },
  subject: { pdfName: 'Subject', kind: 'text' },
  keywords: { pdfName: 'Keywords', kind: 'text' },
  creator: { pdfName: 'Creator', kind: 'text' },
  producer: { pdfName: 'Producer', kind: 'text' },
  creationDate: { pdfName: 'CreationDate', kind: 'date' },
  modificationDate: { pdfName: 'ModDate', kind: 'date' },
};

const PDF_NAME_TO_FIELD = new Map(
  Object.entries(FIELD_DEFINITIONS).map(([field, definition]) => [definition.pdfName, field]),
);

export const EDITABLE_PDF_FIELDS = Object.freeze(Object.keys(FIELD_DEFINITIONS));

export class UnsupportedPdfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedPdfError';
  }
}

export class SignedPdfError extends Error {
  constructor() {
    super('Signed PDFs are read-only in this focused CLI because rewriting metadata changes signed bytes. Use the online PDF tool for an explicit unsigned-copy workflow.');
    this.name = 'SignedPdfError';
  }
}

export class PdfVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfVerificationError';
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function asUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError('PDF input must be a Uint8Array, Buffer, or ArrayBuffer.');
}

function validateInput(input) {
  const bytes = asUint8Array(input);
  if (bytes.length === 0) throw new UnsupportedPdfError('The PDF is empty.');
  if (bytes.length > MAX_PDF_BYTES) {
    throw new UnsupportedPdfError(`PDF files larger than ${MAX_PDF_BYTES / (1024 * 1024)} MiB are not supported.`);
  }
  const headerWindow = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString('latin1');
  if (!headerWindow.includes('%PDF-')) {
    throw new UnsupportedPdfError('Unsupported file signature: expected a PDF header in the first 1,024 bytes.');
  }
  return bytes;
}

async function loadPdf(input) {
  const bytes = validateInput(input);
  try {
    const pdfDoc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    return { bytes, pdfDoc };
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/encrypted/i.test(message)) {
      throw new UnsupportedPdfError('Encrypted or password-protected PDFs are not supported. Decrypt an authorized copy first.');
    }
    throw new UnsupportedPdfError(`Unable to parse PDF safely: ${message}`);
  }
}

function existingInfoDict(pdfDoc) {
  const reference = pdfDoc.context.trailerInfo.Info;
  const dictionary = pdfDoc.context.lookup(reference);
  return dictionary instanceof PDFDict ? { dictionary, reference } : { dictionary: undefined, reference };
}

function getOrCreateInfoDict(pdfDoc) {
  const current = existingInfoDict(pdfDoc);
  if (current.dictionary) return current.dictionary;
  const dictionary = pdfDoc.context.obj({});
  pdfDoc.context.trailerInfo.Info = pdfDoc.context.register(dictionary);
  return dictionary;
}

function resolvedObject(pdfDoc, object) {
  if (object instanceof PDFRef) return pdfDoc.context.lookup(object);
  return object;
}

function truncate(value, maximum = MAX_VALUE_LENGTH) {
  const text = String(value);
  return {
    value: text.length > maximum ? text.slice(0, maximum) : text,
    truncated: text.length > maximum,
  };
}

function decodeInfoValue(pdfDoc, name, object) {
  const value = resolvedObject(pdfDoc, object);
  if (value instanceof PDFString || value instanceof PDFHexString) {
    if (name === 'CreationDate' || name === 'ModDate') {
      try {
        return value.decodeDate().toISOString();
      } catch {
        // Keep a malformed date visible as text instead of losing evidence.
      }
    }
    return value.decodeText();
  }
  if (value instanceof PDFName) return value.decodeText();
  if (value instanceof PDFNumber) return String(value.asNumber());
  if (value instanceof PDFBool) return String(value.asBoolean());
  if (value === PDFNull || value === undefined) return '';
  return value.toString();
}

function privacyForInfoName(name) {
  if (name === 'Author' || name === 'Keywords') return 'high';
  if (name === 'Title' || name === 'Subject' || name === 'Creator' || name === 'Producer') return 'medium';
  if (name === 'CreationDate' || name === 'ModDate') return 'medium';
  return 'medium';
}

function readInfoFields(pdfDoc, warnings) {
  const { dictionary } = existingInfoDict(pdfDoc);
  if (!dictionary) return [];
  const fields = [];
  const entries = dictionary.entries().sort(([left], [right]) => left.decodeText().localeCompare(right.decodeText()));
  for (const [nameObject, valueObject] of entries.slice(0, MAX_FIELDS)) {
    const name = nameObject.decodeText();
    try {
      const decoded = truncate(decodeInfoValue(pdfDoc, name, valueObject));
      fields.push({
        path: `Info.${name}`,
        name,
        field: PDF_NAME_TO_FIELD.get(name) ?? null,
        value: decoded.value,
        source: 'PDF Info dictionary',
        privacy: privacyForInfoName(name),
        truncated: decoded.truncated,
      });
    } catch (error) {
      warnings.push(`Info.${name} could not be decoded: ${error.message}`);
    }
  }
  if (entries.length > MAX_FIELDS) warnings.push(`Info dictionary output was capped at ${MAX_FIELDS} fields.`);
  return fields;
}

function filterName(pdfDoc, stream) {
  const filter = resolvedObject(pdfDoc, stream.dict.get(FILTER_NAME));
  if (!filter) return null;
  if (filter instanceof PDFName) return filter.decodeText();
  if (filter instanceof PDFArray) return filter.toString();
  return 'unsupported';
}

function readXmp(pdfDoc, warnings) {
  const reference = pdfDoc.catalog.get(METADATA_NAME);
  const stream = resolvedObject(pdfDoc, reference);
  if (!(stream instanceof PDFStream)) return null;

  const raw = stream.getContents();
  const rawHash = sha256(raw);
  let decoded;
  const filter = filterName(pdfDoc, stream);
  try {
    if (!filter) {
      if (raw.length > MAX_XMP_BYTES) throw new Error('uncompressed packet exceeds the read limit');
      decoded = raw;
    } else if (filter === 'FlateDecode' && !stream.dict.get(DECODE_PARMS_NAME)) {
      decoded = inflateSync(raw, { maxOutputLength: MAX_XMP_BYTES + 1 });
      if (decoded.length > MAX_XMP_BYTES) throw new Error('decompressed packet exceeds the read limit');
    } else {
      warnings.push(`Document XMP uses ${filter} filtering and is reported as a container without decoded values.`);
    }
  } catch (error) {
    warnings.push(`Document XMP could not be decoded within the ${MAX_XMP_BYTES / (1024 * 1024)} MiB safety limit: ${error.message}`);
  }

  const result = {
    source: 'Catalog.Metadata',
    length: raw.length,
    sha256: rawHash,
    filter,
    readable: Boolean(decoded),
  };
  if (decoded) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(decoded);
    const bounded = truncate(text, MAX_XMP_BYTES);
    result.value = bounded.value;
    result.truncated = bounded.truncated;
  }
  return result;
}

function nameEquals(pdfDoc, object, expected) {
  const value = resolvedObject(pdfDoc, object);
  return value instanceof PDFName && value.decodeText() === expected.decodeText();
}

function numericByteRange(pdfDoc, object) {
  const value = resolvedObject(pdfDoc, object);
  if (!(value instanceof PDFArray) || value.size() !== 4) return null;
  const numbers = [];
  for (let index = 0; index < value.size(); index += 1) {
    const entry = resolvedObject(pdfDoc, value.get(index));
    if (!(entry instanceof PDFNumber)) return null;
    numbers.push(entry.asNumber());
  }
  return numbers;
}

function signatureReport(pdfDoc, inputLength, rawBytes) {
  const records = [];
  for (const [reference, object] of pdfDoc.context.enumerateIndirectObjects()) {
    const dictionary = object instanceof PDFDict
      ? object
      : object instanceof PDFRawStream
        ? object.dict
        : null;
    if (!dictionary) continue;
    const byteRange = numericByteRange(pdfDoc, dictionary.get(BYTE_RANGE_NAME));
    const isSignature = nameEquals(pdfDoc, dictionary.get(TYPE_NAME), SIG_NAME)
      || nameEquals(pdfDoc, dictionary.get(FIELD_TYPE_NAME), SIG_NAME)
      || Boolean(byteRange);
    if (!isSignature) continue;
    const record = { object: reference.toString(), byteRange };
    if (byteRange) {
      const [firstStart, firstLength, secondStart, secondLength] = byteRange;
      record.byteRangeInBounds = Number.isInteger(firstStart)
        && Number.isInteger(firstLength)
        && Number.isInteger(secondStart)
        && Number.isInteger(secondLength)
        && firstStart === 0
        && firstLength >= 0
        && secondStart >= firstLength
        && secondLength >= 0
        && secondStart + secondLength <= inputLength;
      record.unsignedGapBytes = secondStart - (firstStart + firstLength);
      record.bytesAfterSignedRevision = inputLength - (secondStart + secondLength);
    }
    records.push(record);
    if (records.length === 128) break;
  }

  const rawText = Buffer.from(rawBytes).toString('latin1');
  const rawByteRangeCount = (rawText.match(/\/ByteRange\s*\[/g) ?? []).length;
  return {
    detected: records.length > 0 || rawByteRangeCount > 0,
    fields: records,
    rawByteRangeCount,
    limitation: 'Signature dictionaries and byte ranges are detected only; signer identity, certificate trust, revocation, timestamps, and PAdES validity are not verified.',
  };
}

function inspectLoadedPdf(pdfDoc, bytes) {
  const warnings = [];
  const fields = readInfoFields(pdfDoc, warnings);
  const xmp = readXmp(pdfDoc, warnings);
  const signatures = signatureReport(pdfDoc, bytes.length, bytes);
  if (signatures.detected) warnings.push(signatures.limitation);
  return {
    format: 'PDF',
    size: bytes.length,
    sha256: sha256(bytes),
    pageCount: pdfDoc.getPageCount(),
    fields,
    xmp,
    signatures,
    warnings,
    limitations: [
      'Visible page text, annotations, attachments, embedded files, JavaScript, hidden layers, and embedded-image metadata are not inspected.',
      'A missing readable field is not proof that the PDF contains no private information.',
    ],
  };
}

export async function viewPdfMetadata(input) {
  const { bytes, pdfDoc } = await loadPdf(input);
  return inspectLoadedPdf(pdfDoc, bytes);
}

function assertUnsigned(report) {
  if (report.signatures.detected) throw new SignedPdfError();
}

function normalizedChanges(changes) {
  if (!changes || typeof changes !== 'object') throw new TypeError('Metadata changes must be an object.');
  const normalized = {};
  for (const [field, value] of Object.entries(changes)) {
    const definition = FIELD_DEFINITIONS[field];
    if (!definition) throw new TypeError(`Unsupported PDF metadata field: ${field}`);
    if (value === null) {
      normalized[field] = null;
    } else if (definition.kind === 'date') {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid ISO date or Date.`);
      normalized[field] = date;
    } else {
      const text = String(value);
      if (text.length > 16 * 1024) throw new TypeError(`${field} exceeds the 16 KiB edit limit.`);
      normalized[field] = text;
    }
  }
  if (Object.keys(normalized).length === 0) throw new TypeError('Provide at least one metadata change.');
  return normalized;
}

function applyInfoChanges(pdfDoc, changes) {
  const dictionary = getOrCreateInfoDict(pdfDoc);
  for (const [field, value] of Object.entries(changes)) {
    const definition = FIELD_DEFINITIONS[field];
    const name = PDFName.of(definition.pdfName);
    if (value === null) dictionary.delete(name);
    else if (definition.kind === 'date') dictionary.set(name, PDFString.fromDate(value));
    else dictionary.set(name, PDFHexString.fromText(value));
  }
}

function fieldMap(report) {
  return new Map(report.fields.map((field) => [field.field ?? field.name, field.value]));
}

function comparableEditValue(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export async function editPdfMetadata(input, changes) {
  const { bytes, pdfDoc } = await loadPdf(input);
  const before = inspectLoadedPdf(pdfDoc, bytes);
  assertUnsigned(before);
  const requested = normalizedChanges(changes);
  applyInfoChanges(pdfDoc, requested);
  const output = Buffer.from(await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false }));
  const after = await viewPdfMetadata(output);
  const afterFields = fieldMap(after);
  const failures = [];
  for (const [field, value] of Object.entries(requested)) {
    const actual = afterFields.get(field);
    const expected = comparableEditValue(value);
    if (value === null ? actual !== undefined : actual !== expected) {
      failures.push(`${field}: expected ${value === null ? 'removal' : JSON.stringify(expected)}, read back ${JSON.stringify(actual)}`);
    }
  }
  if (after.pageCount !== before.pageCount) failures.push('page count changed');
  if (failures.length > 0) throw new PdfVerificationError(`PDF metadata edit verification failed: ${failures.join('; ')}`);

  return {
    buffer: output,
    report: {
      format: 'PDF',
      inputBytes: bytes.length,
      outputBytes: output.length,
      inputSha256: before.sha256,
      outputSha256: after.sha256,
      pageCount: after.pageCount,
      changedFields: Object.entries(requested).map(([field, value]) => ({
        field,
        action: value === null ? 'removed' : 'set',
        value: value === null ? null : comparableEditValue(value),
      })),
      xmpPreserved: before.xmp?.sha256 === after.xmp?.sha256,
      verified: true,
      warnings: [
        'This focused editor changes PDF Info fields only; document XMP is preserved and may contain a different value.',
        'Page count is verified, but visible rendering is not compared pixel by pixel.',
      ],
    },
  };
}

function removeInfoDictionary(pdfDoc) {
  const { dictionary, reference } = existingInfoDict(pdfDoc);
  const removed = dictionary?.keys().length ?? 0;
  if (reference instanceof PDFRef) pdfDoc.context.delete(reference);
  delete pdfDoc.context.trailerInfo.Info;
  return removed;
}

function removeDocumentXmp(pdfDoc) {
  const reference = pdfDoc.catalog.get(METADATA_NAME);
  const stream = resolvedObject(pdfDoc, reference);
  if (!(stream instanceof PDFStream)) return 0;
  pdfDoc.catalog.delete(METADATA_NAME);
  if (reference instanceof PDFRef) pdfDoc.context.delete(reference);
  return 1;
}

function pruneUnreachableObjects(pdfDoc) {
  const reachable = new Set();
  const visit = (object) => {
    if (!object) return;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) return;
      reachable.add(key);
      visit(pdfDoc.context.lookup(object));
      return;
    }
    if (object instanceof PDFStream) {
      visit(object.dict);
      return;
    }
    if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) visit(value);
      return;
    }
    if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index += 1) visit(object.get(index));
    }
  };

  for (const root of Object.values(pdfDoc.context.trailerInfo)) visit(root);
  let removed = 0;
  for (const [reference] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!reachable.has(reference.toString())) {
      pdfDoc.context.delete(reference);
      removed += 1;
    }
  }
  return removed;
}

export async function removePdfMetadata(input) {
  const { bytes, pdfDoc } = await loadPdf(input);
  const before = inspectLoadedPdf(pdfDoc, bytes);
  assertUnsigned(before);
  const infoFieldsRemoved = removeInfoDictionary(pdfDoc);
  const xmpPacketsRemoved = removeDocumentXmp(pdfDoc);
  const unreachableObjectsRemoved = pruneUnreachableObjects(pdfDoc);
  const output = Buffer.from(await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false }));
  const after = await viewPdfMetadata(output);
  const failures = [];
  if (after.fields.length > 0) failures.push(`${after.fields.length} Info field(s) remain`);
  if (after.xmp) failures.push('document XMP remains');
  if (after.pageCount !== before.pageCount) failures.push('page count changed');
  if (failures.length > 0) throw new PdfVerificationError(`PDF metadata removal verification failed: ${failures.join('; ')}`);

  return {
    buffer: output,
    report: {
      format: 'PDF',
      inputBytes: bytes.length,
      outputBytes: output.length,
      byteDelta: output.length - bytes.length,
      inputSha256: before.sha256,
      outputSha256: after.sha256,
      pageCount: after.pageCount,
      infoFieldsRemoved,
      xmpPacketsRemoved,
      unreachableObjectsRemoved,
      verified: true,
      warnings: [
        'Visible page text, annotations, attachments, embedded files, JavaScript, hidden layers, and embedded-image metadata are outside this command.',
        'Page count is verified, but visible rendering is not compared pixel by pixel.',
      ],
    },
  };
}
