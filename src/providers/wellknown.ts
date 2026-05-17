import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { parseFrontmatter } from '../frontmatter.ts';
import { sanitizeMetadata } from '../sanitize.ts';
import type { HostProvider, ProviderMatch, RemoteSkill } from './types.ts';

const DISCOVERY_SCHEMA_V2 = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const MAX_ARCHIVE_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1000;

/**
 * Legacy index.json structure for well-known skills.
 * This is the pre-0.2.0 format used by existing publishers.
 */
export interface WellKnownIndexV1 {
  skills: WellKnownSkillEntryV1[];
}

/**
 * Represents a legacy skill entry in index.json.
 */
export interface WellKnownSkillEntryV1 {
  /** Skill identifier. Must match the directory name. */
  name: string;
  /** Brief description of what the skill does. */
  description: string;
  /** Array of all files in the skill directory. */
  files: string[];
}

/**
 * Current v0.2.0 well-known discovery index.
 */
export interface WellKnownIndexV2 {
  $schema: typeof DISCOVERY_SCHEMA_V2;
  skills: WellKnownSkillEntryV2[];
}

/**
 * Represents a v0.2.0 skill artifact entry in index.json.
 */
export interface WellKnownSkillEntryV2 {
  name: string;
  type: 'skill-md' | 'archive';
  description: string;
  url: string;
  digest: string;
}

export type WellKnownIndex = WellKnownIndexV1 | WellKnownIndexV2;
export type WellKnownSkillEntry = WellKnownSkillEntryV1 | WellKnownSkillEntryV2;
export type WellKnownFileContent = string | Uint8Array;

type NormalizedWellKnownEntry =
  | {
      version: '0.1.0';
      name: string;
      description: string;
      files: string[];
      baseUrl: string;
      wellKnownPath: string;
      indexEntry: WellKnownSkillEntryV1;
    }
  | {
      version: '0.2.0';
      name: string;
      description: string;
      type: 'skill-md' | 'archive';
      artifactUrl: string;
      digest: string;
      indexEntry: WellKnownSkillEntryV2;
    };

/**
 * Represents a skill with all installable files fetched from a well-known endpoint.
 */
export interface WellKnownSkill extends RemoteSkill {
  /** All files in the skill, keyed by relative path */
  files: Map<string, WellKnownFileContent>;
  /** The entry from index.json */
  indexEntry: WellKnownSkillEntry;
}

/**
 * Well-known skills provider using RFC 8615 well-known URIs.
 *
 * Supports both:
 * - v0.2.0: $schema + type/url/digest single-artifact model
 * - legacy/v0.1.0: name/description/files directory model
 *
 * Organizations can publish skills at:
 * https://example.com/.well-known/agent-skills/  (preferred)
 * https://example.com/.well-known/skills/         (legacy fallback)
 *
 * The provider first checks /.well-known/agent-skills/index.json,
 * then falls back to /.well-known/skills/index.json. For compatibility with
 * existing publishers, it also preserves the historical path-relative probing
 * behavior for URLs such as https://example.com/docs.
 */
export class WellKnownProvider implements HostProvider {
  readonly id = 'well-known';
  readonly displayName = 'Well-Known Skills';

  private readonly WELL_KNOWN_PATHS = ['.well-known/agent-skills', '.well-known/skills'] as const;
  private readonly INDEX_FILE = 'index.json';

  /**
   * Check if a URL could be a well-known skills endpoint.
   * This is a fallback provider - it matches any HTTP(S) URL that is not
   * a recognized pattern (GitHub, GitLab, owner/repo shorthand, etc.)
   */
  match(url: string): ProviderMatch {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { matches: false };
    }

    try {
      const parsed = new URL(url);
      const excludedHosts = ['github.com', 'gitlab.com', 'huggingface.co'];
      if (excludedHosts.includes(parsed.hostname)) {
        return { matches: false };
      }

      return {
        matches: true,
        sourceIdentifier: `wellknown/${parsed.hostname}`,
      };
    } catch {
      return { matches: false };
    }
  }

  /**
   * Fetch the skills index from a well-known endpoint.
   * Tries /.well-known/agent-skills/index.json first, then falls back to
   * /.well-known/skills/index.json. For each path, tries path-relative
   * first, then root .well-known.
   */
  async fetchIndex(baseUrl: string): Promise<{
    index: WellKnownIndex;
    entries: NormalizedWellKnownEntry[];
    resolvedBaseUrl: string;
    resolvedWellKnownPath: string;
    indexUrl: string;
  } | null> {
    const candidates = await this.fetchIndexCandidates(baseUrl);
    return candidates[0] ?? null;
  }

  private async fetchIndexCandidates(baseUrl: string): Promise<
    Array<{
      index: WellKnownIndex;
      entries: NormalizedWellKnownEntry[];
      resolvedBaseUrl: string;
      resolvedWellKnownPath: string;
      indexUrl: string;
    }>
  > {
    try {
      const parsed = new URL(baseUrl);
      const basePath = parsed.pathname.replace(/\/$/, '');

      const urlsToTry: Array<{
        indexUrl: string;
        baseUrl: string;
        wellKnownPath: string;
      }> = [];

      for (const wellKnownPath of this.WELL_KNOWN_PATHS) {
        urlsToTry.push({
          indexUrl: `${parsed.protocol}//${parsed.host}${basePath}/${wellKnownPath}/${this.INDEX_FILE}`,
          baseUrl: `${parsed.protocol}//${parsed.host}${basePath}`,
          wellKnownPath,
        });

        if (basePath && basePath !== '') {
          urlsToTry.push({
            indexUrl: `${parsed.protocol}//${parsed.host}/${wellKnownPath}/${this.INDEX_FILE}`,
            baseUrl: `${parsed.protocol}//${parsed.host}`,
            wellKnownPath,
          });
        }
      }

      const candidates: Array<{
        index: WellKnownIndex;
        entries: NormalizedWellKnownEntry[];
        resolvedBaseUrl: string;
        resolvedWellKnownPath: string;
        indexUrl: string;
      }> = [];

      for (const { indexUrl, baseUrl: resolvedBase, wellKnownPath } of urlsToTry) {
        try {
          const response = await fetch(indexUrl);
          if (!response.ok) continue;

          const rawIndex = (await response.json()) as unknown;
          const normalized = this.normalizeIndex(rawIndex, indexUrl, wellKnownPath);
          if (!normalized) continue;

          candidates.push({
            index: normalized.index,
            entries: normalized.entries,
            resolvedBaseUrl: resolvedBase,
            resolvedWellKnownPath: wellKnownPath,
            indexUrl,
          });
        } catch {
          continue;
        }
      }

      return candidates;
    } catch {
      return [];
    }
  }

  private normalizeIndex(
    rawIndex: unknown,
    indexUrl: string,
    resolvedWellKnownPath: string
  ): { index: WellKnownIndex; entries: NormalizedWellKnownEntry[] } | null {
    if (!rawIndex || typeof rawIndex !== 'object') return null;

    const record = rawIndex as Record<string, unknown>;
    if (!Array.isArray(record.skills)) return null;

    const schema = record.$schema;

    if (schema === DISCOVERY_SCHEMA_V2) {
      const entries: NormalizedWellKnownEntry[] = [];
      const v2Entries: WellKnownSkillEntryV2[] = [];

      for (const entry of record.skills) {
        if (!this.isValidSkillEntryV2(entry)) continue;

        const artifactUrl = new URL(entry.url, indexUrl).toString();
        entries.push({
          version: '0.2.0',
          name: entry.name,
          description: entry.description,
          type: entry.type,
          artifactUrl,
          digest: entry.digest,
          indexEntry: entry,
        });
        v2Entries.push(entry);
      }

      if (entries.length === 0) return null;
      return { index: { $schema: DISCOVERY_SCHEMA_V2, skills: v2Entries }, entries };
    }

    // Per the v0.2.0 draft, an absent $schema means legacy/v0.1.0.
    // Unknown schemas are not processed because the shape may have changed incompatibly.
    if (schema !== undefined) return null;

    const v1Entries: WellKnownSkillEntryV1[] = [];
    const entries: NormalizedWellKnownEntry[] = [];

    // Preserve legacy all-or-nothing validation behavior for the old files[] format.
    for (const entry of record.skills) {
      if (!this.isValidSkillEntryV1(entry)) return null;
      v1Entries.push(entry);
      entries.push({
        version: '0.1.0',
        name: entry.name,
        description: entry.description,
        files: entry.files,
        baseUrl: this.getLegacySkillBaseUrl(indexUrl, resolvedWellKnownPath),
        wellKnownPath: resolvedWellKnownPath,
        indexEntry: entry,
      });
    }

    return { index: { skills: v1Entries }, entries };
  }

  private getLegacySkillBaseUrl(indexUrl: string, wellKnownPath: string): string {
    const parsed = new URL(indexUrl);
    const marker = `/${wellKnownPath}/${this.INDEX_FILE}`;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.slice(0, -marker.length)}`;
  }

  private isValidSkillName(name: unknown): name is string {
    if (typeof name !== 'string') return false;
    if (name.length < 1 || name.length > 64) return false;
    if (!/^[a-z0-9-]+$/.test(name)) return false;
    if (name.startsWith('-') || name.endsWith('-')) return false;
    if (name.includes('--')) return false;
    return true;
  }

  private isSafeLegacyFilePath(filePath: unknown): filePath is string {
    if (typeof filePath !== 'string' || filePath.length === 0) return false;
    // Preserve existing stricter legacy behavior: reject absolute paths, Windows absolute-ish
    // paths, and any occurrence of "..".
    if (filePath.startsWith('/') || filePath.startsWith('\\') || filePath.includes('..')) {
      return false;
    }
    if (filePath.includes('\0')) return false;
    return true;
  }

  /** Validate a legacy skill entry from the index. */
  private isValidSkillEntryV1(entry: unknown): entry is WellKnownSkillEntryV1 {
    if (!entry || typeof entry !== 'object') return false;

    const e = entry as Record<string, unknown>;
    if (!this.isValidSkillName(e.name)) return false;
    if (typeof e.description !== 'string' || !e.description) return false;
    if (!Array.isArray(e.files) || e.files.length === 0) return false;

    for (const file of e.files) {
      if (!this.isSafeLegacyFilePath(file)) return false;
    }

    const hasSkillMd = e.files.some((f) => typeof f === 'string' && f.toLowerCase() === 'skill.md');
    return hasSkillMd;
  }

  /** Validate a v0.2.0 skill entry from the index. */
  private isValidSkillEntryV2(entry: unknown): entry is WellKnownSkillEntryV2 {
    if (!entry || typeof entry !== 'object') return false;

    const e = entry as Record<string, unknown>;
    if (!this.isValidSkillName(e.name)) return false;
    if (typeof e.description !== 'string' || !e.description || e.description.length > 1024) {
      return false;
    }
    if (e.type !== 'skill-md' && e.type !== 'archive') return false;
    if (typeof e.url !== 'string' || !e.url) return false;
    if (typeof e.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(e.digest)) return false;

    try {
      // Ensure URL is resolvable as either absolute or relative.
      new URL(e.url, 'https://example.com/.well-known/agent-skills/index.json');
    } catch {
      return false;
    }

    return true;
  }

  /** Fetch a single skill from a well-known endpoint. */
  async fetchSkill(url: string): Promise<RemoteSkill | null> {
    try {
      const parsed = new URL(url);
      const candidates = await this.fetchIndexCandidates(url);

      for (const result of candidates) {
        const { entries } = result;
        let skillName: string | null = null;

        const pathMatch = parsed.pathname.match(
          /\/.well-known\/(?:agent-skills|skills)\/([^/]+)\/?$/
        );
        if (pathMatch && pathMatch[1] && pathMatch[1] !== 'index.json') {
          skillName = pathMatch[1];
        } else if (entries.length === 1) {
          skillName = entries[0]!.name;
        }

        if (!skillName) continue;

        const skillEntry = entries.find((s) => s.name === skillName);
        if (!skillEntry) continue;

        const skill = await this.fetchSkillByEntry(skillEntry);
        if (skill) return skill;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a skill by its normalized index entry. Kept public for tests and
   * internal add flow; callers with legacy arguments are also supported.
   */
  async fetchSkillByEntry(
    baseUrlOrEntry: string | NormalizedWellKnownEntry,
    legacyEntry?: WellKnownSkillEntryV1,
    legacyWellKnownPath?: string
  ): Promise<WellKnownSkill | null> {
    if (typeof baseUrlOrEntry === 'string') {
      if (!legacyEntry) return null;
      return this.fetchLegacySkillByEntry({
        version: '0.1.0',
        name: legacyEntry.name,
        description: legacyEntry.description,
        files: legacyEntry.files,
        baseUrl: baseUrlOrEntry,
        wellKnownPath: legacyWellKnownPath ?? this.WELL_KNOWN_PATHS[0],
        indexEntry: legacyEntry,
      });
    }

    if (baseUrlOrEntry.version === '0.1.0') {
      return this.fetchLegacySkillByEntry(baseUrlOrEntry);
    }

    return this.fetchArtifactSkillByEntry(baseUrlOrEntry);
  }

  private async fetchLegacySkillByEntry(
    entry: Extract<NormalizedWellKnownEntry, { version: '0.1.0' }>
  ) {
    try {
      const skillBaseUrl = `${entry.baseUrl.replace(/\/$/, '')}/${entry.wellKnownPath}/${entry.name}`;
      const skillMdUrl = `${skillBaseUrl}/SKILL.md`;
      const response = await fetch(skillMdUrl);
      if (!response.ok) return null;

      const content = await response.text();
      const { data } = parseFrontmatter(content);
      if (typeof data.name !== 'string' || typeof data.description !== 'string') return null;

      const files = new Map<string, WellKnownFileContent>();
      files.set('SKILL.md', content);

      const otherFiles = entry.files.filter((f) => f.toLowerCase() !== 'skill.md');
      const filePromises = otherFiles.map(async (filePath) => {
        try {
          const fileUrl = `${skillBaseUrl}/${filePath}`;
          const fileResponse = await fetch(fileUrl);
          if (fileResponse.ok) {
            const fileContent = await fileResponse.arrayBuffer();
            return { path: filePath, content: new Uint8Array(fileContent) };
          }
        } catch {
          // Ignore individual file fetch errors to preserve legacy behavior.
        }
        return null;
      });

      const fileResults = await Promise.all(filePromises);
      for (const result of fileResults) {
        if (result) files.set(result.path, result.content);
      }

      return this.createSkill({
        name: data.name,
        description: data.description,
        content,
        installName: entry.name,
        sourceUrl: skillMdUrl,
        metadata: data.metadata,
        files,
        indexEntry: entry.indexEntry,
      });
    } catch {
      return null;
    }
  }

  private async fetchArtifactSkillByEntry(
    entry: Extract<NormalizedWellKnownEntry, { version: '0.2.0' }>
  ) {
    try {
      const response = await fetch(entry.artifactUrl);
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') ?? '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (this.computeDigest(bytes) !== entry.digest) return null;

      if (entry.type === 'skill-md') {
        const content = new TextDecoder().decode(bytes);
        const { data } = parseFrontmatter(content);
        if (typeof data.name !== 'string' || typeof data.description !== 'string') return null;

        const files = new Map<string, WellKnownFileContent>();
        files.set('SKILL.md', content);

        return this.createSkill({
          name: data.name,
          description: data.description,
          content,
          installName: entry.name,
          sourceUrl: entry.artifactUrl,
          metadata: data.metadata,
          files,
          indexEntry: entry.indexEntry,
        });
      }

      const files = this.extractArchive(bytes, entry.artifactUrl, contentType);
      const skillMdBytes = files.get('SKILL.md');
      if (!skillMdBytes) return null;

      const content =
        typeof skillMdBytes === 'string' ? skillMdBytes : new TextDecoder().decode(skillMdBytes);
      files.set('SKILL.md', content);

      const { data } = parseFrontmatter(content);
      if (typeof data.name !== 'string' || typeof data.description !== 'string') return null;

      return this.createSkill({
        name: data.name,
        description: data.description,
        content,
        installName: entry.name,
        sourceUrl: entry.artifactUrl,
        metadata: data.metadata,
        files,
        indexEntry: entry.indexEntry,
      });
    } catch {
      return null;
    }
  }

  private createSkill(input: {
    name: string;
    description: string;
    content: string;
    installName: string;
    sourceUrl: string;
    metadata: unknown;
    files: Map<string, WellKnownFileContent>;
    indexEntry: WellKnownSkillEntry;
  }): WellKnownSkill {
    return {
      name: sanitizeMetadata(input.name),
      description: sanitizeMetadata(input.description),
      content: input.content,
      installName: input.installName,
      sourceUrl: input.sourceUrl,
      metadata:
        input.metadata && typeof input.metadata === 'object'
          ? (input.metadata as Record<string, unknown>)
          : undefined,
      files: input.files,
      indexEntry: input.indexEntry,
    };
  }

  /** Fetch all skills from a well-known endpoint. */
  async fetchAllSkills(url: string): Promise<WellKnownSkill[]> {
    try {
      const candidates = await this.fetchIndexCandidates(url);

      for (const result of candidates) {
        const skillPromises = result.entries.map((entry) => this.fetchSkillByEntry(entry));
        const results = await Promise.all(skillPromises);
        const skills = results.filter(
          (s: WellKnownSkill | null): s is WellKnownSkill => s !== null
        );
        if (skills.length > 0) return skills;
      }

      return [];
    } catch {
      return [];
    }
  }

  private computeDigest(bytes: Uint8Array): string {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  }

  private extractArchive(
    bytes: Uint8Array,
    artifactUrl: string,
    contentType: string
  ): Map<string, WellKnownFileContent> {
    if (this.isZipArchive(bytes, artifactUrl, contentType)) {
      return this.extractZip(bytes);
    }

    if (this.isTarGzArchive(bytes, artifactUrl, contentType)) {
      return this.extractTarGz(bytes);
    }

    throw new Error('Unsupported archive format');
  }

  private isZipArchive(bytes: Uint8Array, artifactUrl: string, contentType: string): boolean {
    return (
      contentType.includes('application/zip') ||
      artifactUrl.toLowerCase().endsWith('.zip') ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b)
    );
  }

  private isTarGzArchive(bytes: Uint8Array, artifactUrl: string, contentType: string): boolean {
    const lower = artifactUrl.toLowerCase();
    return (
      contentType.includes('application/gzip') ||
      contentType.includes('application/x-gzip') ||
      lower.endsWith('.tar.gz') ||
      lower.endsWith('.tgz') ||
      (bytes[0] === 0x1f && bytes[1] === 0x8b)
    );
  }

  private normalizeArchivePath(rawPath: string): string | null {
    if (!rawPath || rawPath.includes('\0')) return null;
    if (rawPath.startsWith('/') || rawPath.startsWith('\\')) return null;
    if (/^[A-Za-z]:/.test(rawPath)) return null;
    if (rawPath.includes('\\')) return null;

    const parts = rawPath.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.some((part) => part === '.' || part === '..')) return null;

    return parts.join('/');
  }

  private addArchiveFile(
    files: Map<string, WellKnownFileContent>,
    path: string,
    content: Uint8Array,
    runningTotal: { bytes: number }
  ) {
    const normalizedPath = this.normalizeArchivePath(path);
    if (!normalizedPath) throw new Error(`Unsafe archive path: ${path}`);

    runningTotal.bytes += content.byteLength;
    if (runningTotal.bytes > MAX_ARCHIVE_UNPACKED_BYTES) {
      throw new Error('Archive exceeds maximum unpacked size');
    }
    if (files.size >= MAX_ARCHIVE_FILES) {
      throw new Error('Archive contains too many files');
    }

    files.set(normalizedPath, content);
  }

  private extractTarGz(bytes: Uint8Array): Map<string, WellKnownFileContent> {
    const tar = gunzipSync(Buffer.from(bytes));
    const files = new Map<string, WellKnownFileContent>();
    const runningTotal = { bytes: 0 };
    let offset = 0;

    while (offset + 512 <= tar.length) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((byte) => byte === 0)) break;

      const name = this.readTarString(header, 0, 100);
      const sizeText = this.readTarString(header, 124, 12).trim();
      const typeFlag = header[156];
      const prefix = this.readTarString(header, 345, 155);
      const path = prefix ? `${prefix}/${name}` : name;
      const size = Number.parseInt(sizeText || '0', 8);

      if (!Number.isFinite(size) || size < 0) throw new Error('Invalid tar entry size');
      offset += 512;

      // Reject symlinks and hard links. Skip directories and metadata entries.
      if (typeFlag === 0x32 || typeFlag === 0x31) {
        throw new Error('Archive links are not supported');
      }

      const isFile = typeFlag === 0 || typeFlag === 0x30;
      if (isFile) {
        const content = tar.subarray(offset, offset + size);
        this.addArchiveFile(files, path, new Uint8Array(content), runningTotal);
      }

      offset += Math.ceil(size / 512) * 512;
    }

    if (!files.has('SKILL.md')) throw new Error('Archive missing root SKILL.md');
    return files;
  }

  private readTarString(buffer: Uint8Array, offset: number, length: number): string {
    const slice = buffer.subarray(offset, offset + length);
    const nul = slice.indexOf(0);
    return new TextDecoder().decode(nul >= 0 ? slice.subarray(0, nul) : slice);
  }

  private extractZip(bytes: Uint8Array): Map<string, WellKnownFileContent> {
    const buffer = Buffer.from(bytes);
    const eocdOffset = this.findZipEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) throw new Error('Invalid zip archive');

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const files = new Map<string, WellKnownFileContent>();
    const runningTotal = { bytes: 0 };
    let offset = centralDirectoryOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid zip directory');

      const flags = buffer.readUInt16LE(offset + 8);
      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const externalAttributes = buffer.readUInt32LE(offset + 38);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      const rawName = buffer.subarray(nameStart, nameStart + fileNameLength);
      const fileName = new TextDecoder(flags & 0x800 ? 'utf-8' : undefined).decode(rawName);

      offset = nameStart + fileNameLength + extraLength + commentLength;

      // Directories are allowed but not installed as files.
      if (fileName.endsWith('/')) continue;

      // Reject encrypted entries, symlinks, and hard links. ZIP external attributes store
      // POSIX mode bits in the upper 16 bits for common UNIX-producing tools.
      if (flags & 0x1) throw new Error('Encrypted zip entries are not supported');
      const unixMode = externalAttributes >>> 16;
      const fileType = unixMode & 0o170000;
      if (fileType === 0o120000 || fileType === 0o10000) {
        throw new Error('Archive links are not supported');
      }

      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error('Invalid zip local header');
      }
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

      let content: Buffer;
      if (method === 0) {
        content = compressed;
      } else if (method === 8) {
        content = inflateRawSync(compressed);
      } else {
        throw new Error(`Unsupported zip compression method: ${method}`);
      }

      if (content.byteLength !== uncompressedSize) {
        throw new Error('Zip entry size mismatch');
      }

      this.addArchiveFile(files, fileName, new Uint8Array(content), runningTotal);
    }

    if (!files.has('SKILL.md')) throw new Error('Archive missing root SKILL.md');
    return files;
  }

  private findZipEndOfCentralDirectory(buffer: Buffer): number {
    const minOffset = Math.max(0, buffer.length - 0xffff - 22);
    for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    return -1;
  }

  /**
   * Convert a user-facing URL to a skill URL.
   * For well-known, this extracts the base domain and constructs the proper path.
   * Uses agent-skills as the primary path for new URLs.
   */
  toRawUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (url.toLowerCase().endsWith('/skill.md')) {
        return url;
      }

      const primaryPath = this.WELL_KNOWN_PATHS[0];
      const pathMatch = parsed.pathname.match(
        /\/.well-known\/(?:agent-skills|skills)\/([^/]+)\/?$/
      );
      if (pathMatch && pathMatch[1]) {
        const basePath = parsed.pathname.replace(/\/.well-known\/(?:agent-skills|skills)\/.*$/, '');
        return `${parsed.protocol}//${parsed.host}${basePath}/${primaryPath}/${pathMatch[1]}/SKILL.md`;
      }

      const basePath = parsed.pathname.replace(/\/$/, '');
      return `${parsed.protocol}//${parsed.host}${basePath}/${primaryPath}/${this.INDEX_FILE}`;
    } catch {
      return url;
    }
  }

  /**
   * Get the source identifier for telemetry/storage.
   * Returns the full hostname with www. stripped.
   */
  getSourceIdentifier(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /** Check if a URL has a well-known skills index. */
  async hasSkillsIndex(url: string): Promise<boolean> {
    const result = await this.fetchIndex(url);
    return result !== null;
  }
}

export const wellKnownProvider = new WellKnownProvider();
