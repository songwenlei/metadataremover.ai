import { createHash } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, zipSync } from 'fflate';

export const ONLINE_DOCX_METADATA_VIEWER_URL = 'https://metadataremover.ai/docx-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_viewer';
export const ONLINE_DOCX_METADATA_REMOVER_URL = 'https://metadataremover.ai/docx-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_remover';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_COUNT = 4096;
const MAX_VALUE_LENGTH = 64 * 1024;
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PACKAGE_REL_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCX_MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;

const CORE_FIELDS = new Map([
  ['title', ['Title', 'medium']],
  ['subject', ['Subject', 'medium']],
  ['creator', ['Author', 'high']],
  ['keywords', ['Keywords', 'medium']],
  ['description', ['Description', 'medium']],
  ['lastModifiedBy', ['Last modified by', 'high']],
  ['revision', ['Revision number', 'medium']],
  ['created', ['Created date', 'medium']],
  ['modified', ['Modified date', 'medium']],
  ['lastPrinted', ['Last printed date', 'medium']],
  ['category', ['Category', 'medium']],
  ['contentStatus', ['Content status', 'medium']],
  ['identifier', ['Identifier', 'high']],
  ['language', ['Language', 'low']],
  ['version', ['Version', 'medium']],
]);

const REVISION_ELEMENTS = new Set([
  'cellDel', 'cellIns', 'cellMerge', 'del', 'ins', 'moveFrom', 'moveFromRangeEnd',
  'moveFromRangeStart', 'moveTo', 'moveToRangeEnd', 'moveToRangeStart',
  'numberingChange', 'pPrChange', 'rPrChange', 'sectPrChange', 'tblGridChange',
  'tblPrChange', 'tblPrExChange', 'tcPrChange', 'trPrChange',
]);

export class DocxMetadataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocxMetadataError';
    this.code = code;
  }
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new TypeError('DOCX input must be a Buffer, Uint8Array, or ArrayBuffer.');
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function safeEntryName(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) return false;
  if (/^[a-z]:/i.test(name)) return false;
  return !name.split('/').some((part) => part === '.' || part === '..');
}

function zipManifest(bytes) {
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new DocxMetadataError('file_too_large', 'DOCX files larger than 25 MiB are outside this focused CLI safety limit.');
  }
  if (bytes.length < 22) throw new DocxMetadataError('invalid_zip', 'The file is not a complete OOXML ZIP package.');
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new DocxMetadataError('invalid_zip', 'The ZIP central directory is missing or truncated.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  if (
    u16(view, eocd + 4) !== 0
    || u16(view, eocd + 6) !== 0
    || u16(view, eocd + 8) !== entryCount
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    throw new DocxMetadataError('unsupported_zip', 'Multi-disk and ZIP64 DOCX packages are not supported.');
  }
  if (!entryCount || entryCount > MAX_ENTRY_COUNT) {
    throw new DocxMetadataError('unsafe_package', `The package contains an unsafe number of entries (${entryCount}).`);
  }
  if (centralOffset + centralSize > eocd) {
    throw new DocxMetadataError('invalid_zip', 'The ZIP central directory points outside the file.');
  }

  const entries = [];
  const names = new Set();
  let expandedSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || u32(view, offset) !== CENTRAL_ENTRY_SIGNATURE) {
      throw new DocxMetadataError('invalid_zip', 'The ZIP central directory contains a broken entry.');
    }
    const flags = u16(view, offset + 8);
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw new DocxMetadataError('invalid_zip', 'A ZIP entry name extends beyond the package.');
    if (flags & 1) throw new DocxMetadataError('encrypted_package', 'Encrypted DOCX entries cannot be inspected.');
    if (method !== 0 && method !== 8) {
      throw new DocxMetadataError('unsupported_zip', `ZIP compression method ${method} is not supported.`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new DocxMetadataError('unsupported_zip', 'ZIP64 entry sizes are not supported.');
    }
    const encodedName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try {
      name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252', { fatal: Boolean(flags & 0x800) }).decode(encodedName);
    } catch {
      throw new DocxMetadataError('unsafe_package', 'A package entry name could not be decoded safely.');
    }
    if (!safeEntryName(name) || names.has(name)) {
      throw new DocxMetadataError('unsafe_package', `Unsafe or duplicate package entry: ${name || '(empty)'}.`);
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new DocxMetadataError('unsafe_package', `The expanded entry ${name} exceeds 32 MiB.`);
    }
    if (compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > 500) {
      throw new DocxMetadataError('unsafe_package', `The entry ${name} has an unsafe expansion ratio.`);
    }
    expandedSize += uncompressedSize;
    if (expandedSize > MAX_EXPANDED_BYTES) {
      throw new DocxMetadataError('unsafe_package', 'The expanded DOCX package exceeds 100 MiB.');
    }
    names.add(name);
    entries.push({ name, compressedSize, uncompressedSize });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) {
    throw new DocxMetadataError('invalid_zip', 'The ZIP central-directory size does not match its entries.');
  }
  return { sourceSize: bytes.length, expandedSize, entries };
}

function openPackage(input) {
  const bytes = asBuffer(input);
  const manifest = zipManifest(bytes);
  let inflated;
  try {
    inflated = unzipSync(bytes);
  } catch {
    throw new DocxMetadataError('invalid_zip', 'The OOXML package could not be decompressed completely.');
  }
  const entries = new Map();
  for (const summary of manifest.entries) {
    if (summary.name.endsWith('/')) continue;
    const value = inflated[summary.name];
    if (!value || value.byteLength !== summary.uncompressedSize) {
      throw new DocxMetadataError('invalid_zip', `The decompressed size of ${summary.name} does not match the package manifest.`);
    }
    entries.set(summary.name, Buffer.from(value));
  }
  return { bytes, manifest, entries };
}

function xmlText(entries, name) {
  const bytes = entries.get(name);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocxMetadataError('invalid_docx', `The XML part ${name} is not valid UTF-8.`);
  }
}

function parseXml(entries, name) {
  const text = xmlText(entries, name);
  if (text === null) return null;
  const errors = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(String(message));
    },
  }).parseFromString(text, 'application/xml');
  if (!document.documentElement || errors.length || document.documentElement.nodeName === 'parsererror') {
    throw new DocxMetadataError('invalid_docx', `The OOXML part ${name} contains malformed XML.`);
  }
  return document;
}

function elements(document, localName) {
  return Array.from(document.getElementsByTagName('*')).filter((element) => {
    const name = element.localName ?? element.nodeName.split(':').at(-1);
    return !localName || name === localName;
  });
}

function localName(element) {
  return element.localName ?? element.nodeName.split(':').at(-1) ?? element.nodeName;
}

function attribute(element, name) {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const candidate = element.attributes.item(index);
    if ((candidate?.localName ?? candidate?.name.split(':').at(-1)) === name) return candidate;
  }
  return null;
}

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function bounded(value) {
  const text = compact(value);
  return { value: text.slice(0, MAX_VALUE_LENGTH), truncated: text.length > MAX_VALUE_LENGTH };
}

function validateDocx(entries) {
  const types = xmlText(entries, '[Content_Types].xml');
  if (!types || !entries.has('word/document.xml')) {
    throw new DocxMetadataError('invalid_docx', 'The package is missing standard DOCX content parts.');
  }
  if (!types.includes(DOCX_MAIN_CONTENT_TYPE) || /macroEnabled/i.test(types)) {
    throw new DocxMetadataError('unsupported_docx', 'Only standard non-macro .docx documents are supported.');
  }
}

function addField(fields, field) {
  const value = bounded(field.value);
  if (!value.value) return;
  fields.push({ ...field, ...value });
}

function propertyFields(entries, fields) {
  const core = parseXml(entries, 'docProps/core.xml');
  if (core) {
    for (const [name, [label, privacy]] of CORE_FIELDS) {
      for (const element of elements(core, name)) {
        addField(fields, {
          id: `core:${name}`,
          path: `docProps/core.xml#${name}`,
          name: label,
          value: element.textContent,
          source: 'core',
          privacy,
          action: 'remove',
        });
      }
    }
  }

  const app = parseXml(entries, 'docProps/app.xml');
  if (app?.documentElement) {
    for (const node of Array.from(app.documentElement.childNodes)) {
      if (node.nodeType !== 1) continue;
      const name = localName(node);
      const privacy = ['Company', 'Manager'].includes(name)
        ? 'high'
        : ['Pages', 'Words', 'Characters', 'CharactersWithSpaces', 'Lines', 'Paragraphs'].includes(name)
          ? 'info'
          : 'medium';
      addField(fields, {
        id: `extended:${name}`,
        path: `docProps/app.xml#${name}`,
        name: name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
        value: node.textContent,
        source: 'extended',
        privacy,
        action: 'remove',
      });
    }
  }

  const custom = parseXml(entries, 'docProps/custom.xml');
  if (custom) {
    for (const [index, property] of elements(custom, 'property').entries()) {
      addField(fields, {
        id: `custom:${property.getAttribute('pid') || index + 2}`,
        path: `docProps/custom.xml#${property.getAttribute('name') || index + 1}`,
        name: property.getAttribute('name') || `Custom property ${index + 1}`,
        value: property.textContent || '(empty)',
        source: 'custom',
        privacy: 'high',
        action: 'remove',
      });
    }
  }
}

function countExternalRelationships(entries) {
  let count = 0;
  for (const [name] of entries) {
    if (!name.endsWith('.rels')) continue;
    const document = parseXml(entries, name);
    for (const relationship of elements(document, 'Relationship')) {
      if (
        (!relationship.namespaceURI || relationship.namespaceURI === PACKAGE_REL_NAMESPACE)
        && relationship.getAttribute('TargetMode') === 'External'
      ) count += 1;
    }
  }
  return count;
}

function wordFields(entries, fields, signals) {
  const commentAuthors = new Set();
  const revisionAuthors = new Set();
  const people = new Set();
  for (const [name] of entries) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const document = parseXml(entries, name);
    for (const element of elements(document)) {
      const elementName = localName(element);
      if (element.namespaceURI && element.namespaceURI !== WORD_NAMESPACE && !name.includes('people.xml')) continue;
      if (elementName === 'comment' && name.includes('comments')) {
        signals.commentCount += 1;
        const author = compact(attribute(element, 'author')?.value);
        if (author && !/^Removed(?: \d+)?$/.test(author)) commentAuthors.add(author);
        if (attribute(element, 'date')) signals.commentDateCount += 1;
      }
      if (REVISION_ELEMENTS.has(elementName)) {
        signals.revisionCount += 1;
        const author = compact(attribute(element, 'author')?.value);
        if (author && !/^Removed(?: \d+)?$/.test(author)) revisionAuthors.add(author);
        if (attribute(element, 'date')) signals.revisionDateCount += 1;
      }
      if (elementName === 'person') {
        const author = compact(attribute(element, 'author')?.value);
        if (author && !/^Removed(?: \d+)?$/.test(author)) people.add(author);
      }
      if (elementName === 'presenceInfo') {
        for (const key of ['userId', 'providerId']) {
          const value = compact(attribute(element, key)?.value);
          if (value) people.add(value);
        }
      }
      if (elementName === 'vanish' || elementName === 'webHidden') signals.hiddenTextCount += 1;
      if (elementName === 'docVar') signals.documentVariableCount += 1;
      if (elementName === 'instrText' && /\bDOCPROPERTY\b/i.test(element.textContent ?? '')) {
        signals.documentPropertyFieldCount += 1;
      }
      if (
        elementName === 'documentProtection'
        && attribute(element, 'enforcement')?.value !== '0'
      ) signals.protectedDocument = true;
      if (elementName === 'trackRevisions') signals.trackChangesEnabled = true;
    }
  }
  addField(fields, { id: 'comments:authors', path: 'word/comments*.xml@author', name: 'Comment authors', value: [...commentAuthors].join(', '), source: 'comments', privacy: 'high', action: 'anonymize' });
  addField(fields, { id: 'comments:dates', path: 'word/comments*.xml@date', name: 'Comment timestamps', value: signals.commentDateCount ? `${signals.commentDateCount} timestamp(s)` : '', source: 'comments', privacy: 'medium', action: 'remove' });
  addField(fields, { id: 'revisions:authors', path: 'word/*.xml@author', name: 'Tracked-change authors', value: [...revisionAuthors].join(', '), source: 'revisions', privacy: 'high', action: 'anonymize' });
  addField(fields, { id: 'revisions:dates', path: 'word/*.xml@date', name: 'Tracked-change timestamps', value: signals.revisionDateCount ? `${signals.revisionDateCount} timestamp(s)` : '', source: 'revisions', privacy: 'medium', action: 'remove' });
  addField(fields, { id: 'people:identities', path: 'word/people.xml', name: 'Modern comment identities', value: [...people].join(', '), source: 'people', privacy: 'high', action: 'anonymize' });
}

function inspectOpened(opened) {
  validateDocx(opened.entries);
  const fields = [];
  const signals = {
    commentCount: 0,
    commentDateCount: 0,
    revisionCount: 0,
    revisionDateCount: 0,
    hiddenTextCount: 0,
    documentVariableCount: 0,
    documentPropertyFieldCount: 0,
    protectedDocument: false,
    trackChangesEnabled: false,
  };
  propertyFields(opened.entries, fields);
  wordFields(opened.entries, fields, signals);
  signals.externalRelationshipCount = countExternalRelationships(opened.entries);
  signals.embeddedObjectCount = [...opened.entries.keys()].filter((name) => name.startsWith('word/embeddings/')).length;
  signals.customXmlPartCount = [...opened.entries.keys()].filter((name) => name.startsWith('customXml/') && name.endsWith('.xml') && !name.includes('itemProps')).length;
  signals.printerSettingsCount = [...opened.entries.keys()].filter((name) => name.startsWith('word/printerSettings/')).length;
  signals.signaturePartCount = [...opened.entries.keys()].filter((name) => name.toLowerCase().startsWith('_xmlsignatures/')).length;
  signals.macroPartCount = [...opened.entries.keys()].filter((name) => /(^|\/)vbaProject\.bin$|activeX/i.test(name)).length;
  signals.thumbnailCount = [...opened.entries.keys()].filter((name) => /^docProps\/thumbnail\./i.test(name)).length;
  if (signals.thumbnailCount) {
    addField(fields, { id: 'package:thumbnail', path: 'docProps/thumbnail.*', name: 'Document thumbnail', value: `${signals.thumbnailCount} preview image(s)`, source: 'package', privacy: 'medium', action: 'remove' });
  }

  const blockingReasons = [];
  if (signals.signaturePartCount) blockingReasons.push('OOXML digital signatures were detected; rewriting would invalidate the signed package.');
  if (signals.macroPartCount) blockingReasons.push('Macro or ActiveX parts were detected; this focused DOCX command remains read-only.');
  const warnings = [];
  if (signals.hiddenTextCount) warnings.push('Hidden text was detected but is not deleted by metadata cleanup.');
  if (signals.externalRelationshipCount) warnings.push('External relationships were detected and are preserved.');
  if (signals.embeddedObjectCount || signals.customXmlPartCount) warnings.push('Embedded objects and Custom XML can contain additional data and are preserved.');
  if (signals.protectedDocument) warnings.push('Word editing protection is enabled; review any cleaned copy in Word.');

  return {
    schemaVersion: 1,
    format: 'DOCX',
    size: opened.bytes.length,
    sha256: sha256(opened.bytes),
    package: {
      entryCount: opened.entries.size,
      expandedSize: opened.manifest.expandedSize,
      documentXmlBytes: opened.entries.get('word/document.xml')?.length ?? 0,
    },
    fields,
    signals,
    rewriteAllowed: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    limitations: [
      'Hidden or visible document text, links, embedded objects, Custom XML, printer settings, and external relationships are not removed.',
      'Comment and tracked-change text is preserved; supported author identities are pseudonymized and timestamps are removed.',
      'Password-protected, macro-enabled, signed, ZIP64, and non-DOCX Office packages are not rewritten.',
      'A clean supported-field report is not proof that a document contains no confidential information.',
    ],
  };
}

export function viewDocxMetadata(input) {
  return inspectOpened(openPackage(input));
}

function serialize(entries, name, document, touched) {
  entries.set(name, Buffer.from(new XMLSerializer().serializeToString(document)));
  touched.add(name);
}

function clearPropertyParts(entries, touched) {
  for (const name of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) {
    const document = parseXml(entries, name);
    if (!document?.documentElement) continue;
    for (const child of Array.from(document.documentElement.childNodes)) {
      if (child.nodeType === 1) document.documentElement.removeChild(child);
    }
    serialize(entries, name, document, touched);
  }
}

function scrubWordIdentities(entries, touched) {
  const pseudonyms = new Map();
  const pseudonym = (value) => {
    const key = compact(value);
    if (!pseudonyms.has(key)) pseudonyms.set(key, `Removed ${pseudonyms.size + 1}`);
    return pseudonyms.get(key);
  };
  for (const [name] of entries) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const document = parseXml(entries, name);
    let changed = false;
    for (const element of elements(document)) {
      const elementName = localName(element);
      const isComment = elementName === 'comment' && name.includes('comments');
      const isRevision = REVISION_ELEMENTS.has(elementName);
      const isPerson = elementName === 'person' || elementName === 'presenceInfo';
      if (isComment || isRevision || isPerson) {
        const author = attribute(element, 'author');
        if (author?.value) {
          author.value = pseudonym(author.value);
          changed = true;
        }
      }
      if (isComment) {
        const initials = attribute(element, 'initials');
        if (initials) {
          element.removeAttributeNode(initials);
          changed = true;
        }
      }
      if (isComment || isRevision) {
        const date = attribute(element, 'date');
        if (date) {
          element.removeAttributeNode(date);
          changed = true;
        }
      }
      if (isPerson) {
        for (const nameToRemove of ['userId', 'providerId']) {
          const value = attribute(element, nameToRemove);
          if (value) {
            element.removeAttributeNode(value);
            changed = true;
          }
        }
      }
    }
    if (changed) serialize(entries, name, document, touched);
  }
}

function removeThumbnails(entries, touched) {
  const deleted = [...entries.keys()].filter((name) => /^docProps\/thumbnail\./i.test(name));
  for (const name of deleted) {
    entries.delete(name);
    touched.add(name);
  }
  if (!deleted.length) return;
  const relationships = parseXml(entries, '_rels/.rels');
  if (relationships) {
    for (const relationship of elements(relationships, 'Relationship')) {
      const type = relationship.getAttribute('Type') ?? '';
      const target = relationship.getAttribute('Target') ?? '';
      if (type.endsWith('/metadata/thumbnail') || /docProps\/thumbnail\./i.test(target)) {
        relationship.parentNode?.removeChild(relationship);
      }
    }
    serialize(entries, '_rels/.rels', relationships, touched);
  }
  const types = parseXml(entries, '[Content_Types].xml');
  for (const override of elements(types, 'Override')) {
    const part = (override.getAttribute('PartName') ?? '').replace(/^\//, '');
    if (deleted.includes(part)) override.parentNode?.removeChild(override);
  }
  serialize(entries, '[Content_Types].xml', types, touched);
}

function visibleWordText(entries) {
  const output = [];
  for (const [name] of entries) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const document = parseXml(entries, name);
    const values = elements(document)
      .filter((element) => ['t', 'delText', 'instrText'].includes(localName(element)))
      .map((element) => element.textContent ?? '');
    if (values.length) output.push(`${name}\0${values.join('\0')}`);
  }
  return output.join('\n');
}

function byteEqual(left, right) {
  return Boolean(left && right && left.length === right.length && Buffer.compare(left, right) === 0);
}

function writePackage(entries) {
  const data = Object.create(null);
  for (const [name, value] of entries) {
    if (!safeEntryName(name)) throw new DocxMetadataError('unsafe_package', `Refusing to write unsafe entry path: ${name}.`);
    data[name] = value;
  }
  return Buffer.from(zipSync(data, { level: 6 }));
}

export function removeDocxMetadata(input) {
  const opened = openPackage(input);
  const before = inspectOpened(opened);
  if (!before.rewriteAllowed) throw new DocxMetadataError('rewrite_blocked', before.blockingReasons.join(' '));
  const entries = new Map([...opened.entries].map(([name, value]) => [name, Buffer.from(value)]));
  const touched = new Set();
  clearPropertyParts(entries, touched);
  scrubWordIdentities(entries, touched);
  removeThumbnails(entries, touched);
  const buffer = writePackage(entries);
  const reopened = openPackage(buffer);
  const after = inspectOpened(reopened);

  const supportedFieldsRemoved = before.fields.every((field) => !after.fields.some((candidate) => candidate.id === field.id));
  const visibleTextPreserved = visibleWordText(opened.entries) === visibleWordText(reopened.entries);
  let untouchedPartsPreserved = true;
  let preservedEntryCount = 0;
  for (const [name, value] of opened.entries) {
    if (touched.has(name)) continue;
    if (!byteEqual(value, reopened.entries.get(name))) {
      untouchedPartsPreserved = false;
      break;
    }
    preservedEntryCount += 1;
  }
  const checks = [
    { id: 'reopened', passed: after.format === 'DOCX', detail: 'The output reopened as a standard DOCX package.' },
    { id: 'supported-fields', passed: supportedFieldsRemoved, detail: `${before.fields.length - after.fields.length} supported metadata record(s) no longer appear.` },
    { id: 'visible-text', passed: visibleTextPreserved, detail: 'Visible, deleted, field-code, and comment text stayed unchanged.' },
    { id: 'untouched-parts', passed: untouchedPartsPreserved, detail: `${preservedEntryCount} untouched package part(s) stayed byte-for-byte identical after decompression.` },
  ];
  if (!checks.every((check) => check.passed)) {
    throw new DocxMetadataError('verification_failed', 'The cleaned DOCX did not pass independent readback verification.');
  }
  return {
    buffer,
    report: {
      format: 'DOCX',
      sourceSize: opened.bytes.length,
      outputSize: buffer.length,
      fieldsRemoved: before.fields.length - after.fields.length,
      touchedEntries: [...touched].sort(),
      preservedEntryCount,
      verified: true,
      checks,
      warnings: before.warnings,
      limitations: after.limitations,
    },
  };
}
