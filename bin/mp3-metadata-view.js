#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_MP3_METADATA_VIEWER_URL,
  viewMp3Metadata,
} from '../src/mp3-metadata.js';

const VERSION = '0.7.0';
const HELP = `MP3 Metadata Viewer

Inspect supported ID3v2.3, ID3v2.4, ID3v1, APEv2, and Lyrics3v2 tags locally.
The file is accepted by consecutive MPEG Layer III frame headers, not its extension.

Usage:
  mp3-metadata-view [options] <mp3...>

Options:
  --json            Print stable machine-readable JSON
  -h, --help        Show this help
  -v, --version     Show the version

Online MP3 metadata viewer:
  ${ONLINE_MP3_METADATA_VIEWER_URL}
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
  const safe = String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
  return safe.length > maximum ? `${safe.slice(0, maximum)}…` : safe;
}

function printHuman(result) {
  console.log(`${printable(result.file)} — ${result.format}, ${result.size} bytes`);
  console.log(`  MPEG: ${result.mpeg.version} ${result.mpeg.layer}, ${result.mpeg.sampleRateHz} Hz, ${result.mpeg.channelMode}`);
  if (!result.tags.length) console.log('  No supported MP3 metadata tags were found.');
  for (const tag of result.tags) console.log(`  - ${tag.label}: ${tag.byteLength} bytes, ${tag.fieldCount} readable field(s)`);
  for (const field of result.fields) console.log(`  - [${field.privacy}] ${field.name} (${field.source}) = ${printable(field.value)}${field.truncated ? ' [truncated]' : ''}`);
  for (const warning of result.warnings) console.log(`  Warning: ${printable(warning)}`);
}

async function inspectFile(inputPath) {
  const absolute = resolve(inputPath);
  const fileStat = await stat(absolute);
  if (!fileStat.isFile()) throw new Error('Path is not a file');
  return { file: inputPath, ...viewMp3Metadata(await readFile(absolute)) };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run mp3-metadata-view --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (!options.files.length) {
    console.error('No MP3 file provided.');
    process.exitCode = 2;
    return;
  }
  const results = [];
  const errors = [];
  for (const file of options.files) {
    try {
      results.push(await inspectFile(file));
    } catch (error) {
      errors.push({ file, error: `${error.code ?? error.name ?? 'ERROR'}: ${error.message}` });
    }
  }
  if (options.json) console.log(JSON.stringify({ schemaVersion: 1, results, errors }, null, 2));
  else {
    for (const result of results) {
      printHuman(result);
      console.log('');
    }
    for (const error of errors) console.error(`[ERROR] ${printable(error.file)} — ${printable(error.error)}`);
    console.log(`Explore the same MP3 in the browser: ${ONLINE_MP3_METADATA_VIEWER_URL}`);
  }
  if (errors.length) process.exitCode = 2;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
