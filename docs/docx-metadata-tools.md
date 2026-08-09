# DOCX metadata tools: behavior and technical limits

The DOCX commands are focused automation companions to the browser tools. They open local OOXML packages with explicit ZIP safety limits, never overwrite the source, and keep machine-readable output free of promotional text.

| Command | Focused local operation | Online experience |
| --- | --- | --- |
| `docx-metadata-view` | Read supported Word properties, identity attributes, and package boundaries | [DOCX Metadata Viewer](https://metadataremover.ai/docx-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_viewer) |
| `docx-metadata-remove` | Clear supported properties and thumbnails; anonymize supported identities | [DOCX Metadata Remover](https://metadataremover.ai/docx-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_remover) |

## Viewer

```bash
docx-metadata-view document.docx
docx-metadata-view --json document.docx
```

The viewer reports supported Core, Extended, and Custom Properties; comment and tracked-change authors and dates; modern comment identities; and document-thumbnail presence. It also reports counts or warnings for hidden-text markers, document variables, `DOCPROPERTY` fields, external relationships, embedded objects, Custom XML, printer settings, protection, tracked changes, signatures, macros, and ActiveX parts.

Property values are capped at 64 KiB. Human output shortens long values; JSON retains the bounded value and a `truncated` flag.

## Remover

```bash
docx-metadata-remove document.docx
docx-metadata-remove --output public.docx document.docx
```

The remover creates a separate package and:

- removes the supported children of `docProps/core.xml`, `docProps/app.xml`, and `docProps/custom.xml`;
- removes a package thumbnail plus its root relationship and content-type override;
- replaces supported comment, revision, and people author identities with stable `Removed N` pseudonyms;
- removes supported initials, user/provider identifiers, and comment/revision timestamps;
- reopens the output and confirms that supported records are gone;
- confirms that visible text, deleted text, field-code text, and comment text stayed unchanged;
- compares every untouched expanded package part byte for byte.

The ZIP container is recompressed, so the DOCX file hash and compressed byte layout normally change even when most expanded parts remain identical.

## Safety boundaries

- Source packages are capped at 25 MiB, expanded data at 100 MiB, each entry at 32 MiB, and entry count at 4,096.
- Unsafe paths, duplicate entries, encrypted entries, unsupported compression, unsafe expansion ratios, multi-disk ZIP, and ZIP64 are rejected.
- Only standard `.docx` main-document content types are accepted. Templates and macro-enabled formats are not treated as DOCX.
- Detected OOXML signatures, VBA, and ActiveX block rewriting. Signature presence is structural detection, not cryptographic validation.
- Comment and tracked-change text is preserved. The command does not accept or reject revisions.
- Hidden and visible text, headers, footers, links, attached templates, external relationships, embedded objects, Custom XML contents, document variables, printer settings, and protection settings are not deleted.
- A missing supported field is not proof that a Word document contains no confidential, personal, hidden, or embedded information.

No selected file, extracted value, generated copy, or report is uploaded or used for telemetry.
