#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  EDITABLE_VIDEO_FIELDS,
  ONLINE_VIDEO_METADATA_EDITOR_URL,
  VideoMetadataError,
  editVideoMetadata,
} from '../src/video-metadata.js';

const VERSION = '0.8.0';
const FLAGS = { '--title': 'title', '--artist': 'artist', '--comment': 'comment', '--copyright': 'copyright', '--date': 'date' };
const HELP = `Video Metadata Editor

Update or clear existing MP4, MOV, or WebM title, artist, comment, copyright,
and descriptive date tags without moving container offsets or transcoding media.

Usage:
  video-metadata-edit [options] <video>

Options:
  -o, --output <path>    Set the output path
  --title <text>         Update an existing title tag
  --artist <text>        Update an existing artist tag
  --comment <text>       Update an existing comment tag
  --copyright <text>     Update an existing copyright tag
  --date <text>          Update an existing descriptive date tag
  --clear <field>        Clear a supported field; may be repeated
  --force                Replace an existing output file
  --json                 Print stable machine-readable JSON
  -h, --help             Show this help
  -v, --version          Show the version

The new UTF-8 value must fit the existing byte slot. This focused CLI does not
add tags, rebuild variable-length metadata, edit technical/GPS fields, or batch.

Online video metadata editor for adding tags and variable-length rebuilding:
  ${ONLINE_VIDEO_METADATA_EDITOR_URL}
`;

function takeValue(argv, index, flag) {
  if (argv[index + 1] === undefined) throw new Error(`${flag} requires a value.`);
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = { force: false, json: false, files: [], changes: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-o' || argument === '--output') {
      options.output = takeValue(argv, index, argument);
      index += 1;
    } else if (FLAGS[argument]) {
      options.changes[FLAGS[argument]] = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--clear') {
      const field = takeValue(argv, index, argument).toLowerCase();
      if (!EDITABLE_VIDEO_FIELDS.includes(field)) throw new Error(`Unsupported --clear field: ${field}`);
      options.changes[field] = null;
      index += 1;
    } else if (argument === '--force') options.force = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '-v' || argument === '--version') options.version = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function printable(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run video-metadata-edit --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1 || !Object.keys(options.changes).length) {
    console.error('Provide exactly one video and at least one field change. Batch editing is intentionally not included.');
    process.exitCode = 2;
    return;
  }
  const inputPath = options.files[0];
  const parsed = parse(inputPath);
  const outputPath = options.output ?? join(parsed.dir, `${parsed.name}.metadata-edited${parsed.ext}`);
  const absoluteInput = resolve(inputPath);
  const absoluteOutput = resolve(outputPath);
  if (absoluteInput === absoluteOutput) {
    console.error('The output path must differ from the input path; originals are never overwritten.');
    process.exitCode = 2;
    return;
  }
  try {
    const fileStat = await stat(absoluteInput);
    if (!fileStat.isFile()) throw new Error('Path is not a file');
    const { buffer, report } = editVideoMetadata(await readFile(absoluteInput), options.changes);
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Changed ${report.changedFields.length} existing video metadata field(s) and verified the media payload hash.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need to add tags or use longer values? ${ONLINE_VIDEO_METADATA_EDITOR_URL}`);
    }
  } catch (error) {
    const message = error instanceof VideoMetadataError ? error.message : `${error.code ?? error.name ?? 'ERROR'}: ${error.message}`;
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, error: { input: inputPath, message } }, null, 2));
    else console.error(`[ERROR] ${printable(inputPath)} — ${printable(message)}`);
    process.exitCode = 2;
  }
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
