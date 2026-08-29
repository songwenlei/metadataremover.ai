#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_VIDEO_METADATA_VIEWER_URL,
  viewVideoMetadata,
} from '../src/video-metadata.js';

const VERSION = '0.8.0';
const HELP = `Video Metadata Viewer

Inspect supported MP4, MOV, and WebM container metadata locally without changing the file.

Usage:
  video-metadata-view [options] <video...>

Options:
  --json            Print stable machine-readable JSON
  -h, --help        Show this help
  -v, --version     Show the version

Online video metadata viewer:
  ${ONLINE_VIDEO_METADATA_VIEWER_URL}
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
  console.log(`${printable(result.file)} — ${result.format}, ${result.size} bytes${result.brand ? `, brand ${result.brand}` : ''}`);
  if (!result.fields.length) console.log('  No supported readable video metadata fields were found.');
  for (const field of result.fields) console.log(`  - [${field.privacy}] ${field.name} = ${printable(field.value)}${field.truncated ? ' [truncated]' : ''}`);
  for (const container of result.containers) console.log(`  - [${container.privacy}] ${container.type} container — ${container.size} bytes`);
  for (const warning of result.warnings) console.log(`  Warning: ${printable(warning)}`);
}

async function inspectFile(inputPath) {
  const absolute = resolve(inputPath);
  const fileStat = await stat(absolute);
  if (!fileStat.isFile()) throw new Error('Path is not a file');
  return { file: inputPath, ...viewVideoMetadata(await readFile(absolute)) };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run video-metadata-view --help for usage.');
    process.exitCode = 2;
    return;
  }
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(VERSION);
  if (!options.files.length) {
    console.error('No video file provided.');
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
    console.log(`Explore the full normalized report in the browser: ${ONLINE_VIDEO_METADATA_VIEWER_URL}`);
  }
  if (errors.length) process.exitCode = 2;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
