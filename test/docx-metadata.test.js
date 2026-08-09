import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import {
  removeDocxMetadata,
  viewDocxMetadata,
} from '../src/docx-metadata.js';

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
  <Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/>
</Types>`;

const rootRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>
</Relationships>`;

function docxFixture(extra = {}) {
  const entries = {
    '[Content_Types].xml': Buffer.from(contentTypes),
    '_rels/.rels': Buffer.from(rootRelationships),
    'docProps/core.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
        <dc:title>Private launch plan</dc:title><dc:creator>Alice Example</dc:creator>
        <cp:lastModifiedBy>Bob Reviewer</cp:lastModifiedBy><dcterms:created>2026-08-09T01:00:00Z</dcterms:created>
      </cp:coreProperties>`),
    'docProps/app.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
        <Application>Private Writer</Application><Company>Example Secret Labs</Company><Pages>1</Pages>
      </Properties>`),
    'docProps/custom.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
        <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ClientCode"><vt:lpwstr>CLIENT-2048</vt:lpwstr></property>
      </Properties>`),
    'docProps/thumbnail.jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    'word/document.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>
        <w:r><w:t>Visible original text.</w:t></w:r>
        <w:ins w:id="1" w:author="Carol Editor" w:date="2026-08-09T02:00:00Z"><w:r><w:t>Tracked visible text.</w:t></w:r></w:ins>
      </w:p></w:body></w:document>`),
    'word/comments.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:comment w:id="0" w:author="Dana Commenter" w:initials="DC" w:date="2026-08-09T03:00:00Z"><w:p><w:r><w:t>Keep this comment text.</w:t></w:r></w:p></w:comment>
      </w:comments>`),
    'word/people.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Dana Commenter"><w15:presenceInfo w15:userId="dana@example.com" w15:providerId="corp-id"/></w15:person></w15:people>`),
    'word/_rels/document.xml.rels': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/private" TargetMode="External"/></Relationships>`),
    'customXml/item1.xml': Buffer.from('<client><code>KEEP-CUSTOM-XML</code></client>'),
    ...extra,
  };
  return Buffer.from(zipSync(entries, { level: 6 }));
}

test('DOCX viewer reports properties, identities, and preserved-package boundaries', () => {
  const report = viewDocxMetadata(docxFixture());
  assert.equal(report.format, 'DOCX');
  assert.equal(report.rewriteAllowed, true);
  assert.equal(report.fields.find((field) => field.id === 'core:creator')?.value, 'Alice Example');
  assert.equal(report.fields.find((field) => field.id === 'custom:2')?.value, 'CLIENT-2048');
  assert.match(report.fields.find((field) => field.id === 'comments:authors')?.value ?? '', /Dana Commenter/);
  assert.match(report.fields.find((field) => field.id === 'revisions:authors')?.value ?? '', /Carol Editor/);
  assert.equal(report.signals.externalRelationshipCount, 1);
  assert.equal(report.signals.customXmlPartCount, 1);
  assert.match(report.warnings.join(' '), /Custom XML/);
});

test('DOCX remover strips supported metadata and preserves document/comment text', () => {
  const source = docxFixture();
  const cleaned = removeDocxMetadata(source);
  const after = viewDocxMetadata(cleaned.buffer);
  const entries = unzipSync(cleaned.buffer);
  const joined = Object.values(entries).map((value) => Buffer.from(value).toString('utf8')).join('\n');

  assert.equal(cleaned.report.verified, true);
  assert.equal(after.fields.length, 0);
  assert.doesNotMatch(joined, /Alice Example|Bob Reviewer|Carol Editor|Dana Commenter|dana@example\.com|CLIENT-2048|Private Writer|Example Secret Labs/);
  assert.match(joined, /Visible original text\./);
  assert.match(joined, /Tracked visible text\./);
  assert.match(joined, /Keep this comment text\./);
  assert.match(joined, /KEEP-CUSTOM-XML/);
  assert.equal('docProps/thumbnail.jpeg' in entries, false);
});

test('DOCX signatures block rewriting without blocking inspection', () => {
  const signed = docxFixture({ '_xmlsignatures/sig1.xml': Buffer.from('<Signature/>') });
  const report = viewDocxMetadata(signed);
  assert.equal(report.rewriteAllowed, false);
  assert.match(report.blockingReasons.join(' '), /signature/i);
  assert.throws(() => removeDocxMetadata(signed), /invalidate the signed package/i);
});

test('DOCX CLIs keep machine output promotional-link free and protect the original', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docx-metadata-'));
  const input = join(directory, 'private.docx');
  const output = join(directory, 'public.docx');
  await writeFile(input, docxFixture());

  const viewRun = spawnSync(process.execPath, ['./bin/docx-metadata-view.js', '--json', input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(viewRun.status, 0, viewRun.stderr);
  assert.doesNotMatch(viewRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(viewRun.stdout).results[0].format, 'DOCX');

  const removeRun = spawnSync(process.execPath, ['./bin/docx-metadata-remove.js', '--json', '--output', output, input], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(removeRun.status, 0, removeRun.stderr);
  assert.doesNotMatch(removeRun.stdout, /metadataremover\.ai/);
  assert.equal(JSON.parse(removeRun.stdout).result.verified, true);
  assert.equal(viewDocxMetadata(await readFile(output)).fields.length, 0);
});
