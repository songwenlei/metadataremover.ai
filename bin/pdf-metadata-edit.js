#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  EDITABLE_PDF_FIELDS,
  ONLINE_PDF_METADATA_EDITOR_URL,
  editPdfMetadata,
} from '../src/pdf-metadata.js';

const VERSION = '0.8.0';
const FLAG_FIELDS = {
  '--title': 'title',
  '--author': 'author',
  '--subject': 'subject',
  '--keywords': 'keywords',
  '--creator': 'creator',
  '--producer': 'producer',
  '--creation-date': 'creationDate',
  '--modification-date': 'modificationDate',
};
const CLEAR_FIELDS = new Map(EDITABLE_PDF_FIELDS.map((field) => [field.toLowerCase(), field]));
const HELP = `PDF Metadata Editor

Set or clear supported PDF Info fields in a separate, verified local copy.
Document XMP is preserved. Signed and encrypted PDFs are refused.

Usage:
  pdf-metadata-edit [options] <pdf>

Options:
  -o, --output <path>          Set the output path
  --title <text>               Set Title
  --author <text>              Set Author
  --subject <text>             Set Subject
  --keywords <text>            Set Keywords
  --creator <text>             Set Creator
  --producer <text>            Set Producer
  --creation-date <ISO date>   Set CreationDate
  --modification-date <ISO>    Set ModDate
  --clear <field>              Clear a supported field; may be repeated
  --force                      Replace an existing output file
  --json                       Print stable machine-readable JSON
  -h, --help                   Show this help
  -v, --version                Show the version

Example:
  pdf-metadata-edit --title "Public report" --clear author document.pdf

Online PDF metadata editor with readable XMP editing:
  ${ONLINE_PDF_METADATA_EDITOR_URL}
`;

function takeValue(argv, index, flag) {
  if (!argv[index + 1]) throw new Error(`${flag} requires a value.`);
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = { force: false, json: false, files: [], changes: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-o' || argument === '--output') {
      options.output = takeValue(argv, index, argument);
      index += 1;
    } else if (FLAG_FIELDS[argument]) {
      options.changes[FLAG_FIELDS[argument]] = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--clear') {
      const rawField = takeValue(argv, index, argument);
      const field = CLEAR_FIELDS.get(rawField.replace(/[-_]/g, '').toLowerCase())
        ?? EDITABLE_PDF_FIELDS.find((candidate) => candidate.toLowerCase() === rawField.toLowerCase());
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
    console.error('Run pdf-metadata-edit --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1 || Object.keys(options.changes).length === 0) {
    console.error('Provide exactly one PDF and at least one field change.');
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
    const { buffer, report } = await editPdfMetadata(await readFile(absoluteInput), options.changes);
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Changed ${report.changedFields.length} PDF Info field${report.changedFields.length === 1 ? '' : 's'} and verified the copy.`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need readable XMP editing or a visual diff? ${ONLINE_PDF_METADATA_EDITOR_URL}`);
    }
  } catch (error) {
    const message = `${error.code ?? error.name ?? 'ERROR'}: ${error.message}`;
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, error: { input: inputPath, message } }, null, 2));
    else {
      console.error(`[ERROR] ${printable(inputPath)} — ${printable(message)}`);
      if (error.name === 'SignedPdfError') console.error(`Review the signed-copy boundary online: ${ONLINE_PDF_METADATA_EDITOR_URL}`);
    }
    process.exitCode = 2;
  }
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
