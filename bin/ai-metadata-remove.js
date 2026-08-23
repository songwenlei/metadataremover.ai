#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import process from 'node:process';
import {
  ONLINE_AI_METADATA_REMOVER_URL,
  removeAiMetadata,
} from '../src/ai-metadata-remover.js';
import { UnsupportedImageError } from '../src/metadata-viewer.js';

const VERSION = '0.7.0';

const HELP = `AI Metadata Remover

Remove recognized AI-generation PNG text and XMP containers from a new
JPEG, PNG, or WebP copy. Processing is local and the result is verified.

Usage:
  ai-metadata-remove [options] <image>

Options:
  -o, --output <path>   Set the output path
  --force               Replace an existing output file
  --json                Print stable machine-readable JSON
  -h, --help            Show this help
  -v, --version         Show the version

By default the output is <name>.no-ai-metadata.<ext>. The input is never
overwritten. Separate EXIF, IPTC, generic text, C2PA, and ICC data is kept.

Examples:
  ai-metadata-remove generated.png
  ai-metadata-remove --output share.webp generated.webp
  ai-metadata-remove --json generated.jpg

Online AI metadata remover:
  ${ONLINE_AI_METADATA_REMOVER_URL}
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
  return join(parsed.dir, `${parsed.name}.no-ai-metadata${parsed.ext}`);
}

function printable(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Run ai-metadata-remove --help for usage.');
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
  if (options.files.length !== 1) {
    console.error('Provide exactly one image file.');
    console.error('Run ai-metadata-remove --help for usage.');
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
    const { buffer, report } = removeAiMetadata(await readFile(absoluteInput));
    await writeFile(absoluteOutput, buffer, { flag: options.force ? 'w' : 'wx' });
    const result = { input: inputPath, output: outputPath, ...report };

    if (options.json) {
      console.log(JSON.stringify({ schemaVersion: 1, result }, null, 2));
    } else {
      const action = report.containersRemoved === 0
        ? 'No recognized AI metadata container was present; wrote a verified copy.'
        : `Removed ${report.containersRemoved} recognized AI metadata container${report.containersRemoved === 1 ? '' : 's'} and verified the result.`;
      console.log(action);
      console.log(`${printable(inputPath)} -> ${printable(outputPath)}`);
      console.log(`${report.format}: ${report.inputBytes} bytes -> ${report.outputBytes} bytes`);
      for (const warning of report.warnings) console.log(`Warning: ${printable(warning)}`);
      console.log(`Need an interactive review or broader cleanup? ${ONLINE_AI_METADATA_REMOVER_URL}`);
    }
  } catch (error) {
    const message = error instanceof UnsupportedImageError
      ? error.message
      : `${error.code ?? 'ERROR'}: ${error.message}`;
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
