#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_METADATA_VIEWER_URL,
  UnsupportedImageError,
  viewMetadata,
} from '../src/metadata-viewer.js';

const VERSION = '0.2.0';

const HELP = `Image Metadata Viewer

Read supported EXIF, GPS, PNG text, XMP, IPTC container, ICC, and
provenance-marker data locally. Files are never uploaded or modified.

Usage:
  metadata-view [options] <image...>

Options:
  --json            Print stable machine-readable JSON
  --csv             Print spreadsheet-ready CSV
  --privacy-only    Show only medium- and high-review records
  -h, --help        Show this help
  -v, --version     Show the version

Examples:
  metadata-view photo.jpg
  metadata-view --privacy-only photo.jpg
  metadata-view --json generated.png
  metadata-view --csv *.webp > metadata.csv

Online metadata viewer:
  ${ONLINE_METADATA_VIEWER_URL}
`;

function parseArguments(argv) {
  const options = { format: 'human', privacyOnly: false, files: [] };
  for (const argument of argv) {
    if (argument === '--json') {
      if (options.format !== 'human') throw new Error('--json and --csv cannot be combined.');
      options.format = 'json';
    } else if (argument === '--csv') {
      if (options.format !== 'human') throw new Error('--json and --csv cannot be combined.');
      options.format = 'csv';
    } else if (argument === '--privacy-only') options.privacyOnly = true;
    else if (argument === '-h' || argument === '--help') options.help = true;
    else if (argument === '-v' || argument === '--version') options.version = true;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function printable(value, maxLength = 500) {
  const safe = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '?')
    .replace(/\r?\n/g, '\\n');
  return safe.length > maxLength ? `${safe.slice(0, maxLength)}…` : safe;
}

function filterReport(report, privacyOnly) {
  if (!privacyOnly) return report;
  return {
    ...report,
    fields: report.fields.filter((field) => field.privacy !== 'info'),
    containers: report.containers.filter((container) => container.privacy !== 'info'),
  };
}

async function inspectFile(inputPath, privacyOnly) {
  const absolutePath = resolve(inputPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error('Path is not a file');
  const report = filterReport(viewMetadata(await readFile(absolutePath)), privacyOnly);
  return { file: inputPath, ...report };
}

function printHuman(result) {
  console.log(`${printable(result.file)} — ${result.format}, ${result.size} bytes`);
  if (result.fields.length === 0 && result.containers.length === 0) {
    console.log('  No supported metadata records were found.');
  }
  if (result.fields.length > 0) {
    console.log('  Fields:');
    for (const field of result.fields) {
      console.log(`  - [${field.privacy}] ${field.group}.${field.name} = ${printable(field.value)} (${printable(field.source)})${field.truncated ? ' [truncated]' : ''}`);
    }
  }
  if (result.containers.length > 0) {
    console.log('  Containers:');
    for (const container of result.containers) {
      console.log(`  - [${container.privacy}] ${container.type} — ${printable(container.source)}, ${container.length} bytes`);
    }
  }
  for (const warning of result.warnings) console.log(`  Warning: ${printable(warning)}`);
}

function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(results, errors) {
  const rows = [[
    'file', 'format', 'record_type', 'group', 'name', 'value', 'source',
    'privacy', 'length', 'truncated', 'error',
  ]];
  for (const result of results) {
    for (const field of result.fields) {
      rows.push([
        result.file, result.format, 'field', field.group, field.name, field.value,
        field.source, field.privacy, '', field.truncated ? 'true' : 'false', '',
      ]);
    }
    for (const container of result.containers) {
      rows.push([
        result.file, result.format, 'container', container.type, '', '',
        container.source, container.privacy, container.length, 'false', '',
      ]);
    }
  }
  for (const error of errors) rows.push([error.file, '', 'error', '', '', '', '', '', '', '', error.error]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run metadata-view --help for usage.');
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(VERSION);
    return;
  }
  if (options.files.length === 0) {
    console.error('No image file provided.');
    console.error('Run metadata-view --help for usage.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  const errors = [];
  for (const filePath of options.files) {
    try {
      results.push(await inspectFile(filePath, options.privacyOnly));
    } catch (error) {
      const message = error instanceof UnsupportedImageError
        ? error.message
        : `${error.code ?? 'ERROR'}: ${error.message}`;
      errors.push({ file: filePath, error: message });
    }
  }

  if (options.format === 'json') {
    console.log(JSON.stringify({ schemaVersion: 1, results, errors }, null, 2));
  } else if (options.format === 'csv') {
    console.log(toCsv(results, errors));
  } else {
    for (const result of results) {
      printHuman(result);
      console.log('');
    }
    for (const error of errors) console.error(`[ERROR] ${printable(error.file)} — ${printable(error.error)}`);
    console.log(`Explore the same file in the browser: ${ONLINE_METADATA_VIEWER_URL}`);
  }

  if (errors.length > 0) process.exitCode = 2;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
