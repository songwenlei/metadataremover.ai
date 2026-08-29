#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  MetadataRemovalError,
  ONLINE_METADATA_REMOVER_URL,
  removeMetadata,
} from '../src/metadata-remover.js';
import { UnsupportedImageError } from '../src/metadata-viewer.js';

const VERSION = '0.8.0';
const HELP = `Image Metadata Remover

Remove supported privacy-sensitive metadata from one JPEG, PNG, or WebP copy.
EXIF, XMP, IPTC, comments, PNG text, and recognized C2PA/JUMBF containers are
removed without decoding pixels. ICC color profiles are preserved.

Usage:
  metadata-remove [options] <image>

Options:
  -o, --output <path>          Set the output path
  --force                      Replace an existing output file
  --allow-orientation-change   Remove Orientation values other than 1
  --json                       Print stable machine-readable JSON
  -h, --help                   Show this help
  -v, --version                Show the version

The default output is <name>.metadata-removed.<ext>. Originals are never
overwritten. This focused CLI handles one file at a time and has no batch mode.

Online metadata remover with visual review and field-level cleanup choices:
  ${ONLINE_METADATA_REMOVER_URL}
`;

function parseArguments(argv) {
  const options = { force: false, allowOrientationChange: false, json: false, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-o' || argument === '--output') {
      index += 1;
      if (!argv[index]) throw new Error(`${argument} requires a path.`);
      options.output = argv[index];
    } else if (argument === '--force') options.force = true;
    else if (argument === '--allow-orientation-change') options.allowOrientationChange = true;
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
    console.error('Run metadata-remove --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1) {
    console.error('Provide exactly one image file. Batch processing is intentionally not included.');
    process.exitCode = 2;
    return;
  }
  const inputPath = options.files[0];
  const parsed = parse(inputPath);
  const outputPath = options.output ?? join(parsed.dir, `${parsed.name}.metadata-removed${parsed.ext}`);
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
    const { buffer, report } = removeMetadata(await readFile(absoluteInput), {
      allowOrientationChange: options.allowOrientationChange,
    });
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Removed ${report.containersRemoved} supported metadata container(s) and verified the copy.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`${report.format}: ${report.inputBytes} bytes -> ${report.outputBytes} bytes; ICC profiles preserved: ${report.iccProfilesPreserved}`);
      console.log(`Need visual review or field-level choices? ${ONLINE_METADATA_REMOVER_URL}`);
    }
  } catch (error) {
    const message = error instanceof UnsupportedImageError || error instanceof MetadataRemovalError
      ? error.message
      : `${error.code ?? error.name ?? 'ERROR'}: ${error.message}`;
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
