# PDF metadata tools: behavior and technical limits

The three PDF commands are deliberately smaller automation companions to the browser tools. They process local bytes, never overwrite the source, reopen every written copy, and keep machine-readable output free of promotional text.

| Command | Focused local operation | Online experience |
| --- | --- | --- |
| `pdf-metadata-view` | Read PDF Info, bounded document XMP, fingerprints, page count, and signature boundaries | [PDF Metadata Viewer](https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer) |
| `pdf-metadata-edit` | Set or clear supported PDF Info fields; preserve document XMP | [PDF Metadata Editor](https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor) |
| `pdf-metadata-remove` | Remove the complete Info dictionary and document-level XMP | [PDF Metadata Remover](https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover) |

## Viewer

```bash
pdf-metadata-view document.pdf
pdf-metadata-view --json document.pdf
```

The viewer reports standard and custom entries in the trailer's PDF Info dictionary. Text values are capped at 64 KiB and output is capped at 256 Info fields. A document-level `Catalog.Metadata` XMP stream is decoded only when it is unfiltered or uses a simple `FlateDecode` stream without predictor parameters, with a 1 MiB output limit. Other filters remain visible as an undecoded container with a warning.

The report includes SHA-256, file size, page count, parsed signature dictionaries, and four-number `ByteRange` boundaries. These are structural observations only. Signer identity, certificate chains, revocation, timestamps, signed-attribute integrity, and complete PAdES validation are not implemented.

## Info-field editor

```bash
pdf-metadata-edit --title "Public report" --clear author document.pdf
pdf-metadata-edit --keywords "public release" --output edited.pdf document.pdf
```

Supported fields are `title`, `author`, `subject`, `keywords`, `creator`, `producer`, `creationDate`, and `modificationDate`. Each write creates a separate PDF, reads every requested field back, and checks that page count is unchanged.

This command intentionally does not edit XMP. Existing document XMP is retained, so an XMP title or author can disagree with the edited Info value. Use the online editor when both representations need a reviewed update. Custom Info keys are preserved but cannot be set through this focused CLI.

## Remover

```bash
pdf-metadata-remove document.pdf
pdf-metadata-remove --output share.pdf document.pdf
```

The remover deletes the complete Info dictionary—including custom keys—and the document-level XMP stream, prunes objects no longer reachable from the PDF trailer, saves a full rewritten copy, then confirms that both metadata sources are absent and page count is unchanged. It does not append an incremental update.

## Shared safety boundaries

- Encrypted and password-protected PDFs are rejected. The command does not bypass access controls.
- Any detected signature dictionary or `ByteRange` makes editing and removal read-only. Rewriting signed bytes can invalidate the signature, so the CLI does not offer a silent override.
- Signature detection is conservative and not a cryptographic validation result.
- The input file signature must identify a PDF and files are capped at 100 MiB to bound local memory use.
- Visible page text, annotations, comments, form values, attachments, embedded files, JavaScript, hidden or optional-content layers, and metadata inside embedded images are not inspected, edited, or removed.
- Page count is verified after writing. Visible rendering, fonts, interactive behavior, accessibility, and pixel-level output are not compared.
- A missing readable field is not proof that a document contains no personal, confidential, or hidden information.
- Source files, extracted values, reports, and generated copies are never uploaded or used for telemetry.

The online PDF tools provide field-level review, a visual before/after workflow, readable XMP choices, and more explicit signed-copy guidance while keeping file processing in the browser.
