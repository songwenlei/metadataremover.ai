# AI Metadata Remover: behavior and technical limits

`ai-metadata-remove` creates a new local copy without recognized AI-generation recipe containers, then scans that copy again before writing it. The focused default is useful when a delivery image should lose prompts, seeds, sampler settings, model references, or workflow graphs without discarding unrelated photo or provenance metadata.

For a visual field review and a deliberate choice between AI-only and broader private-metadata cleanup, use the [MetadataRemover.ai online AI Metadata Remover](https://metadataremover.ai/ai-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=ai_metadata_remover). Inspection, cleanup, verification, and download creation also happen locally in the browser.

## Usage

```bash
ai-metadata-remove generated.png
ai-metadata-remove --output share.png generated.png
ai-metadata-remove --json generated.webp
```

The default output suffix is `.no-ai-metadata`. Existing output files are protected unless `--force` is supplied, and the input path is never accepted as the output path.

`--json` returns a versioned report with byte counts, recognized-container counts by type, warnings, and the verification result. Machine-readable output contains no website link or promotional text.

## What AI-only mode removes

| Format | Removed when recognized as AI metadata |
| --- | --- |
| JPEG | XMP APP1 segments containing common generator names, prompt/workflow terms, seed/sampler/scheduler/CFG/checkpoint fields, or supported AI digital-source values |
| PNG | Whole `tEXt`, `zTXt`, or `iTXt` chunks whose keyword or readable value matches supported prompt, parameters, workflow, generator, or AI-source patterns |
| WebP | AI-marked `XMP ` chunks; the VP8X XMP feature flag is cleared only when no XMP chunk remains |

Removal is deliberately container-level. If an AI-marked PNG text chunk or XMP packet also contains an unrelated value, that value leaves with the selected container.

## What stays by default

- EXIF camera, lens, capture-time, orientation, and GPS data;
- IPTC publishing data and generic PNG text;
- JPEG comments, even when their prose happens to mention prompts;
- C2PA/JUMBF and Content Credentials containers;
- ICC color profiles;
- image, alpha, and animation payloads.

Use the [full online metadata cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker) when those separate metadata families also need to leave.

## Technical limits

- Recognition is conservative pattern matching, not a universal generator database. A false positive or false negative is possible, so keep an untouched master and inspect the exact delivery copy.
- A generator may write no readable recipe, use an unknown key, split a signal across extended XMP segments, or store data in an unsupported structure.
- Each readable or decompressed text value is inspected up to a 1 MiB safety limit. An invalid or oversized compressed PNG text chunk is preserved and reported as a warning.
- JPEG, PNG, and WebP are supported. HEIC, HEIF, AVIF, PDF, video, and Office files are rejected.
- Malformed segment/chunk lengths and inconsistent WebP RIFF sizes are rejected rather than rewritten speculatively.
- Retained compressed pixels are not decoded or recompressed. Verification checks recognized target-container absence, not perceptual image identity.
- C2PA signatures, trust chains, and claims are not cryptographically validated.
- SynthID, fingerprints, visible watermarks, and other pixel-level signals are not detected or removed.
- Cleaning local file metadata cannot change a platform label, upload history, external database, or AI classifier result.

The original is never modified, and files, prompts, and reports are never uploaded or used for telemetry.
