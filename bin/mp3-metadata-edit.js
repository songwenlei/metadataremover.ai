#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  EDITABLE_MP3_FIELDS,
  ONLINE_MP3_METADATA_EDITOR_URL,
  editMp3Metadata,
} from '../src/mp3-metadata.js';

const VERSION = '0.7.0';
const FLAG_FIELDS = {
  '--title': 'title',
  '--artist': 'artist',
  '--album': 'album',
  '--album-artist': 'albumArtist',
  '--date': 'date',
  '--genre': 'genre',
  '--track': 'track',
  '--disc': 'disc',
  '--comment': 'comment',
};
const CLEAR_FIELDS = new Map(EDITABLE_MP3_FIELDS.map((field) => [field.toLowerCase(), field]));
const HELP = `MP3 Metadata Editor

Set or clear focused ID3 text fields and APIC cover art in a separate verified copy.
Untouched ID3 frames, MPEG audio, APEv2, and Lyrics3v2 are preserved byte-for-byte.

Usage:
  mp3-metadata-edit [options] <mp3>

Options:
  -o, --output <path>       Set the output path
  --title <text>            Set title
  --artist <text>           Set artist
  --album <text>            Set album
  --album-artist <text>     Set album artist
  --date <text>             Set date/year
  --genre <text>            Set genre
  --track <text>            Set track, such as 3/12
  --disc <text>             Set disc, such as 1/2
  --comment <text>          Set a focused English comment
  --cover <image>           Set front cover from JPEG, PNG, or WebP
  --cover-description <t>   Set the new cover description
  --clear <field>           Clear a supported field; may be repeated
  --force                   Replace an existing output file
  --json                    Print stable machine-readable JSON
  -h, --help                Show this help
  -v, --version             Show the version

Example:
  mp3-metadata-edit --title "Public episode" --clear comment source.mp3

Online MP3 metadata editor with a visual cover-art workflow:
  ${ONLINE_MP3_METADATA_EDITOR_URL}
`;

function takeValue(argv, index, flag) {
  if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = { force: false, json: false, files: [], changes: {}, coverDescription: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-o' || argument === '--output') {
      options.output = takeValue(argv, index, argument);
      index += 1;
    } else if (FLAG_FIELDS[argument]) {
      options.changes[FLAG_FIELDS[argument]] = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--cover') {
      options.coverPath = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--cover-description') {
      options.coverDescription = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--clear') {
      const rawField = takeValue(argv, index, argument);
      const field = CLEAR_FIELDS.get(rawField.replace(/[-_]/g, '').toLowerCase())
        ?? EDITABLE_MP3_FIELDS.find((candidate) => candidate.toLowerCase() === rawField.toLowerCase());
      if (!field) throw new Error(`Unsupported --clear field: ${rawField}`);
      options.changes[field] = null;
      index += 1;
    } else if (argument === '--force') options.force = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '-v' || argument === '--version') options.version = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  if (options.coverDescription && !options.coverPath) throw new Error('--cover-description requires --cover.');
  return options;
}

function defaultOutputPath(inputPath) {
  const parsed = parse(inputPath);
  return join(parsed.dir, `${parsed.name}.metadata-edited${parsed.ext}`);
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
    console.error('Run mp3-metadata-edit --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1 || (Object.keys(options.changes).length === 0 && !options.coverPath)) {
    console.error('Provide exactly one MP3 and at least one field or cover-art change.');
    process.exitCode = 2;
    return;
  }
  const inputPath = options.files[0];
  const outputPath = options.output ?? defaultOutputPath(inputPath);
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
    if (options.coverPath) {
      const absoluteCover = resolve(options.coverPath);
      const coverStat = await stat(absoluteCover);
      if (!coverStat.isFile()) throw new Error('Cover path is not a file');
      options.changes.coverArt = {
        data: await readFile(absoluteCover),
        description: options.coverDescription || basename(options.coverPath),
        pictureType: 3,
      };
    }
    const { buffer, report } = editMp3Metadata(await readFile(absoluteInput), options.changes);
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Changed ${report.changedFields.length} MP3 metadata field(s) and verified the unchanged MPEG audio payload.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need a visual cover-art and before/after workflow? ${ONLINE_MP3_METADATA_EDITOR_URL}`);
    }
  } catch (error) {
    const message = `${error.code ?? error.name ?? 'ERROR'}: ${error.message}`;
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
