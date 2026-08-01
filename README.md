# MetadataRemover.ai Toolkit

Local, privacy-first tools for inspecting and removing hidden image metadata. Every command works on your device, with no file uploads, telemetry, or account.

Prefer a browser? Use the [online Metadata Viewer](https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer), the focused [online EXIF Remover](https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover), or the [full metadata cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker). Image processing stays local in your browser.

## Included tools

| Command | Standalone use case | Changes files? |
| --- | --- | --- |
| `metadata-check` | Find privacy-sensitive metadata categories in build scripts and sharing checks | No |
| `metadata-view` | Review supported EXIF/GPS values, text metadata, containers, and provenance markers; export JSON or CSV | No |
| `exif-remove` | Remove complete EXIF containers from a verified JPEG, PNG, or WebP copy | Writes a new copy |

## Quick start

Requires Node.js 20 or newer.

```bash
git clone git@github.com:songwenlei/metadataremover.ai.git
cd metadataremover.ai
npm install
npm link

metadata-check photo.jpg
metadata-view photo.jpg
exif-remove photo.jpg
```

You can also run every command directly from the cloned repository:

```bash
node ./bin/metadata-check.js photo.jpg
node ./bin/metadata-view.js photo.jpg
node ./bin/exif-remove.js photo.jpg
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

## Privacy and shared limits

- All inspection and cleanup happens on your device.
- Files are never uploaded or used for telemetry.
- Detection is conservative and cannot prove that an image contains no hidden data.
- C2PA/JUMBF detection does not validate cryptographic signatures, trust chains, or claims.
- These tools do not detect or remove pixel-level watermarks such as Google SynthID.
- HEIC, HEIF, AVIF, video, PDF, and Office documents are not supported.
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
