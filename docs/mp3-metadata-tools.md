# MP3 metadata tools: behavior and technical limits

The MP3 commands are focused local companions to the browser editor and remover. They accept files by consecutive MPEG Layer III frame headers—not by extension—never overwrite the source, independently reopen written copies, and keep machine-readable output free of promotional text.

| Command | Focused local operation | Online experience |
| --- | --- | --- |
| `mp3-metadata-view` | Read supported tag containers and common ID3 fields | [MP3 Metadata Editor](https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor) |
| `mp3-metadata-edit` | Set or clear focused ID3 fields while preserving audio and untouched frames | [MP3 Metadata Editor](https://metadataremover.ai/mp3-metadata-editor?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_editor) |
| `mp3-metadata-remove` | Copy only the original MPEG audio range and drop supported surrounding tags | [MP3 Metadata Remover](https://metadataremover.ai/mp3-metadata-remover?utm_source=github&utm_medium=referral&utm_campaign=mp3_metadata_remover) |

## Viewer

```bash
mp3-metadata-view source.mp3
mp3-metadata-view --json source.mp3
```

The viewer recognizes:

- leading ID3v2.3 and ID3v2.4 tags, including tag-level extended-header, footer, and unsynchronization boundaries;
- common title, artist, album, album artist, date/year, genre, track, disc, and comment frames;
- APIC cover-art MIME type, picture type, description, byte length, and SHA-256 without exporting image bytes;
- a trailing ID3v1 tag, including its optional track byte and standard genre number;
- trailing APEv2 boundaries and bounded UTF-8 text items;
- trailing Lyrics3v2 container presence;
- MPEG version, Layer III, sample rate, first-frame bitrate/channel mode, first-frame signature, audio range, and complete audio SHA-256.

Text values are capped at 64 KiB, ID3 frames at 16 MiB, the complete ID3 tag at 64 MiB, and frame count at 4,096. APIC image bytes are hashed rather than printed. Binary APEv2 values and Lyrics3v2 fields are not decoded.

## Focused editor

```bash
mp3-metadata-edit --title "Public episode" --clear artist source.mp3
mp3-metadata-edit --album "Release" --cover cover.webp --output edited.mp3 source.mp3
```

The editor supports `title`, `artist`, `album`, `albumArtist`, `date`, `genre`, `track`, `disc`, `comment`, and `coverArt`. JPEG, PNG, and WebP cover bytes are accepted after signature checks, up to 16 MiB.

An existing ID3v2.3 tag remains v2.3 and uses `TYER` for the first four date characters; an existing ID3v2.4 tag remains v2.4 and uses UTF-8 `TDRC`. A tagless MP3 receives ID3v2.4. ID3v1 is updated only when already present because silently adding its lossy, fixed-width representation can create unexpected duplicates. Non-Latin-1 ID3v1 characters are represented by `?`, and fixed-width values are truncated exactly as the format requires; the output is read back against those encoded values.

Untouched ID3v2 frames are copied byte-for-byte. Changed fields replace every matching standard frame so duplicate stale values do not remain. APEv2 and Lyrics3v2 remain byte-identical and are called out because they can contain values that disagree with the edited ID3 tag.

For safety, this focused editor refuses:

- multiple leading ID3v2 tags;
- tag-level unsynchronized, extended-header, or experimental ID3 tags;
- malformed, oversized, or out-of-bounds tags and frames;
- unsupported cover formats or mismatched cover MIME claims.

After writing in memory, it reopens the output and verifies requested ID3 values, cover hash and MIME type, untouched-frame hashes, preserved APEv2/Lyrics3v2 hashes, complete MPEG audio SHA-256 and length, MPEG version, sample rate, and first-frame signature.

## Lossless tag remover

```bash
mp3-metadata-remove source.mp3
mp3-metadata-remove --output share.mp3 source.mp3
```

The remover locates complete supported ID3v2 tags before the first MPEG frame and supported ID3v1, APEv2, and Lyrics3v2 blocks after the audio. It writes only the exact original MPEG audio byte range into the new file. ID3 cover art leaves with ID3v2; no audio frames are decoded or regenerated.

The output is reopened and must contain no supported tag container. Verification also requires exact audio byte length and SHA-256 equality plus unchanged MPEG version, sample rate, and first-frame signature.

## Shared safety boundaries

- Input is processed in local Node.js memory and capped at 500 MiB. No file, extracted value, report, or generated copy is uploaded or used for telemetry.
- The consecutive-frame check rejects a renamed non-MP3 file but is not a complete decoder or playback test. Free-format streams and unusual valid encodings outside this focused parser can be rejected.
- Compressed, encrypted, grouped, or vendor-private ID3 frames are preserved without interpretation when their boundaries are readable. Tag-level unsynchronization is decoded only for inspection and makes the focused editor read-only.
- APEv2 binary items and Lyrics3v2 fields are not decoded. The remover drops their complete detected containers; the editor preserves them.
- Filename, directory name, filesystem timestamps, spoken names, audible or acoustic watermarks, audio fingerprints, DRM, copyright protection, streaming-service databases, and account-side records are not tag cleanup targets.
- Edited tags are descriptive data, not authentication, ownership, or provenance proof.
- A clean focused report is not a complete privacy or forensic guarantee.
