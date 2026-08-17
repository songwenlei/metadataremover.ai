#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_CLEANER_URL,
  UnsupportedImageError,
  inspectImage,
} from '../src/inspector.js';

const VERSION = '0.6.0';

const HELP = `Image Metadata Privacy Checker

Inspect JPEG, PNG, and WebP files locally for privacy-sensitive metadata.
Files are never uploaded or modified.

Usage:
  metadata-check [options] <image...>

Options:
  --json               Print machine-readable JSON
  --fail-on-findings   Exit with code 1 when metadata findings are detected
  -h, --help           Show this help
  -v, --version        Show the version

Examples:
  metadata-check vacation.jpg
  metadata-check --json image.png
  metadata-check --fail-on-findings public/*.webp

Online cleaner:
  ${ONLINE_CLEANER_URL}
`;

function parseArguments(argv) {
  const options = {
    json: false,
    failOnFindings: false,
    files: [],
  };

  for (const argument of argv) {
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--fail-on-findings') {
      options.failOnFindings = true;
    } else if (argument === '-h' || argument === '--help') {
      options.help = true;
    } else if (argument === '-v' || argument === '--version') {
      options.version = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      options.files.push(argument);
    }
  }

  return options;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printablePath(filePath) {
  return filePath.replace(/[\u0000-\u001f\u007f]/g, '?');
}

function printHumanResult(result) {
  const risk = result.risk.toUpperCase();
  console.log(`[${risk}] ${printablePath(result.file)}`);
  console.log(`  Format: ${result.format} | Size: ${formatBytes(result.size)}`);

  if (result.findings.length === 0) {
    console.log('  No supported privacy-sensitive metadata was detected.');
  } else {
    for (const finding of result.findings) {
      const detail = finding.details.length > 0
        ? ` — ${finding.details.join('; ')}`
        : '';
      console.log(`  - ${finding.label} (${finding.risk})${detail}`);
    }
  }

  if (result.informational.length > 0) {
    console.log(`  Informational: ${result.informational.join(', ')}`);
  }
}

async function inspectFile(inputPath) {
  const absolutePath = resolve(inputPath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error('Path is not a file');
  }

  const buffer = await readFile(absolutePath);
  return {
    file: inputPath,
    ...inspectImage(buffer),
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run metadata-check --help for usage.');
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
    console.error('Run metadata-check --help for usage.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  const errors = [];

  for (const filePath of options.files) {
    try {
      results.push(await inspectFile(filePath));
    } catch (error) {
      const message = error instanceof UnsupportedImageError
        ? error.message
        : `${error.code ?? 'ERROR'}: ${error.message}`;
      errors.push({ file: filePath, error: message });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ results, errors }, null, 2));
  } else {
    for (const result of results) {
      printHumanResult(result);
      console.log('');
    }

    for (const error of errors) {
      console.error(`[ERROR] ${printablePath(error.file)} — ${error.error}`);
    }

    console.log(`Clean detected metadata online: ${ONLINE_CLEANER_URL}`);
  }

  if (errors.length > 0) {
    process.exitCode = 2;
  } else if (
    options.failOnFindings
    && results.some((result) => result.findings.length > 0)
  ) {
    process.exitCode = 1;
  }
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
