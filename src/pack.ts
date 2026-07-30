import { createHash } from 'node:crypto';
import type { BlobSkill } from './blob.ts';
import { sanitizeMetadata } from './sanitize.ts';

const PACK_BASE_URL = process.env.SKILLS_DOWNLOAD_URL || 'https://skills.sh';

const FETCH_TIMEOUT = 10_000;

export interface PackSnapshotFile {
  path: string;
  contents: string;
}

export interface PackSnapshotSkill {
  name: string;
  description: string;
  files: PackSnapshotFile[];
}

export interface PackSnapshot {
  id: string;
  createdAt: string;
  updatedAt?: string;
  revision?: string;
  name?: string;
  description?: string;
  sourceType: 'folder' | 'zip' | 'github';
  sourceLabel: string;
  skills: PackSnapshotSkill[];
}

const PACK_PATH_PATTERN = /^\/p\/([A-Za-z0-9_-]+)\/?$/;

export function parsePackId(source: string): string | null {
  const trimmed = source.trim();

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.hostname !== 'skills.sh' && url.hostname !== 'www.skills.sh') {
    return null;
  }

  const match = url.pathname.match(PACK_PATH_PATTERN);
  if (!match) {
    return null;
  }

  return match[1]!;
}

export function isPackSource(source: string): boolean {
  return parsePackId(source) !== null;
}

export class PackNotFoundError extends Error {
  constructor(public packId: string) {
    super(`Pack not found or expired/revoked: ${packId}`);
    this.name = 'PackNotFoundError';
  }
}

export async function fetchPackSnapshot(packId: string): Promise<PackSnapshot | null> {
  const url = `${PACK_BASE_URL}/api/p/${encodeURIComponent(packId)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'skills-cli' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch pack (${response.status})`);
  }

  return (await response.json()) as PackSnapshot;
}

function computeSnapshotHash(files: PackSnapshotFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update(file.contents);
  }
  return hash.digest('hex');
}

export function packSnapshotToBlobSkills(snapshot: PackSnapshot): BlobSkill[] {
  return snapshot.skills.map((skill) => {
    const skillMdFile = skill.files.find((file) => file.path.toLowerCase() === 'skill.md');
    const rawContent = skillMdFile?.contents ?? '';

    return {
      name: sanitizeMetadata(skill.name),
      description: sanitizeMetadata(skill.description),
      path: '',
      rawContent,
      files: skill.files,
      snapshotHash: computeSnapshotHash(skill.files),
      repoPath: skillMdFile ? skillMdFile.path : 'SKILL.md',
    };
  });
}

export async function revokePack(packId: string, token: string): Promise<{ success: boolean }> {
  const url = `${PACK_BASE_URL}/p/${encodeURIComponent(packId)}/revoke`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'skills-cli' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (response.status === 404) {
    return { success: false };
  }

  if (!response.ok) {
    throw new Error(`Failed to revoke pack (${response.status})`);
  }

  return { success: true };
}
