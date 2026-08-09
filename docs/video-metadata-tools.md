# Video metadata tools: behavior and technical limits

The video commands provide a deliberately smaller, automation-oriented companion to the browser tools. They accept MP4, MOV, and WebM by container signature, process local bytes, never overwrite the source, and keep JSON output free of promotional text.

| Command | Focused local operation | Online experience |
| --- | --- | --- |
| `video-metadata-view` | Read focused MP4/MOV and WebM container metadata | [Video Metadata Viewer](https://metadataremover.ai/video-metadata-viewer?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_viewer) |
| `video-metadata-remove` | Replace supported metadata with same-length container padding | [Video Metadata Remover](https://metadataremover.ai/video-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_remover) |

For reviewed title, artist, comment, copyright, and date editing, use the [online Video Metadata Editor](https://metadataremover.ai/video-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=video_metadata_editor). A focused CLI editor is intentionally deferred until it can safely rebuild variable-length metadata, correct fast-start chunk offsets, and add independent playback-oriented verification.

## Viewer

```bash
video-metadata-view source.mp4
video-metadata-view --json source.mov delivery.webm
```

The current viewer reads:

- MP4/MOV `udta`, `meta`, and `ilst` user-data structures;
- common title, artist, album, comment, copyright, date, genre, encoder, and location atoms;
- `mvhd`, `tkhd`, and `mdhd` creation/modification times;
- Adobe XMP UUID containers and bounded packet text;
- WebM Segment title, UTC date, muxing application, writing application, SimpleTags, and attachment presence.

Values are capped at 64 KiB. The report includes a SHA-256 hash of standard MP4/MOV `mdat` payloads or complete WebM Cluster elements when found.

This is not a complete MediaInfo replacement. Track names, language, chapters, HDR/VR fields, arbitrary binary tags, codec details, and unknown vendor-private atoms may remain outside the focused schema.

## Remover

```bash
video-metadata-remove source.mp4
video-metadata-remove --output share.webm source.webm
```

MP4/MOV cleanup changes supported metadata box types to same-length `free` boxes and zeroes supported full-box creation/modification timestamps. Adobe XMP UUID boxes are removed only when their UUID matches the recognized Adobe XMP identifier; unknown UUID boxes are preserved.

WebM cleanup replaces Tags, Attachments, and supported Info children with same-length EBML `Void` elements. Segment and media positions do not move.

Before writing, patches are checked for overlap, bounds, and equal length. Combined rewritten areas are capped at 64 MiB. After writing, the command reopens the output and verifies:

- exact source/output byte-length equality;
- the same MP4, MOV, or WebM signature;
- absence of the focused readable fields;
- equality of the standard `mdat` or Cluster media-payload SHA-256 hash.

## Safety boundaries

- The input is held locally in Node.js memory and capped at 4 GiB; practical limits also depend on the Node process and operating system.
- Media tracks are not decoded, rendered, played, or transcoded. Media-payload hash equality is strong container evidence but not a complete playback test.
- Unknown boxes, unknown UUID containers, QuickTime vendor-private atoms, track names, language, chapters, codec identifiers, and codec bitstreams are preserved unless explicitly covered above.
- Visible frames, burned-in text, spoken audio, steganography, pixel-level watermarks such as SynthID, filesystem timestamps, and platform-side records are outside the command.
- The command does not claim C2PA signature validation or removal of every possible provenance signal.
- A clean focused report is not a complete privacy, authenticity, or forensic guarantee.

No selected video, extracted value, generated copy, or report is uploaded or used for telemetry.
