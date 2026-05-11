#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, relative } from 'path';

const rootDir = join(import.meta.dirname, '..');
const outDir = join(rootDir, 'dist', 'release');

const targets = [
  { target: 'bun-darwin-arm64', outfile: 'agentart-darwin-arm64' },
  { target: 'bun-darwin-x64', outfile: 'agentart-darwin-x64' },
  { target: 'bun-linux-arm64', outfile: 'agentart-linux-arm64' },
  { target: 'bun-linux-x64', outfile: 'agentart-linux-x64' },
  { target: 'bun-linux-arm64-musl', outfile: 'agentart-linux-arm64-musl' },
  { target: 'bun-linux-x64-musl', outfile: 'agentart-linux-x64-musl' },
  { target: 'bun-windows-arm64', outfile: 'agentart-windows-arm64.exe' },
  { target: 'bun-windows-x64', outfile: 'agentart-windows-x64.exe' },
];

mkdirSync(outDir, { recursive: true });

for (const { target, outfile } of targets) {
  const outputPath = join(outDir, outfile);
  console.log(`Building ${target} -> ${relative(rootDir, outputPath)}`);

  const result = spawnSync(
    process.execPath,
    [
      'build',
      '--compile',
      '--bytecode',
      '--sourcemap',
      `--target=${target}`,
      './src/cli.ts',
      `--outfile=${outputPath}`,
    ],
    {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
