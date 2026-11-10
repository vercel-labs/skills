import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadSource } from '../src/download-source.ts';
import { discoverSkills } from '../src/skills.ts';
import { createZip } from './fixtures/zip.ts';

function mockFetchFile(filePath: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const bytes = readFileSync(filePath);
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.length) },
      });
    })
  );
}

describe('downloadSource', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-download-source-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('accepts a direct SKILL.md download', async () => {
    const skillFile = join(testDir, 'download');
    writeFileSync(
      skillFile,
      `---
name: direct-url-skill
description: A skill served as a bare markdown download
---

# Direct URL Skill
`
    );
    mockFetchFile(skillFile);

    const downloaded = await downloadSource('https://internal.example.com/download');
    const skills = await discoverSkills(downloaded.rootDir);

    expect(downloaded.kind).toBe('skill-md');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('direct-url-skill');

    rmSync(downloaded.tempDir, { recursive: true, force: true });
  });

  it.each([
    ['tar', false],
    ['tgz', true],
  ])('accepts a %s archive download without relying on the URL extension', async (_label, gzip) => {
    const archiveRoot = join(testDir, 'archive-root');
    const skillDir = join(archiveRoot, 'repo-main', 'skills', 'archive-url-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: archive-url-skill
description: A skill served from an archive
---

# Archive URL Skill
`
    );

    const archivePath = join(testDir, `payload.${gzip ? 'tgz' : 'tar'}`);
    await tar.c({ cwd: archiveRoot, gzip, file: archivePath }, ['repo-main']);
    mockFetchFile(archivePath);

    const downloaded = await downloadSource('https://internal.example.com/download');
    const skills = await discoverSkills(downloaded.rootDir);

    expect(downloaded.kind).toBe('archive');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('archive-url-skill');

    rmSync(downloaded.tempDir, { recursive: true, force: true });
  });

  it('accepts an explicit provider download size limit without changing the default', async () => {
    const archiveRoot = join(testDir, 'large-archive-root');
    const skillDir = join(archiveRoot, 'repo-main', 'skills', 'large-url-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: large-url-skill\ndescription: A skill in a large provider bundle\n---\n'
    );

    const archivePath = join(testDir, 'large-payload.tgz');
    await tar.c({ cwd: archiveRoot, gzip: true, file: archivePath }, ['repo-main']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const bytes = readFileSync(archivePath);
        return new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(11 * 1024 * 1024) },
        });
      })
    );

    const downloaded = await downloadSource('https://internal.example.com/download', {
      downloadMaxBytes: 12 * 1024 * 1024,
    });
    const skills = await discoverSkills(downloaded.rootDir);

    expect(skills.map((skill) => skill.name)).toEqual(['large-url-skill']);
    rmSync(downloaded.tempDir, { recursive: true, force: true });
  });

  it('accepts a zip archive download without relying on the URL extension', async () => {
    const zipPath = join(testDir, 'payload.zip');
    writeFileSync(
      zipPath,
      createZip([
        {
          path: 'repo-main/skills/zip-url-skill/SKILL.md',
          contents: `---
name: zip-url-skill
description: A skill served from a zip archive
---

# Zip URL Skill
`,
        },
      ])
    );
    mockFetchFile(zipPath);

    const downloaded = await downloadSource('https://internal.example.com/download');
    const skills = await discoverSkills(downloaded.rootDir);

    expect(downloaded.kind).toBe('archive');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('zip-url-skill');

    rmSync(downloaded.tempDir, { recursive: true, force: true });
  });

  it('reports unsafe archive paths instead of treating the archive as unsupported', async () => {
    const zipPath = join(testDir, 'unsafe.zip');
    writeFileSync(
      zipPath,
      createZip([
        {
          path: '../SKILL.md',
          contents: `---
name: unsafe-skill
description: Unsafe archive path
---
`,
        },
      ])
    );
    mockFetchFile(zipPath);

    await expect(downloadSource('https://internal.example.com/download')).rejects.toThrow(
      'Archive contains unsafe path'
    );
  });

  it('reports archive file count limit errors instead of treating the archive as unsupported', async () => {
    const zipPath = join(testDir, 'too-many-files.zip');
    writeFileSync(
      zipPath,
      createZip([
        {
          path: 'repo-main/skills/limited/SKILL.md',
          contents: '---\nname: limited\ndescription: Limited\n---\n',
        },
        { path: 'repo-main/skills/limited/extra.txt', contents: 'extra' },
      ])
    );
    mockFetchFile(zipPath);
    vi.stubEnv('SKILLS_EXTRACT_MAX_FILES', '1');

    await expect(downloadSource('https://internal.example.com/download')).rejects.toThrow(
      'Archive contains too many files'
    );
  });

  it('counts tar directory entries toward the archive entry limit', async () => {
    const archiveRoot = join(testDir, 'directory-limit');
    const skillDir = join(archiveRoot, 'repo-main', 'skills', 'limited');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: limited\ndescription: Limited\n---\n');

    const archivePath = join(testDir, 'directory-limit.tgz');
    await tar.c({ cwd: archiveRoot, gzip: true, file: archivePath }, ['repo-main']);
    mockFetchFile(archivePath);
    vi.stubEnv('SKILLS_EXTRACT_MAX_FILES', '1');

    let downloadedTempDir: string | undefined;
    try {
      const downloaded = await downloadSource('https://internal.example.com/download');
      downloadedTempDir = downloaded.tempDir;
      expect.fail('expected archive entry limit error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Archive contains too many files');
    } finally {
      if (downloadedTempDir) {
        rmSync(downloadedTempDir, { recursive: true, force: true });
      }
    }
  });
});
