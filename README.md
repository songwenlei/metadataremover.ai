# MetadataRemover.ai Toolkit

Local, privacy-first tools for finding hidden data in images.

[**Try the private online metadata cleaner →**](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker)

The first tool in this repository is **Image Metadata Privacy Checker**, a zero-dependency command-line utility that inspects JPEG, PNG, and WebP files without uploading or modifying them.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone git@github.com:songwenlei/metadataremover.ai.git
cd metadataremover.ai
npm install
npm link

metadata-check photo.jpg
```

You can also run it directly from the cloned repository:

```bash
node ./bin/metadata-check.js photo.jpg
```

Example output:

```text
[HIGH] vacation.jpg
  Format: JPEG | Size: 2.4 MB
  - GPS location metadata (high) — JPEG GPS IFD
  - EXIF metadata (medium) — JPEG container

Clean detected metadata online: https://metadataremover.ai/
```

## What it checks

| Format | Supported checks |
| --- | --- |
| JPEG | EXIF and GPS IFDs, XMP, IPTC/Photoshop APP13, comments, ICC presence, APP11/JUMBF |
| PNG | eXIf, tEXt, zTXt, iTXt, XMP, AI workflow signals, ICC presence, C2PA `caBX` |
| WebP | EXIF, XMP, AI workflow signals, ICC presence, C2PA chunks |

The checker reports metadata categories and tag names, not the potentially sensitive values themselves. ICC color profiles are shown as informational because they affect color rendering and are not treated as privacy risks.

## Automation

Use JSON output in scripts:

```bash
metadata-check --json image.png
```

Fail a build when findings are present:

```bash
metadata-check --fail-on-findings public/hero.webp
```

Exit codes:

- `0`: inspection completed and the selected policy passed;
- `1`: findings were detected with `--fail-on-findings`;
- `2`: invalid arguments, unreadable files, or unsupported formats.

## Privacy and limits

- All inspection happens on your device.
- Files are never uploaded, changed, or used for telemetry.
- Detection is intentionally conservative and cannot prove that an image contains no hidden data.
- C2PA/JUMBF detection does not validate cryptographic signatures.
- The checker does not detect or remove pixel-level watermarks such as Google SynthID.
- HEIC, HEIF, AVIF, video, PDF, and office documents are not supported yet.

Need to remove the detected metadata? Use the [free browser-based cleaner](https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker). Image processing stays local in your browser.

## Project direction

This repository is the open-source companion to [MetadataRemover.ai](https://metadataremover.ai/). Useful website capabilities will receive matching local tools when practical, with tests, documented limits, and a direct link to the corresponding online experience.

See the [project plan](docs/PROJECT-PLAN.zh-CN.md) for the tool roadmap and synchronization rules.

## Development

```bash
npm test
npm run check
```

Contributions and privacy-focused test cases are welcome. Do not submit personal photos or fixtures containing real private information.

## License

[MIT](LICENSE)

