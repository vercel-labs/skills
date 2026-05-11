#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname, join, relative } from 'path';

const rootDir = join(import.meta.dirname, '..');
const outfile = join(rootDir, 'dist', process.platform === 'win32' ? 'agentart.exe' : 'agentart');

mkdirSync(dirname(outfile), { recursive: true });

const result = spawnSync(
  process.execPath,
  ['build', '--compile', '--bytecode', '--sourcemap', './src/cli.ts', `--outfile=${outfile}`],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Built ${relative(rootDir, outfile)}`);
