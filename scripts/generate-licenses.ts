#!/usr/bin/env node
/**
 * Generates ThirdPartyNoticeText.txt for bundled dependencies.
 * Run during build to ensure license compliance.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { pathToFileURL } from 'url';

// Dependencies that get bundled into the CLI
export const BUNDLED_PACKAGES = [
  '@clack/prompts',
  '@clack/core',
  'picocolors',
  'gray-matter',
  'simple-git',
  'xdg-basedir',
  'sisteransi',
];

interface LicenseInfo {
  licenses: string;
  repository?: string;
  publisher?: string;
  licenseFile?: string;
  path?: string;
}

export function getLicenseText(pkgPath: string): string {
  const possibleFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'];
  for (const file of possibleFiles) {
    const filePath = join(pkgPath, file);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
  }
  return '';
}

export function resolveInstalledPackagePath(pkgName: string): string | null {
  const directPath = join(process.cwd(), 'node_modules', pkgName);
  if (existsSync(directPath)) {
    return directPath;
  }

  const pnpmRoot = join(process.cwd(), 'node_modules', '.pnpm');
  if (!existsSync(pnpmRoot)) {
    return null;
  }

  for (const entry of readdirSync(pnpmRoot)) {
    const candidatePath = join(pnpmRoot, entry, 'node_modules', pkgName);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

export function resolveLicenseText(info: LicenseInfo, pkgName: string): string {
  const licenseFileName = info.licenseFile ? basename(info.licenseFile).toLowerCase() : '';
  const looksLikeLicenseFile =
    licenseFileName === 'license' ||
    licenseFileName.startsWith('license.') ||
    licenseFileName === 'copying' ||
    licenseFileName.startsWith('copying.');

  if (info.licenseFile && looksLikeLicenseFile && existsSync(info.licenseFile)) {
    return readFileSync(info.licenseFile, 'utf-8').trim();
  }

  const pkgPath = info.path ?? resolveInstalledPackagePath(pkgName);
  return pkgPath ? getLicenseText(pkgPath) : '';
}

export function buildThirdPartyNotice(allLicenses: Record<string, LicenseInfo>) {
  const lines: string[] = [
    '/*!----------------- Skills CLI ThirdPartyNotices -------------------------------------------------------',
    '',
    'The Skills CLI incorporates third party material from the projects listed below.',
    'The original copyright notice and the license under which this material was received',
    'are set forth below. These licenses and notices are provided for informational purposes only.',
    '',
    '---------------------------------------------',
    'Third Party Code Components',
    '--------------------------------------------',
    '',
  ];

  const bundledEntries = new Map<string, { pkgNameVersion: string; info: LicenseInfo }>();

  for (const [pkgNameVersion, info] of Object.entries(allLicenses)) {
    const pkgName = pkgNameVersion.replace(/@[\d.]+(-.*)?$/, '').replace(/^(.+)@.*$/, '$1');
    if (
      !BUNDLED_PACKAGES.some(
        (bundled) => pkgName === bundled || pkgNameVersion.startsWith(bundled + '@')
      )
    )
      continue;

    if (!bundledEntries.has(pkgName)) {
      bundledEntries.set(pkgName, { pkgNameVersion, info });
    }
  }

  for (const pkgName of BUNDLED_PACKAGES) {
    let entry = bundledEntries.get(pkgName);
    if (!entry) {
      const pkgDir = resolveInstalledPackagePath(pkgName);
      const pkgJsonPath = pkgDir ? join(pkgDir, 'package.json') : '';
      if (!existsSync(pkgJsonPath)) {
        console.warn(`package metadata missing for ${pkgName}`);
        continue;
      }
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, any>;
      const licenseField =
        typeof pkgJson.license === 'string'
          ? pkgJson.license
          : pkgJson.license?.type ||
            pkgJson.license?.name ||
            (Array.isArray(pkgJson.licenses)
              ? pkgJson.licenses
                  .map((item) => (typeof item === 'string' ? item : item?.type || item?.name))
                  .filter(Boolean)
                  .join(', ')
              : undefined);
      const info: LicenseInfo = {
        licenses: licenseField || 'UNKNOWN',
        repository:
          typeof pkgJson.repository === 'string' ? pkgJson.repository : pkgJson.repository?.url,
        publisher: typeof pkgJson.author === 'string' ? pkgJson.author : pkgJson.author?.name,
        path: pkgDir,
      };
      entry = {
        pkgNameVersion: `${pkgName}@${pkgJson.version ?? 'unknown'}`,
        info,
      };
      bundledEntries.set(pkgName, entry);
    }

    const licenseText = resolveLicenseText(entry.info, pkgName);

    lines.push('='.repeat(80));
    lines.push(`Package: ${entry.pkgNameVersion}`);
    lines.push(`License: ${entry.info.licenses}`);
    if (entry.info.repository) {
      lines.push(`Repository: ${entry.info.repository}`);
    }
    lines.push('-'.repeat(80));
    lines.push('');
    if (licenseText) {
      lines.push(licenseText);
    } else {
      // Fallback to generic MIT/ISC text
      if (entry.info.licenses === 'MIT') {
        lines.push('MIT License');
        lines.push('');
        lines.push('Permission is hereby granted, free of charge, to any person obtaining a copy');
        lines.push('of this software and associated documentation files (the "Software"), to deal');
        lines.push('in the Software without restriction, including without limitation the rights');
        lines.push('to use, copy, modify, merge, publish, distribute, sublicense, and/or sell');
        lines.push('copies of the Software, and to permit persons to whom the Software is');
        lines.push('furnished to do so, subject to the following conditions:');
        lines.push('');
        lines.push(
          'The above copyright notice and this permission notice shall be included in all'
        );
        lines.push('copies or substantial portions of the Software.');
        lines.push('');
        lines.push('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR');
        lines.push('IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,');
        lines.push('FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE');
        lines.push('AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER');
        lines.push('LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,');
        lines.push('OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE');
        lines.push('SOFTWARE.');
      } else if (entry.info.licenses === 'ISC') {
        lines.push('ISC License');
        lines.push('');
        lines.push('Permission to use, copy, modify, and/or distribute this software for any');
        lines.push('purpose with or without fee is hereby granted, provided that the above');
        lines.push('copyright notice and this permission notice appear in all copies.');
        lines.push('');
        lines.push('THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES');
        lines.push('WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF');
        lines.push('MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR');
        lines.push('ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES');
        lines.push('WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN');
        lines.push('ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF');
        lines.push('OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.');
      }
    }
    lines.push('');
    lines.push('');
  }

  lines.push('='.repeat(80));
  lines.push('*/');

  return lines.join('\n');
}

function main() {
  console.log('Generating ThirdPartyNoticeText.txt...');

  // Get license info from license-checker
  const output = execSync('npx license-checker --json', { encoding: 'utf-8' });
  const allLicenses: Record<string, LicenseInfo> = JSON.parse(output);
  const content = buildThirdPartyNotice(allLicenses);
  writeFileSync('ThirdPartyNoticeText.txt', content);
  console.log('Generated ThirdPartyNoticeText.txt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
