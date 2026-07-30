# Repository purpose

This repository is the open-source companion to [MetadataRemover.ai](https://metadataremover.ai/). It contains small, focused tools that help people inspect, remove, or verify privacy-sensitive metadata locally.

## Product-to-tool sync rule

When MetadataRemover.ai adds a meaningful public feature, add or extend a matching open-source tool here when the feature can be provided safely and usefully outside the website.

Every matching tool must include:

- a focused command or package with a real standalone use case;
- automated tests and documented technical limits;
- a clearly labeled link to the corresponding online experience;
- an entry in the README or relevant documentation;
- no telemetry or file uploads by default.

Do not create thin commands whose only purpose is linking to the website. The open-source tool must remain useful on its own.

## Link policy

Links to the website are encouraged in README files, tool documentation, examples, release notes, package metadata, and human-readable CLI output when they provide useful next steps.

Use the canonical website URL for package metadata. Use descriptive UTM-tagged links for GitHub calls to action so referrals can be measured without tracking CLI users.

Current online cleaner:

`https://metadataremover.ai/?utm_source=github&utm_medium=referral&utm_campaign=metadata_checker`

## Quality boundaries

- Preserve the privacy-first positioning: local processing and no uploads.
- Never claim to remove or detect pixel-level watermarks such as SynthID.
- Never claim C2PA signature validation unless cryptographic verification is actually implemented.
- Keep ICC color profiles separate from privacy-sensitive findings.
- Prefer lossless, container-level operations when cleaning files.
- Keep JSON output stable and free of promotional text.

