# Image metadata write tools: behavior and technical limits

`metadata-remove` and `metadata-edit` are deliberately focused, single-file companions to the browser tools. They accept JPEG, PNG, and WebP by container signature, keep the original path untouched, reopen each generated copy, and never upload files or add promotional data to JSON output.

| Command | Focused local operation | Online experience |
| --- | --- | --- |
| `metadata-remove` | Remove complete supported privacy-metadata containers while preserving ICC | [Metadata Remover](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_remover) |
| `metadata-edit` | Change or clear four existing fixed-size EXIF ASCII fields | [Image Metadata Editor](https://metadataremover.ai/metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=metadata_editor) |

Neither command includes batch processing. The online product remains the appropriate path for multiple files, visual before/after review, policy selection, and wider field editing.

## General remover

```bash
metadata-remove source.jpg
metadata-remove --output public.png source.png
```

The remover performs lossless container-level rewriting:

| Format | Removed | Preserved by this operation |
| --- | --- | --- |
| JPEG | EXIF APP1, recognized XMP APP1, APP13/IPTC, COM comments, APP11/JUMBF | Scan data, JFIF, Adobe rendering data, ICC APP2, unknown application segments |
| PNG | `eXIf`, `tEXt`, `zTXt`, `iTXt`, `caBX` | Image chunks, animation chunks, `iCCP`, and unknown chunks |
| WebP | `EXIF`, `XMP `, `C2PA`; corresponding VP8X EXIF/XMP flags | Image/alpha/animation chunks, `ICCP`, and unknown chunks |

The generated copy is scanned again. Verification fails if the focused viewer still reports a supported EXIF, XMP, IPTC, comment, PNG text, AI, or C2PA/JUMBF container. ICC is reported separately and retained.

EXIF Orientation other than `1` is refused by default. `--allow-orientation-change` removes it without rotating pixels; this explicit override can make the same pixels display rotated or mirrored. The browser tool is the better option when visual orientation handling is required.

Removing C2PA/JUMBF containers is byte-level removal only. The command does not validate signatures, trust chains, manifests, or provenance claims before or after removal.

## Fixed-slot editor

```bash
metadata-edit --title "Public photo" --creator "Example Studio" source.jpg
metadata-edit --clear copyright --date "2026:08:29 09:30:00" source.webp
```

The editor supports these IFD0 EXIF ASCII tags when the tag already exists:

| CLI field | EXIF tag |
| --- | --- |
| `title` | `ImageDescription` (`0x010e`) |
| `creator` | `Artist` (`0x013b`) |
| `copyright` | `Copyright` (`0x8298`) |
| `date` | `DateTime` (`0x0132`) |

Printable ASCII values must fit the tag's existing byte count, including a null terminator. Clearing fills that existing value slot with null bytes. Container sizes, JPEG scan bytes, PNG image chunks, WebP image chunks, and all unrelated metadata stay in place. A changed PNG `eXIf` chunk receives a recalculated CRC.

The command changes every matching copy of a requested tag, reparses the output, and requires every matching value to equal the request. It refuses a missing tag, unsupported encoding, oversized value, or no-op request rather than rebuilding the EXIF directory.

Use the online editor when you need to add a field, expand a value, use Unicode, edit GPS, edit keywords, coordinate EXIF/XMP/IPTC values, normalize orientation, or review a visual diff.

## Shared boundaries

- Pixel data is never decoded, normalized, rendered, or re-encoded.
- HEIC, HEIF, AVIF, PDF, video, audio, and Office files are rejected.
- Unknown application segments and chunks may contain metadata that the focused viewer does not identify.
- Filesystem names and timestamps, visible pixels, steganography, platform-side records, and pixel-level watermarks such as SynthID are outside these commands.
- A verified focused report is not a complete privacy, authenticity, color, or forensic guarantee.
- Source files, extracted values, reports, and generated copies remain local and are not used for telemetry.
