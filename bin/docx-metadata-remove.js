#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_DOCX_METADATA_REMOVER_URL,
  removeDocxMetadata,
} from '../src/docx-metadata.js';

const VERSION = '0.5.0';
const HELP = `DOCX Metadata Remover

Remove supported Word properties, preview thumbnails, and identity attributes from a verified copy.
Visible document and comment text stays unchanged. Signed and macro-enabled packages are refused.

Usage:
  docx-metadata-remove [options] <docx>

Options:
  -o, --output <path>   Set the output path
  --force               Replace an existing output file
  --json                Print stable machine-readable JSON
  -h, --help            Show this help
  -v, --version         Show the version

Online DOCX metadata remover:
  ${ONLINE_DOCX_METADATA_REMOVER_URL}
`;

function parseArguments(argv) {
  const options = { force: false, json: false, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-o' || argument === '--output') {
      index += 1;
      if (!argv[index]) throw new Error(`${argument} requires a path.`);
      options.output = argv[index];
    } else if (argument === '--force') options.force = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '-v' || argument === '--version') options.version = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function defaultOutputPath(inputPath) {
  const parsed = parse(inputPath);
  return join(parsed.dir, `${parsed.name}.no-metadata${parsed.ext}`);
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
    console.error('Run docx-metadata-remove --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1) {
    console.error('Provide exactly one DOCX file.');
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
    const { buffer, report } = removeDocxMetadata(await readFile(absoluteInput));
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Removed ${report.fieldsRemoved} supported DOCX metadata record(s); reopened and verified the copy.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need field-level review before cleanup? ${ONLINE_DOCX_METADATA_REMOVER_URL}`);
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
