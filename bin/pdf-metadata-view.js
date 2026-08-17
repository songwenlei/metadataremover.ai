#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_PDF_METADATA_VIEWER_URL,
  UnsupportedPdfError,
  viewPdfMetadata,
} from '../src/pdf-metadata.js';

const VERSION = '0.6.0';
const HELP = `PDF Metadata Viewer

Inspect PDF Info fields, document XMP, and signature boundaries locally.
Files are never uploaded or modified.

Usage:
  pdf-metadata-view [options] <pdf...>

Options:
  --json            Print stable machine-readable JSON
  -h, --help        Show this help
  -v, --version     Show the version

Examples:
  pdf-metadata-view document.pdf
  pdf-metadata-view --json report.pdf

Online PDF metadata viewer:
  ${ONLINE_PDF_METADATA_VIEWER_URL}
`;

function parseArguments(argv) {
  const options = { json: false, files: [] };
  for (const argument of argv) {
    if (argument === '--json') options.json = true;
    else if (argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '-v' || argument === '--version') options.version = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function printable(value, maximum = 500) {
  const safe = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '?')
    .replace(/\r?\n/g, '\\n');
  return safe.length > maximum ? `${safe.slice(0, maximum)}…` : safe;
}

function printHuman(result) {
  console.log(`${printable(result.file)} — PDF, ${result.size} bytes, ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}`);
  if (result.fields.length === 0 && !result.xmp) console.log('  No supported document metadata records were found.');
  for (const field of result.fields) {
    console.log(`  - [${field.privacy}] ${field.path} = ${printable(field.value)}${field.truncated ? ' [truncated]' : ''}`);
  }
  if (result.xmp) {
    const status = result.xmp.readable ? 'readable' : 'container only';
    console.log(`  - [medium] XMP — ${result.xmp.length} bytes (${status})`);
  }
  if (result.signatures.detected) {
    console.log(`  Signature boundary markers: ${Math.max(result.signatures.fields.length, result.signatures.rawByteRangeCount)} (detection only; trust not validated)`);
  }
  for (const warning of result.warnings) console.log(`  Warning: ${printable(warning)}`);
}

async function inspectFile(inputPath) {
  const absolutePath = resolve(inputPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error('Path is not a file');
  return { file: inputPath, ...await viewPdfMetadata(await readFile(absolutePath)) };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run pdf-metadata-view --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (options.files.length === 0) {
    console.error('No PDF file provided.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  const errors = [];
  for (const inputPath of options.files) {
    try {
      results.push(await inspectFile(inputPath));
    } catch (error) {
      const message = error instanceof UnsupportedPdfError ? error.message : `${error.code ?? 'ERROR'}: ${error.message}`;
      errors.push({ file: inputPath, error: message });
    }
  }

  if (options.json) console.log(JSON.stringify({ schemaVersion: 1, results, errors }, null, 2));
  else {
    for (const result of results) {
      printHuman(result);
      console.log('');
    }
    for (const error of errors) console.error(`[ERROR] ${printable(error.file)} — ${printable(error.error)}`);
    console.log(`Explore the same PDF in the browser: ${ONLINE_PDF_METADATA_VIEWER_URL}`);
  }
  if (errors.length > 0) process.exitCode = 2;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
