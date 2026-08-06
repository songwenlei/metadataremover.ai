# MetadataRemover.ai Toolkit

Local, privacy-first tools for inspecting, editing, and removing hidden image and PDF metadata. Every command works on your device, with no file uploads, telemetry, or account.

Prefer a browser? The online tools add visual review and more field-level choices while still processing locally:

- Images: [Metadata Viewer](https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer), [Metadata Editor](https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor), [AI Metadata Remover](https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover), [EXIF Remover](https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover), and the [full metadata cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker).
- PDFs: [PDF Metadata Viewer](https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer), [PDF Metadata Editor](https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor), and [PDF Metadata Remover](https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover).

## Included tools

| Command | Standalone use case | Changes files? |
| --- | --- | --- |
| `metadata-check` | Find privacy-sensitive metadata categories in build scripts and sharing checks | No |
| `metadata-view` | Review supported EXIF/GPS values, text metadata, containers, and provenance markers; export JSON or CSV | No |
| `ai-metadata-remove` | Remove recognized prompts, parameters, and workflow containers while keeping unrelated metadata | Writes a new copy |
| `exif-remove` | Remove complete EXIF containers from a verified JPEG, PNG, or WebP copy | Writes a new copy |
| `pdf-metadata-view` | Audit PDF Info, readable document XMP, and signature boundaries | No |
| `pdf-metadata-edit` | Set or clear selected PDF Info fields while preserving document XMP | Writes a new copy |
| `pdf-metadata-remove` | Remove the complete PDF Info dictionary and document-level XMP | Writes a new copy |

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/songwenlei/metadataremover.ai.git
cd metadataremover.ai
npm install
npm link

metadata-check photo.jpg
metadata-view photo.jpg
ai-metadata-remove generated.png
exif-remove photo.jpg
pdf-metadata-view report.pdf
pdf-metadata-edit --title "Public report" --clear author report.pdf
pdf-metadata-remove report.pdf
```

You can also run every command directly from the cloned repository:

```bash
node ./bin/metadata-check.js photo.jpg
node ./bin/metadata-view.js photo.jpg
node ./bin/ai-metadata-remove.js generated.png
node ./bin/exif-remove.js photo.jpg
node ./bin/pdf-metadata-view.js report.pdf
node ./bin/pdf-metadata-edit.js --title "Public report" report.pdf
node ./bin/pdf-metadata-remove.js report.pdf
```

## Image Metadata Privacy Checker

`metadata-check` reports privacy-relevant categories and tag names without printing the potentially sensitive values themselves.

```bash
metadata-check vacation.jpg
metadata-check --json image.png
metadata-check --fail-on-findings public/hero.webp
```

Example output:

```text
[HIGH] vacation.jpg
  Format: JPEG | Size: 2.4 MB
  - GPS location metadata (high) — JPEG GPS IFD
  - EXIF metadata (medium) — JPEG container
```

Supported checks:

| Format | Checks |
| --- | --- |
| JPEG | EXIF and GPS IFDs, XMP, IPTC/Photoshop APP13, comments, ICC presence, APP11/JUMBF |
| PNG | eXIf, tEXt, zTXt, iTXt, XMP, AI workflow signals, ICC presence, C2PA `caBX` |
| WebP | EXIF, XMP, AI workflow signals, ICC presence, C2PA chunks |

ICC color profiles are informational because they affect color rendering and are not treated as privacy risks.

Exit codes are `0` for a successful inspection, `1` when `--fail-on-findings` detects metadata, and `2` for invalid input or an unsupported file.

## Image Metadata Viewer

`metadata-view` is the read-only companion for cases where you need the supported values—not only a risk summary.

```bash
metadata-view photo.jpg
metadata-view --privacy-only photo.jpg
metadata-view --json generated.png
metadata-view --csv photos/*.webp > metadata.csv
```

It reports supported EXIF and GPS values, derived decimal coordinates, JPEG comments, PNG text and AI workflow fields, raw XMP packets, IPTC container presence, ICC profiles, and supported C2PA/JUMBF markers. JSON output uses a versioned schema; CSV cells that could be interpreted as spreadsheet formulas are neutralized.

For a visual, searchable report with local JSON and CSV export, open the [free browser-based Metadata Viewer](https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer).

See [Metadata Viewer technical limits](docs/metadata-view.md).

## AI Metadata Remover

`ai-metadata-remove` removes recognized AI-generation recipe containers from a verified copy while preserving unrelated metadata by default.

```bash
ai-metadata-remove generated.png
ai-metadata-remove --output share.webp generated.webp
ai-metadata-remove --json generated.jpg
```

The default output is `generated.no-ai-metadata.png`. Existing output files are protected unless `--force` is supplied, and the input path can never be used as the output path.

| Format | AI-only operation |
| --- | --- |
| JPEG | Removes XMP APP1 segments containing recognized prompts, seeds, samplers, workflows, generator names, or AI provenance source values |
| PNG | Removes recognized AI-marked `tEXt`, `zTXt`, and `iTXt` chunks, including common parameter, prompt, and workflow keys |
| WebP | Removes recognized AI-marked `XMP ` chunks and clears the VP8X XMP flag only when no other XMP chunk remains |

Separate EXIF, GPS, IPTC, generic text, JPEG comments, C2PA/JUMBF, and ICC profiles stay in the AI-only path. Because cleanup happens at the container level, unrelated values sharing a selected AI-marked text or XMP container leave with it. The output is scanned again before it is written.

For an interactive review and the option to choose a broader cleanup scope, use the [online AI Metadata Remover](https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover).

See [AI Metadata Remover technical limits](docs/ai-metadata-remove.md).

## EXIF Remover

`exif-remove` removes the complete supported EXIF container and verifies the new copy before writing it. The original path can never be used as the output path.

```bash
exif-remove photo.jpg
exif-remove --output clean.jpg photo.jpg
exif-remove --json generated.webp
```

The default output is `photo.no-exif.jpg`. Existing output files are protected unless `--force` is supplied.

| Format | Container-level operation |
| --- | --- |
| JPEG | Removes EXIF APP1 segments while preserving compressed scan data and separate XMP, IPTC, comments, and ICC segments |
| PNG | Removes `eXIf` chunks while preserving text, XMP-like, C2PA, and ICC chunks |
| WebP | Removes `EXIF` chunks, clears the VP8X EXIF feature flag, and preserves image, animation, XMP, and ICC chunks |

If EXIF Orientation is not `1`, the command refuses removal by default: dropping that instruction without decoding the pixels can make the image appear rotated or mirrored. `--allow-orientation-change` is an explicit escape hatch. For automatic pixel normalization, use the [online EXIF Remover](https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover), which processes the image locally in the browser and warns before re-encoding.

See [EXIF Remover technical limits](docs/exif-remove.md).

## PDF Metadata Viewer

`pdf-metadata-view` reads standard and custom PDF Info values, a bounded document-level XMP packet, SHA-256 fingerprints, page count, and structural signature markers. It does not modify the PDF.

```bash
pdf-metadata-view document.pdf
pdf-metadata-view --json document.pdf
```

Signature fields and `ByteRange` boundaries are detection-only evidence. The command does not validate signer identity, certificate trust, revocation, timestamps, or PAdES compliance. For a visual report and local JSON download, use the [online PDF Metadata Viewer](https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer).

## PDF Metadata Editor

`pdf-metadata-edit` sets or clears selected PDF Info fields in a separate file, reopens that copy, and verifies every requested value plus page count.

```bash
pdf-metadata-edit --title "Public report" --clear author document.pdf
pdf-metadata-edit --creation-date 2026-08-07T08:30:00Z document.pdf
```

This focused CLI edits `Title`, `Author`, `Subject`, `Keywords`, `Creator`, `Producer`, `CreationDate`, and `ModDate`. It preserves document XMP, so a separate XMP value can remain. The [online PDF Metadata Editor](https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor) adds readable XMP editing and a visual before/after diff.

## PDF Metadata Remover

`pdf-metadata-remove` deletes the complete PDF Info dictionary and document-level XMP, performs a full local rewrite, reopens the output, and verifies metadata absence and page count.

```bash
pdf-metadata-remove document.pdf
pdf-metadata-remove --output share.pdf document.pdf
```

The command refuses signed or encrypted PDFs. It does not sanitize visible text, annotations, attachments, embedded files, JavaScript, hidden layers, or metadata inside embedded images. Use the [online PDF Metadata Remover](https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover) for field-level selection and explicit signed-copy guidance.

See [PDF metadata tools technical limits](docs/pdf-metadata-tools.md).

## Privacy and shared limits

- All inspection and cleanup happens on your device.
- Files are never uploaded or used for telemetry.
- Detection is conservative and cannot prove that an image contains no hidden data.
- C2PA/JUMBF detection does not validate cryptographic signatures, trust chains, or claims.
- These tools do not detect or remove pixel-level watermarks such as Google SynthID.
- Image commands do not support HEIC, HEIF, AVIF, video, PDF, or Office documents. PDF commands accept PDF only.
- PDF write commands refuse signed and encrypted files; signature detection is not cryptographic validation.
- PDF page content, annotations, attachments, embedded files, JavaScript, hidden layers, and embedded-image metadata are outside the focused PDF commands.
- `ai-metadata-remove` targets recognized PNG text and XMP containers only; it does not remove separate EXIF, C2PA, ICC, comments, or platform-side AI labels.
- `exif-remove` removes EXIF only; use the [full browser cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker) when you also need to remove supported XMP, IPTC, AI text, comments, or provenance containers.
- Machine-readable JSON and CSV output never contains promotional links.

## Project direction

This repository is the open-source companion to [MetadataRemover.ai](https://metadataremover.ai/). Useful website capabilities receive matching local tools when practical, with tests, documented limits, and a direct link to the corresponding online experience.

See the [project plan](docs/PROJECT-PLAN.zh-CN.md) for the synchronization rules and roadmap.

## Development

```bash
npm test
npm run check
```

Contributions and privacy-focused test cases are welcome. Do not submit personal photos or fixtures containing real private information.

## License

[MIT](LICENSE)
