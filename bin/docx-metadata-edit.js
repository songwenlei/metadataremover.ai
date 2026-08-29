#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_DOCX_METADATA_EDITOR_URL,
  editDocxMetadata,
} from '../src/docx-metadata.js';

const VERSION = '0.8.0';
const FLAG_FIELDS = {
  '--title': 'title',
  '--subject': 'subject',
  '--author': 'creator',
  '--keywords': 'keywords',
  '--description': 'description',
  '--last-modified-by': 'lastModifiedBy',
  '--revision': 'revision',
  '--created': 'created',
  '--modified': 'modified',
  '--last-printed': 'lastPrinted',
  '--category': 'category',
  '--status': 'contentStatus',
  '--identifier': 'identifier',
  '--language': 'language',
  '--document-version': 'version',
  '--company': 'company',
  '--manager': 'manager',
};
const CLEAR_FIELDS = new Map([
  ['title', 'title'],
  ['subject', 'subject'],
  ['author', 'creator'],
  ['creator', 'creator'],
  ['keywords', 'keywords'],
  ['description', 'description'],
  ['lastmodifiedby', 'lastModifiedBy'],
  ['revision', 'revision'],
  ['created', 'created'],
  ['modified', 'modified'],
  ['lastprinted', 'lastPrinted'],
  ['category', 'category'],
  ['status', 'contentStatus'],
  ['contentstatus', 'contentStatus'],
  ['identifier', 'identifier'],
  ['language', 'language'],
  ['version', 'version'],
  ['documentversion', 'version'],
  ['company', 'company'],
  ['manager', 'manager'],
]);

const HELP = `DOCX Metadata Editor

Set or clear selected Word Core Properties plus Company and Manager in a separate, verified copy.
Visible content, comments, tracked changes, Custom Properties, and unedited package parts are preserved.

Usage:
  docx-metadata-edit [options] <docx>

Common field options:
  --title <text>              Set Title
  --author <text>             Set Author / Creator
  --subject <text>            Set Subject
  --keywords <text>           Set Keywords
  --description <text>        Set Description
  --company <text>            Set Company
  --manager <text>            Set Manager
  --created <ISO date>        Set Created with an explicit timezone
  --modified <ISO date>       Set Modified with an explicit timezone
  --last-printed <ISO date>   Set Last Printed with an explicit timezone

Additional field options:
  --last-modified-by <text>   Set Last Modified By
  --revision <digits>         Set Revision
  --category <text>           Set Category
  --status <text>             Set Content Status
  --identifier <text>         Set Identifier
  --language <text>           Set Language
  --document-version <text>   Set the document Version property

Output and clearing:
  --clear <field>             Clear a supported field; may be repeated
  -o, --output <path>         Set the output path
  --force                     Replace an existing output file
  --json                      Print stable machine-readable JSON
  -h, --help                  Show this help
  -v, --version               Show the version

Example:
  docx-metadata-edit --title "Public proposal" --clear author proposal.docx

Online DOCX metadata editor with existing type-safe Custom Property editing:
  ${ONLINE_DOCX_METADATA_EDITOR_URL}
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
    } else if (FLAG_FIELDS[argument]) {
      options.changes[FLAG_FIELDS[argument]] = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === '--clear') {
      const rawField = takeValue(argv, index, argument);
      const field = CLEAR_FIELDS.get(rawField.replace(/[-_]/g, '').toLowerCase());
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
    console.error('Run docx-metadata-edit --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length !== 1 || Object.keys(options.changes).length === 0) {
    console.error('Provide exactly one DOCX file and at least one field change.');
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
    const { buffer, report } = editDocxMetadata(await readFile(absoluteInput), options.changes);
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };
    if (options.json) console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    else {
      console.log(`Applied and verified ${report.changedFields.length} DOCX metadata field request(s).`);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`Need Custom Property editing or a visual diff? ${ONLINE_DOCX_METADATA_EDITOR_URL}`);
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
