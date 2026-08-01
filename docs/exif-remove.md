# EXIF Remover: behavior and technical limits

`exif-remove` creates a new local copy without supported EXIF containers, then parses that copy again to verify that no supported EXIF container remains.

If you prefer a browser interface or need automatic handling for a rotated/mirrored EXIF Orientation value, use the [MetadataRemover.ai online EXIF Remover](https://metadataremover.ai/exif-remover?utm_source=github&utm_medium=referral&utm_campaign=exif_remover). Its inspection, cleanup, verification, and download creation also happen locally in the browser.

## Usage

```bash
exif-remove photo.jpg
exif-remove --output clean.jpg photo.jpg
exif-remove --json photo.webp
```

The default output suffix is `.no-exif`. The command refuses to overwrite an existing output unless `--force` is supplied, and it always refuses to use the input path as the output path.

`--json` returns a versioned report with input/output byte counts, removed-container count, orientation override state, and the verification result. It contains no promotional fields or text.

## What is removed and preserved

| Format | Removed | Preserved by the container-level path |
| --- | --- | --- |
| JPEG | Every EXIF APP1 segment beginning with `Exif\0\0` | Compressed scan data, non-EXIF APP segments, XMP, IPTC, JPEG comments, ICC profiles, C2PA/JUMBF segments |
| PNG | Every `eXIf` chunk | Pixel chunks, PNG text, XMP-like text, ICC profiles, C2PA `caBX`, and unrelated chunks |
| WebP | Every `EXIF` chunk and its VP8X feature bit | Image/alpha/animation chunks, XMP, ICC profiles, C2PA, and unrelated chunks |

Separate metadata is intentionally preserved because this is an EXIF-only tool. For broader cleanup, use the [full online metadata cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker).

## Orientation safety

Many cameras store sideways pixels plus an EXIF Orientation instruction. Removing a value from `2` through `8` without transforming the pixels can make the output appear mirrored or rotated.

The zero-dependency command therefore refuses that case by default. `--allow-orientation-change` explicitly permits lossless container removal while accepting a possible display-orientation change. It does not normalize or re-encode pixels. Use the online EXIF remover when automatic normalization is required.

## Technical limits

- Only JPEG, PNG, and WebP are supported. HEIC, HEIF, AVIF, PDF, video, and Office documents are rejected.
- Removal is structural and lossless for the preserved payload. The command does not decode pixels or compare visual output.
- Verification checks supported EXIF-container absence; it is not a byte-for-byte or perceptual image-quality proof.
- Malformed segment/chunk lengths and inconsistent WebP RIFF sizes are rejected instead of being rewritten speculatively.
- PNG chunk CRCs are preserved for retained chunks. The command does not validate every retained CRC.
- Non-EXIF XMP, IPTC, AI workflow text, comments, ICC profiles, and provenance containers remain.
- C2PA signatures are neither removed nor cryptographically validated by this command.
- Pixel-level watermarks such as Google SynthID are neither detected nor removed.

The original is never modified, and files are never uploaded or used for telemetry.
