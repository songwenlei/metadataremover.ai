import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import {
  SignedPdfError,
  editPdfMetadata,
  removePdfMetadata,
  viewPdfMetadata,
} from '../src/pdf-metadata.js';

async function samplePdf({ signed = false } = {}) {
  const pdfDoc = await PDFDocument.create({ updateMetadata: false });
  pdfDoc.addPage([300, 200]);
  const info = pdfDoc.context.obj({});
  info.set(PDFName.Title, PDFHexString.fromText('Internal roadmap'));
  info.set(PDFName.Author, PDFHexString.fromText('Private Author'));
  info.set(PDFName.Subject, PDFHexString.fromText('Confidential subject'));
  info.set(PDFName.CreationDate, PDFString.fromDate(new Date('2026-08-01T12:00:00.000Z')));
  info.set(
    PDFName.of('Department'),
    pdfDoc.context.register(PDFHexString.fromText('Private Lab')),
  );
  pdfDoc.context.trailerInfo.Info = pdfDoc.context.register(info);

  const xmpText = '<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Private Author" /></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const xmp = pdfDoc.context.stream(new TextEncoder().encode(xmpText), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(xmp));

  if (signed) {
    const signature = pdfDoc.context.obj({
      Type: 'Sig',
      ByteRange: [0, 10, 20, 5],
    });
    const signatureRef = pdfDoc.context.register(signature);
    pdfDoc.catalog.set(PDFName.of('Perms'), pdfDoc.context.obj({ DocMDP: signatureRef }));
  }

  return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
}

test('PDF viewer reports Info, XMP, fingerprints, and explicit signature limits', async () => {
  const report = await viewPdfMetadata(await samplePdf());
  assert.equal(report.format, 'PDF');
  assert.equal(report.pageCount, 1);
  assert.equal(report.fields.find((field) => field.path === 'Info.Author').value, 'Private Author');
  assert.equal(report.fields.find((field) => field.path === 'Info.CreationDate').value, '2026-08-01T12:00:00.000Z');
  assert.equal(report.fields.find((field) => field.path === 'Info.Department').field, null);
  assert.equal(report.xmp.readable, true);
  assert.match(report.xmp.value, /Private Author/);
  assert.equal(report.signatures.detected, false);
  assert.match(report.signatures.limitation, /not verified/);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
});

test('PDF editor changes only requested Info fields and verifies the output', async () => {
  const input = await samplePdf();
  const edited = await editPdfMetadata(input, {
    title: 'Public roadmap',
    author: null,
    modificationDate: '2026-08-07T08:30:00.000Z',
  });
  const after = await viewPdfMetadata(edited.buffer);
  assert.equal(after.fields.find((field) => field.field === 'title').value, 'Public roadmap');
  assert.equal(after.fields.some((field) => field.field === 'author'), false);
  assert.equal(after.fields.find((field) => field.field === 'modificationDate').value, '2026-08-07T08:30:00.000Z');
  assert.equal(after.fields.find((field) => field.name === 'Department').value, 'Private Lab');
  assert.match(after.xmp.value, /Private Author/);
  assert.equal(edited.report.xmpPreserved, true);
  assert.equal(edited.report.verified, true);
});

test('PDF remover deletes the complete Info dictionary and document XMP', async () => {
  const cleaned = await removePdfMetadata(await samplePdf());
  const after = await viewPdfMetadata(cleaned.buffer);
  assert.equal(cleaned.report.infoFieldsRemoved, 5);
  assert.equal(cleaned.report.xmpPacketsRemoved, 1);
  assert.ok(cleaned.report.unreachableObjectsRemoved >= 1);
  assert.equal(cleaned.report.verified, true);
  assert.deepEqual(after.fields, []);
  assert.equal(after.xmp, null);
  assert.equal(after.pageCount, 1);
  assert.doesNotMatch(cleaned.buffer.toString('latin1'), /00500072006900760061007400650020004C00610062/i);
});

test('PDF writers refuse signature markers rather than claiming signature safety', async () => {
  const input = await samplePdf({ signed: true });
  const report = await viewPdfMetadata(input);
  assert.equal(report.signatures.detected, true);
  assert.match(report.signatures.limitation, /not verified/);
  await assert.rejects(() => editPdfMetadata(input, { title: 'Changed' }), SignedPdfError);
  await assert.rejects(() => removePdfMetadata(input), SignedPdfError);
});

test('PDF CLIs keep promotional links out of JSON and protect the original path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-metadata-tools-'));
  const input = join(directory, 'input.pdf');
  const output = join(directory, 'clean.pdf');
  await writeFile(input, await samplePdf());

  const viewRun = spawnSync(process.execPath, ['./bin/pdf-metadata-view.js', '--json', input], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(viewRun.status, 0, viewRun.stderr);
  assert.doesNotMatch(viewRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(viewRun.stdout).schemaVersion, 1);

  const removeRun = spawnSync(process.execPath, ['./bin/pdf-metadata-remove.js', '--json', '--output', output, input], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal((await viewPdfMetadata(await readFile(output))).fields.length, 0);

  const overwriteRun = spawnSync(process.execPath, ['./bin/pdf-metadata-edit.js', '--title', 'Changed', '--output', input, input], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(overwriteRun.status, 2);
  assert.match(overwriteRun.stderr, /never overwritten/);
});
