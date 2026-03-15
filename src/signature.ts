/**
 * Skill signature verification module.
 *
 * Implements the signature verification RFC (#617):
 * - Parses signature blocks from SKILL.md YAML frontmatter
 * - Verifies ed25519 signatures over skill content
 * - Fetches and caches public keys from `.well-known/skills-pubkey`
 *
 * @see https://github.com/vercel-labs/skills/issues/617
 */

import { createHash, createVerify, verify as cryptoVerify } from 'crypto';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ───

export interface SkillSignature {
  /** Signing algorithm (e.g., "ed25519-sha256") */
  algorithm: string;
  /** Signer domain (e.g., "skills.sh", "skills.mycompany.io") */
  signer: string;
  /** Content hash in "algo:hex" format (e.g., "sha256:a1b2c3d4...") */
  content_hash: string;
  /** ISO timestamp when signed */
  signed_at: string;
  /** Base64-encoded signature */
  sig: string;
  /** Optional key ID for key rotation support */
  kid?: string;
}

export type VerificationResult =
  | { status: 'verified'; signer: string; signed_at: string }
  | { status: 'no-signature' }
  | { status: 'invalid-signature'; reason: string }
  | { status: 'hash-mismatch'; expected: string; actual: string }
  | { status: 'key-fetch-failed'; signer: string; error: string }
  | { status: 'unsupported-algorithm'; algorithm: string }
  | { status: 'error'; error: string };

export interface PublicKeyEntry {
  /** Key ID for matching with signature kid field */
  kid: string;
  /** PEM-encoded public key */
  public_key: string;
  /** Key algorithm (e.g., "ed25519") */
  algorithm: string;
  /** ISO timestamp when key was created */
  created_at: string;
  /** ISO timestamp when key expires (optional) */
  expires_at?: string;
}

interface CachedKeys {
  signer: string;
  keys: PublicKeyEntry[];
  fetched_at: string;
  ttl_seconds: number;
}

// ─── Constants ───

const SUPPORTED_ALGORITHMS = ['ed25519-sha256'];
const KEY_CACHE_TTL_SECONDS = 3600; // 1 hour
const KEY_CACHE_DIR = join(homedir(), '.agents', '.key-cache');
const WELL_KNOWN_PATH = '/.well-known/skills-pubkey';
const FETCH_TIMEOUT_MS = 10_000;

// ─── Frontmatter Parsing ───

/**
 * Extract signature block from SKILL.md content.
 * Returns null if no signature block is found.
 */
export function parseSignature(skillContent: string): SkillSignature | null {
  // Match YAML frontmatter between --- markers
  const frontmatterMatch = skillContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1]!;

  // Find signature block in frontmatter (simple YAML parsing)
  const sigMatch = frontmatter.match(/signature:\s*\n((?:\s{2,}.+\n?)*)/);
  if (!sigMatch) return null;

  const sigBlock = sigMatch[1]!;
  const fields: Record<string, string> = {};

  for (const line of sigBlock.split('\n')) {
    const fieldMatch = line.match(/^\s+(\w+):\s*(.+?)\s*$/);
    if (fieldMatch) {
      fields[fieldMatch[1]!] = fieldMatch[2]!;
    }
  }

  if (!fields.algorithm || !fields.signer || !fields.content_hash || !fields.sig) {
    return null;
  }

  return {
    algorithm: fields.algorithm,
    signer: fields.signer,
    content_hash: fields.content_hash,
    signed_at: fields.signed_at || '',
    sig: fields.sig,
    kid: fields.kid,
  };
}

/**
 * Extract the content below the frontmatter (the part that's signed).
 */
export function extractSignedContent(skillContent: string): string {
  const match = skillContent.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  return match ? match[1]!.trim() : skillContent.trim();
}

// ─── Hash Computation ───

/**
 * Compute SHA-256 hash of the signed content.
 */
export function computeContentHash(content: string): string {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

// ─── Key Management ───

/**
 * Get the cache file path for a signer domain.
 */
function getCachePath(signer: string): string {
  // Sanitize signer domain for filesystem use
  const safeName = signer.replace(/[^a-zA-Z0-9.-]/g, '_');
  return join(KEY_CACHE_DIR, `${safeName}.json`);
}

/**
 * Read cached public keys for a signer.
 * Returns null if cache is missing or expired.
 */
async function readCachedKeys(signer: string): Promise<PublicKeyEntry[] | null> {
  try {
    const cachePath = getCachePath(signer);
    const content = await readFile(cachePath, 'utf-8');
    const cached: CachedKeys = JSON.parse(content);

    // Check TTL
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const expiresAt = fetchedAt + cached.ttl_seconds * 1000;
    if (Date.now() > expiresAt) return null;

    return cached.keys;
  } catch {
    return null;
  }
}

/**
 * Write public keys to cache.
 */
async function writeCachedKeys(signer: string, keys: PublicKeyEntry[]): Promise<void> {
  try {
    await mkdir(KEY_CACHE_DIR, { recursive: true });
    const cached: CachedKeys = {
      signer,
      keys,
      fetched_at: new Date().toISOString(),
      ttl_seconds: KEY_CACHE_TTL_SECONDS,
    };
    await writeFile(getCachePath(signer), JSON.stringify(cached, null, 2), 'utf-8');
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Fetch public keys from a signer's .well-known endpoint.
 */
export async function fetchPublicKeys(signer: string): Promise<PublicKeyEntry[]> {
  // Try HTTPS first, then HTTP for local development
  const urls = [`https://${signer}${WELL_KNOWN_PATH}`, `http://${signer}${WELL_KNOWN_PATH}`];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = (await response.json()) as { keys: PublicKeyEntry[] };
      if (data.keys && Array.isArray(data.keys)) {
        return data.keys;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Could not fetch public keys from ${signer}`);
}

/**
 * Get public keys for a signer, using cache when available.
 */
export async function getPublicKeys(signer: string): Promise<PublicKeyEntry[]> {
  // Try cache first
  const cached = await readCachedKeys(signer);
  if (cached) return cached;

  // Fetch from network
  const keys = await fetchPublicKeys(signer);

  // Cache the result
  await writeCachedKeys(signer, keys);

  return keys;
}

/**
 * Find the matching key for a signature.
 */
function findMatchingKey(keys: PublicKeyEntry[], signature: SkillSignature): PublicKeyEntry | null {
  // If kid is specified, match by kid
  if (signature.kid) {
    return keys.find((k) => k.kid === signature.kid) ?? null;
  }

  // Otherwise, find any ed25519 key that hasn't expired
  const now = Date.now();
  return (
    keys.find((k) => {
      if (k.algorithm !== 'ed25519') return false;
      if (k.expires_at && new Date(k.expires_at).getTime() < now) return false;
      return true;
    }) ?? null
  );
}

// ─── Verification ───

/**
 * Verify a skill's signature.
 *
 * @param skillContent - Full SKILL.md content including frontmatter
 * @returns Verification result
 */
export async function verifySkillSignature(skillContent: string): Promise<VerificationResult> {
  try {
    // 1. Parse signature
    const signature = parseSignature(skillContent);
    if (!signature) {
      return { status: 'no-signature' };
    }

    // 2. Check algorithm support
    if (!SUPPORTED_ALGORITHMS.includes(signature.algorithm)) {
      return { status: 'unsupported-algorithm', algorithm: signature.algorithm };
    }

    // 3. Verify content hash
    const content = extractSignedContent(skillContent);
    const actualHash = computeContentHash(content);

    if (actualHash !== signature.content_hash) {
      return {
        status: 'hash-mismatch',
        expected: signature.content_hash,
        actual: actualHash,
      };
    }

    // 4. Fetch public key
    let keys: PublicKeyEntry[];
    try {
      keys = await getPublicKeys(signature.signer);
    } catch (err) {
      return {
        status: 'key-fetch-failed',
        signer: signature.signer,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 5. Find matching key
    const key = findMatchingKey(keys, signature);
    if (!key) {
      return {
        status: 'invalid-signature',
        reason: signature.kid
          ? `No key found with kid="${signature.kid}"`
          : 'No valid ed25519 key found for signer',
      };
    }

    // 6. Verify ed25519 signature
    const sigBuffer = Buffer.from(signature.sig, 'base64');
    const contentBuffer = Buffer.from(content, 'utf-8');

    // Node.js ed25519 verification
    const isValid = cryptoVerify(
      null, // ed25519 doesn't use a separate hash algorithm
      contentBuffer,
      {
        key: key.public_key,
        format: 'pem',
      },
      sigBuffer
    );

    if (!isValid) {
      return {
        status: 'invalid-signature',
        reason: 'Signature verification failed',
      };
    }

    return {
      status: 'verified',
      signer: signature.signer,
      signed_at: signature.signed_at,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Display Helpers ───

/**
 * Format a verification result for terminal display.
 */
export function formatVerificationResult(result: VerificationResult): string {
  switch (result.status) {
    case 'verified':
      return `✓ Verified (signed by ${result.signer}${result.signed_at ? `, ${result.signed_at}` : ''})`;
    case 'no-signature':
      return '○ No signature';
    case 'invalid-signature':
      return `✗ Invalid signature: ${result.reason}`;
    case 'hash-mismatch':
      return `✗ Content tampered (hash mismatch)`;
    case 'key-fetch-failed':
      return `⚠ Could not verify (failed to fetch keys from ${result.signer})`;
    case 'unsupported-algorithm':
      return `⚠ Unsupported algorithm: ${result.algorithm}`;
    case 'error':
      return `⚠ Verification error: ${result.error}`;
  }
}
