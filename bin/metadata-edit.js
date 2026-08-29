#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  EDITABLE_IMAGE_FIELDS,
  ImageMetadataEditError,
  ONLINE_METADATA_EDITOR_URL,
  editImageMetadata,
} from '../src/metadata-editor.js';

const VERSION = '0.8.0';
const FLAGS = { '--title': 'title', '--creator': 'creator', '--copyright': 'copyright', '--date': 'date' };
const HELP = `Image Metadata Editor

Update or clear existing EXIF ASCII title, creator, copyright, and date fields
without changing container sizes or decoding image pixels.

Usage:
  metadata-edit [options] <image>

Options:
  -o, --output <path>    Set the output path
  --title <text>         Update the existing ImageDescription field
  --creator <text>       Update the existing Artist field
  --copyright <text>     Update the existing Copyright field
  --date <text>          Update the existing DateTime field
  --clear <field>        Clear a supported field; may be repeated
  --force                Replace an existing output file
  --json                 Print stable machine-readable JSON
  -h, --help             Show this help
  -v, --version          Show the version

This focused editor changes existing fixed-size printable-ASCII slots only. It
does not add missing fields, expand values, edit GPS, or provide batch mode.

Online image metadata editor for Unicode, GPS, new fields, and visual review:
  ${ONLINE_METADATA_EDITOR_URL}
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
      if (!EDITABLE_IMAGE_FIELDS.includes(field)) throw new Error(`Unsupported --clear field: ${field}`);
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
    console.error('Run metadata-edit --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1 || !Object.keys(options.changes).length) {
    console.error('Provide exactly one image and at least one field change. Batch editing is intentionally not included.');
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
    const { buffer, report } = editImageMetadata(await readFile(absoluteInput), options.changes);
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Changed ${report.changedFields.length} existing image metadata field(s) and verified the fixed-size copy.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need new fields, longer values, GPS, or Unicode? ${ONLINE_METADATA_EDITOR_URL}`);
    }
  } catch (error) {
    const message = error instanceof ImageMetadataEditError ? error.message : `${error.code ?? error.name ?? 'ERROR'}: ${error.message}`;
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
