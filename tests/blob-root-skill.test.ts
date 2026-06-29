import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetRepoTreeAuthState, tryBlobInstall } from '../src/blob.ts';

const ROOT_SKILL_MD = `---
name: eve
description: Build durable backend AI agents with the eve framework.
---
# eve
`;

const ROOT_SKILL_WITH_FILES_MD = `---
name: packaged-root
description: Root skill with explicit payload.
files:
  - SKILL.md
  - scripts/
  - templates/*.md
  - config.example.json
  - "!scripts/dev-only.js"
---
# Packaged Root
`;

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('tryBlobInstall root-level skills', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetRepoTreeAuthState();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not install the full repository snapshot for a root SKILL.md', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          sha: 'root-tree-sha',
          tree: [
            { path: 'SKILL.md', type: 'blob', sha: 'skill-sha' },
            { path: 'packages/eve/src/index.ts', type: 'blob', sha: 'package-sha' },
            { path: 'docs/introduction.mdx', type: 'blob', sha: 'docs-sha' },
          ],
        })
      )
      .mockResolvedValueOnce(textResponse(ROOT_SKILL_MD))
      .mockResolvedValueOnce(
        okResponse({
          hash: 'full-repo-hash',
          files: [
            { path: 'SKILL.md', contents: ROOT_SKILL_MD },
            { path: 'packages/eve/src/index.ts', contents: 'export {}' },
            { path: 'docs/introduction.mdx', contents: '# Intro' },
          ],
        })
      );

    const result = await tryBlobInstall('vercel/eve');

    expect(result).not.toBeNull();
    expect(result!.skills).toHaveLength(1);
    expect(result!.skills[0]!.files).toEqual([{ path: 'SKILL.md', contents: ROOT_SKILL_MD }]);
    expect(result!.skills[0]!.snapshotHash).not.toBe('full-repo-hash');
  });

  it('keeps explicit root skill payload files from files frontmatter', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          sha: 'root-tree-sha',
          tree: [
            { path: 'SKILL.md', type: 'blob', sha: 'skill-sha' },
            { path: 'scripts/run.js', type: 'blob', sha: 'script-sha' },
            { path: 'scripts/dev-only.js', type: 'blob', sha: 'dev-sha' },
            { path: 'templates/card.md', type: 'blob', sha: 'template-sha' },
            { path: 'templates/card.txt', type: 'blob', sha: 'template-txt-sha' },
            { path: 'config.example.json', type: 'blob', sha: 'config-sha' },
            { path: 'packages/app/src/index.ts', type: 'blob', sha: 'package-sha' },
          ],
        })
      )
      .mockResolvedValueOnce(textResponse(ROOT_SKILL_WITH_FILES_MD))
      .mockResolvedValueOnce(
        okResponse({
          hash: 'full-repo-hash',
          files: [
            { path: 'SKILL.md', contents: ROOT_SKILL_WITH_FILES_MD },
            { path: 'scripts/run.js', contents: 'run' },
            { path: 'scripts/dev-only.js', contents: 'dev' },
            { path: 'templates/card.md', contents: '# Card' },
            { path: 'templates/card.txt', contents: 'Card' },
            { path: 'config.example.json', contents: '{}' },
            { path: 'packages/app/src/index.ts', contents: 'export {}' },
          ],
        })
      );

    const result = await tryBlobInstall('vercel/packaged-root');

    expect(result).not.toBeNull();
    expect(result!.skills[0]!.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/run.js',
      'templates/card.md',
      'config.example.json',
    ]);
    expect(result!.skills[0]!.snapshotHash).not.toBe('full-repo-hash');
  });

  it('keeps supporting files for nested skill snapshots', async () => {
    const nestedSkillMd = `---
name: nested
description: Nested skill.
---
# Nested
`;

    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          sha: 'root-tree-sha',
          tree: [
            { path: 'skills/nested/SKILL.md', type: 'blob', sha: 'skill-sha' },
            { path: 'skills/nested/reference.md', type: 'blob', sha: 'reference-sha' },
          ],
        })
      )
      .mockResolvedValueOnce(textResponse(nestedSkillMd))
      .mockResolvedValueOnce(
        okResponse({
          hash: 'nested-snapshot-hash',
          files: [
            { path: 'SKILL.md', contents: nestedSkillMd },
            { path: 'reference.md', contents: '# Reference' },
          ],
        })
      );

    const result = await tryBlobInstall('vercel-labs/agent-skills');

    expect(result).not.toBeNull();
    expect(result!.skills[0]!.files.map((file) => file.path)).toEqual(['SKILL.md', 'reference.md']);
    expect(result!.skills[0]!.snapshotHash).toBe('nested-snapshot-hash');
  });
});
