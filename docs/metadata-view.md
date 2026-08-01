# Metadata Viewer: behavior and technical limits

`metadata-view` creates a read-only report from a local JPEG, PNG, or WebP file. It is useful for audits, support investigations, publishing checks, and reviewing what a camera or generator embedded before sharing an image.

For an interactive field search, privacy filter, and locally generated report download, use the [MetadataRemover.ai online Metadata Viewer](https://metadataremover.ai/metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=metadata_viewer). The browser experience also processes the selected image on-device.

## Usage

```bash
metadata-view image.jpg
metadata-view --privacy-only image.jpg
metadata-view --json image.png
metadata-view --csv images/*.webp > report.csv
```

Human output is intended for review. `--json` emits a stable top-level `schemaVersion`, `results`, and `errors` structure. Each result contains fields, containers, and parser warnings. `--csv` emits one field or container per row and prefixes cells beginning with `=`, `+`, `-`, or `@` so untrusted metadata is not executed as a spreadsheet formula.

Neither machine-readable format includes website links or promotional text.

## Supported reads

| Format | Supported report data |
| --- | --- |
| JPEG | Common TIFF/EXIF and GPS fields, derived decimal GPS coordinates, XMP packet text, comments, IPTC/Photoshop APP13 presence, ICC presence, APP11/JUMBF markers |
| PNG | Common `eXIf` fields, `tEXt`, `zTXt`, and `iTXt` values, AI workflow signals, XMP/IPTC keyword signals, ICC presence, `caBX` markers |
| WebP | Common EXIF fields, XMP packet text and AI signals, ICC presence, supported C2PA chunks |

ICC color profiles are listed as informational records rather than privacy findings.

## Technical limits

- EXIF support is a safe subset of TIFF field types and common camera, lens, time, identifier, orientation, and GPS tags. Unknown safe-to-read tags are reported by hexadecimal ID.
- XMP is exposed as a bounded raw packet; this command does not implement a complete RDF/XMP semantic model.
- JPEG APP13/IPTC is reported as a container. Individual binary IPTC datasets are not decoded yet.
- Text values are capped at 64 KiB and the report is capped at 4,096 fields. Warnings and `truncated: true` make these limits explicit.
- Compressed PNG text is inflated with a bounded output limit. Invalid or oversized streams produce a warning instead of unbounded allocation.
- The human view shortens very long values to keep terminal output usable; JSON retains the bounded value.
- File signatures, not extensions, select the parser. Malformed or truncated structures may yield warnings and a partial report.
- A missing field is not proof that the image is private, human-made, or free of other provenance signals.
- C2PA/JUMBF markers are detected only. Signatures, trust chains, and claim history are not cryptographically validated.
- Pixel-level watermarks such as Google SynthID are outside the scope of a container metadata viewer.
- HEIC, HEIF, AVIF, PDF, video, and Office files are unsupported.

The command never modifies, uploads, or sends telemetry about a selected file.
