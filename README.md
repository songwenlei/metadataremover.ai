# MetadataRemover.ai Toolkit

Local, privacy-first tools for inspecting, editing, and removing hidden image, PDF, DOCX, video, and MP3 metadata. Every command works on your device, with no file uploads, telemetry, or account.

Prefer a browser? The online tools add visual review and more field-level choices while still processing locally:

- Images: [Metadata Viewer](https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer), [Metadata Editor](https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor), [AI Metadata Remover](https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover), [EXIF Remover](https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover), and the [full metadata cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker).
- PDFs: [PDF Metadata Viewer](https://metadataremover.ai/pdf-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_viewer), [PDF Metadata Editor](https://metadataremover.ai/pdf-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_editor), and [PDF Metadata Remover](https://metadataremover.ai/pdf-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=pdf_metadata_remover).
- Word documents: [DOCX Metadata Viewer](https://metadataremover.ai/docx-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_viewer), [DOCX Metadata Editor](https://metadataremover.ai/docx-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_editor), and [DOCX Metadata Remover](https://metadataremover.ai/docx-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_remover).
- Video: [Video Metadata Viewer](https://metadataremover.ai/video-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_viewer), [Video Metadata Remover](https://metadataremover.ai/video-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_remover), and the fuller [Video Metadata Editor](https://metadataremover.ai/video-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_editor).
- MP3 audio: [MP3 Metadata Viewer](https://metadataremover.ai/mp3-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_viewer), [MP3 Metadata Editor](https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor), and [MP3 Metadata Remover](https://metadataremover.ai/mp3-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_remover).

## Included tools

| Command | Standalone use case | Changes files? |
| --- | --- | --- |
| `metadata-check` | Find privacy-sensitive metadata categories in build scripts and sharing checks | No |
| `metadata-view` | Review supported EXIF/GPS values, text metadata, containers, and provenance markers; export JSON or CSV | No |
| `metadata-edit` | Update or clear existing fixed-size EXIF title, creator, copyright, and date fields | Writes a new copy |
| `metadata-remove` | Remove supported image privacy metadata while preserving ICC color profiles | Writes a new copy |
| `ai-metadata-remove` | Remove recognized prompts, parameters, and workflow containers while keeping unrelated metadata | Writes a new copy |
| `exif-remove` | Remove complete EXIF containers from a verified JPEG, PNG, or WebP copy | Writes a new copy |
| `pdf-metadata-view` | Audit PDF Info, readable document XMP, and signature boundaries | No |
| `pdf-metadata-edit` | Set or clear selected PDF Info fields while preserving document XMP | Writes a new copy |
| `pdf-metadata-remove` | Remove the complete PDF Info dictionary and document-level XMP | Writes a new copy |
| `docx-metadata-view` | Audit Word properties, comment/revision identities, and package boundaries | No |
| `docx-metadata-edit` | Set or clear selected Word Core Properties plus Company and Manager | Writes a new copy |
| `docx-metadata-remove` | Remove supported properties and thumbnails; anonymize supported author attributes | Writes a new copy |
| `video-metadata-view` | Read focused MP4/MOV user data, timestamps, XMP, and WebM Info/Tags | No |
| `video-metadata-edit` | Update or clear existing descriptive tags without changing container length or media payloads | Writes a new copy |
| `video-metadata-remove` | Apply same-length MP4/MOV `free` or WebM `Void` patches without transcoding media | Writes a new copy |
| `mp3-metadata-view` | Audit ID3v2.3/v2.4, ID3v1, readable APEv2, Lyrics3v2 presence, and cover art | No |
| `mp3-metadata-edit` | Set or clear focused ID3 text fields and APIC cover art while preserving MPEG audio | Writes a new copy |
| `mp3-metadata-remove` | Copy only the original MPEG audio range, dropping supported leading/trailing tags | Writes a new copy |

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/songwenlei/metadataremover.ai.git
cd metadataremover.ai
npm install
npm link

metadata-check photo.jpg
metadata-view photo.jpg
metadata-edit --title "Public photo" --clear creator photo.jpg
metadata-remove photo.jpg
ai-metadata-remove generated.png
exif-remove photo.jpg
pdf-metadata-view report.pdf
pdf-metadata-edit --title "Public report" --clear author report.pdf
pdf-metadata-remove report.pdf
docx-metadata-view proposal.docx
docx-metadata-edit --title "Public proposal" --clear author proposal.docx
docx-metadata-remove proposal.docx
video-metadata-view clip.mp4
video-metadata-edit --title "Public clip" --clear comment clip.mp4
video-metadata-remove clip.mp4
mp3-metadata-view episode.mp3
mp3-metadata-edit --title "Public episode" --clear comment episode.mp3
mp3-metadata-remove episode.mp3
```

You can also run every command directly from the cloned repository:

```bash
node ./bin/metadata-check.js photo.jpg
node ./bin/metadata-view.js photo.jpg
node ./bin/metadata-edit.js --title "Public photo" photo.jpg
node ./bin/metadata-remove.js photo.jpg
node ./bin/ai-metadata-remove.js generated.png
node ./bin/exif-remove.js photo.jpg
node ./bin/pdf-metadata-view.js report.pdf
node ./bin/pdf-metadata-edit.js --title "Public report" report.pdf
node ./bin/pdf-metadata-remove.js report.pdf
node ./bin/docx-metadata-view.js proposal.docx
node ./bin/docx-metadata-edit.js --title "Public proposal" proposal.docx
node ./bin/docx-metadata-remove.js proposal.docx
node ./bin/video-metadata-view.js clip.mp4
node ./bin/video-metadata-edit.js --title "Public clip" clip.mp4
node ./bin/video-metadata-remove.js clip.mp4
node ./bin/mp3-metadata-view.js episode.mp3
node ./bin/mp3-metadata-edit.js --title "Public episode" episode.mp3
node ./bin/mp3-metadata-remove.js episode.mp3
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

## Image Metadata Remover and Editor

`metadata-remove` is the focused general-cleanup companion to the website homepage. It removes complete supported EXIF, XMP, IPTC, JPEG comment, PNG text, and C2PA/JUMBF containers from one JPEG, PNG, or WebP copy. ICC profiles remain because they affect color rendering rather than representing a privacy finding.

```bash
metadata-remove photo.jpg
metadata-remove --output share.webp source.webp
```

The command does not decode or re-encode pixels. It refuses EXIF Orientation values other than `1` unless `--allow-orientation-change` is supplied, because deleting that instruction can change how the same pixels display. The [online Metadata Remover](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_remover) adds visual review, field-level policies, and browser-based orientation handling.

`metadata-edit` updates or clears four existing EXIF ASCII fields: ImageDescription (`--title`), Artist (`--creator`), Copyright, and DateTime (`--date`). It writes into the field's existing byte slot, keeps the complete file length unchanged, recalculates a changed PNG `eXIf` CRC, and reads the requested values back before returning.

```bash
metadata-edit --title "Public photo" --creator "Example Studio" photo.jpg
metadata-edit --clear copyright --output public.png source.png
```

The focused editor does not add missing fields, expand an existing field slot, write Unicode, edit GPS, rebuild XMP/IPTC, or process multiple files. Use the [online Image Metadata Editor](https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor) for those workflows.

See [Image metadata write tools technical limits](docs/image-metadata-tools.md).

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

## DOCX Metadata Tools

`docx-metadata-view` reports Core, Extended and Custom Properties, comment and tracked-change identities, timestamps, document thumbnails, and important package boundaries without changing the Word document.

```bash
docx-metadata-view contract.docx
docx-metadata-view --json contract.docx
```

`docx-metadata-edit` sets, adds, or clears selected Core Properties plus `Company` and `Manager` in a separate copy. It independently reopens the output, verifies each requested value, checks all unedited supported properties, compares Word text, and confirms every untouched expanded OOXML part byte for byte.

```bash
docx-metadata-edit --title "Public proposal" --clear author contract.docx
docx-metadata-edit --company "Example Studio" --modified 2026-08-23T09:30:00+08:00 contract.docx
```

The focused CLI preserves existing Custom Properties, application/statistics fields, comment and revision identities, and thumbnails. It edits fields only when the standard Core or Extended Property part already exists; the [online DOCX Metadata Editor](https://metadataremover.ai/docx-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_editor) adds a visual diff, missing-part creation, and type-safe editing of supported existing Custom Properties.

`docx-metadata-remove` clears supported property records, removes the package thumbnail, pseudonymizes supported comment/revision authors, removes their timestamps, reopens the output, and verifies that visible, deleted, field-code, and comment text stayed unchanged.

```bash
docx-metadata-remove contract.docx
docx-metadata-remove --output public.docx contract.docx
```

Signed, macro/ActiveX, encrypted, ZIP64, and non-DOCX packages remain read-only. Hidden text, external relationships, embedded objects, Custom XML contents, printer settings, and visible content are reported or documented but not silently removed. For a visual workflow, use the online [DOCX Metadata Viewer](https://metadataremover.ai/docx-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_viewer), [DOCX Metadata Editor](https://metadataremover.ai/docx-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_editor), or [DOCX Metadata Remover](https://metadataremover.ai/docx-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=docx_metadata_remover).

See [DOCX metadata tools technical limits](docs/docx-metadata-tools.md).

## Video Metadata Tools

`video-metadata-view` reads a focused, automation-friendly subset of MP4/MOV user-data atoms, creation/modification times, Adobe XMP UUID data, WebM Info values, SimpleTags, and attachment presence.

```bash
video-metadata-view recording.mov
video-metadata-view --json delivery.webm
```

`video-metadata-edit` updates or clears existing title, artist, comment, copyright, and descriptive date tags. New UTF-8 values must fit their existing MP4/MOV atom or WebM element byte slots, so the file length and media offsets stay unchanged.

```bash
video-metadata-edit --title "Public clip" --clear comment recording.mov
video-metadata-edit --artist "Example Studio" --output release.webm source.webm
```

The command reopens the result, checks every requested value, and verifies the standard `mdat` or Cluster media-payload SHA-256 hash. It does not add missing tags or rebuild variable-length metadata; the [online Video Metadata Editor](https://metadataremover.ai/video-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_editor) provides that fuller workflow.

`video-metadata-remove` replaces supported MP4/MOV metadata boxes with same-length `free` boxes, clears supported container timestamps, and replaces WebM Tags, Attachments, and supported Info values with same-length `Void` elements. It then reopens the output and verifies container type, byte length, readable fields, and the hash of standard `mdat` or Cluster media payloads.

```bash
video-metadata-remove recording.mov
video-metadata-remove --output share.webm delivery.webm
```

The CLI does not transcode media and does not remove visible frames, spoken audio, burned-in text, codec identifiers, unknown vendor-private atoms, chapters, or filesystem metadata. The [online Video Metadata Viewer](https://metadataremover.ai/video-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_viewer) provides a fuller normalized report, the [Video Metadata Remover](https://metadataremover.ai/video-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_remover) adds a visual before/after workflow, and the [Video Metadata Editor](https://metadataremover.ai/video-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_editor) handles reviewed field editing.

See [Video metadata tools technical limits](docs/video-metadata-tools.md).

## MP3 Metadata Tools

`mp3-metadata-view` accepts actual MPEG Layer III bytes—not a `.mp3` extension alone—and reports focused ID3v2.3/v2.4 and ID3v1 values, APIC cover details, readable APEv2 text items, and Lyrics3v2 presence.

```bash
mp3-metadata-view episode.mp3
mp3-metadata-view --json episode.mp3
```

For searchable local inspection in the browser, use the [online MP3 Metadata Viewer](https://metadataremover.ai/mp3-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_viewer).

`mp3-metadata-edit` sets or clears title, artist, album, album artist, date, genre, track, disc, comment, and APIC cover art. It rewrites one leading ID3v2 tag, updates ID3v1 only when it already exists, and preserves untouched ID3 frames, APEv2, Lyrics3v2, and the complete MPEG audio range byte-for-byte.

```bash
mp3-metadata-edit --title "Public episode" --clear comment episode.mp3
mp3-metadata-edit --cover cover.png --output release.mp3 episode.mp3
```

`mp3-metadata-remove` drops complete supported leading/trailing tag regions and copies only the original MPEG audio byte range. It then reopens the result and verifies tag absence, audio length and SHA-256, MPEG version, sample rate, and first-frame signature.

```bash
mp3-metadata-remove episode.mp3
mp3-metadata-remove --output share.mp3 episode.mp3
```

Neither write command decodes, normalizes, resamples, or recompresses audio. APEv2 and Lyrics3v2 are preserved by the focused editor and can disagree with edited ID3 values. For visual review and a fuller cover-art workflow, use the [online MP3 Metadata Editor](https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor); for a browser before/after flow, use the [MP3 Metadata Remover](https://metadataremover.ai/mp3-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_remover).

See [MP3 metadata tools technical limits](docs/mp3-metadata-tools.md).

## Privacy and shared limits

- All inspection and cleanup happens on your device.
- Files are never uploaded or used for telemetry.
- Detection is conservative and cannot prove that an image contains no hidden data.
- C2PA/JUMBF detection does not validate cryptographic signatures, trust chains, or claims.
- These tools do not detect or remove pixel-level watermarks such as Google SynthID.
- Image commands do not support HEIC, HEIF, AVIF, video, audio, PDF, or Office documents; each PDF, DOCX, video, and MP3 command accepts only its named container family.
- PDF write commands refuse signed and encrypted files; signature detection is not cryptographic validation.
- PDF page content, annotations, attachments, embedded files, JavaScript, hidden layers, and embedded-image metadata are outside the focused PDF commands.
- DOCX cleanup refuses signed, macro-enabled, encrypted, ZIP64, and non-DOCX packages. It preserves hidden/visible content, external relationships, embedded objects, and Custom XML.
- Video editing and cleanup use same-length container patches and verify standard media payload hashes, but unknown atoms and non-container signals may remain.
- MP3 cleanup verifies the complete MPEG byte-range hash but does not inspect or remove filenames, spoken names, audible watermarks, DRM, copyright protection, or service-side records.
- `ai-metadata-remove` targets recognized PNG text and XMP containers only; it does not remove separate EXIF, C2PA, ICC, comments, or platform-side AI labels.
- `exif-remove` removes EXIF only; use `metadata-remove` for the supported general local cleanup set or the [full browser cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker) for visual review and field-level choices.
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
