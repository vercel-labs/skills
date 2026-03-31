import { describe, it, expect } from 'vitest';
import {
  parseSignature,
  extractSignedContent,
  computeContentHash,
  formatVerificationResult,
  type VerificationResult,
} from '../src/signature.ts';

const SKILL_WITH_SIGNATURE = `---
name: test-skill
description: A test skill

signature:
  algorithm: ed25519-sha256
  signer: skills.sh
  content_hash: sha256:abc123
  signed_at: 2026-03-14T10:00:00Z
  sig: dGVzdHNpZw==
  kid: key-2026-01
---

# Test Skill

Do something awesome.
`;

const SKILL_WITHOUT_SIGNATURE = `---
name: test-skill
description: A test skill
---

# Test Skill

Do something awesome.
`;

const SKILL_NO_FRONTMATTER = `# Test Skill

Do something awesome.
`;

describe('parseSignature', () => {
  it('parses a valid signature block', () => {
    const sig = parseSignature(SKILL_WITH_SIGNATURE);
    expect(sig).not.toBeNull();
    expect(sig!.algorithm).toBe('ed25519-sha256');
    expect(sig!.signer).toBe('skills.sh');
    expect(sig!.content_hash).toBe('sha256:abc123');
    expect(sig!.signed_at).toBe('2026-03-14T10:00:00Z');
    expect(sig!.sig).toBe('dGVzdHNpZw==');
    expect(sig!.kid).toBe('key-2026-01');
  });

  it('returns null when no signature block', () => {
    expect(parseSignature(SKILL_WITHOUT_SIGNATURE)).toBeNull();
  });

  it('returns null when no frontmatter', () => {
    expect(parseSignature(SKILL_NO_FRONTMATTER)).toBeNull();
  });
});

describe('extractSignedContent', () => {
  it('extracts content below frontmatter', () => {
    const content = extractSignedContent(SKILL_WITH_SIGNATURE);
    expect(content).toBe('# Test Skill\n\nDo something awesome.');
  });

  it('returns full content when no frontmatter', () => {
    const content = extractSignedContent(SKILL_NO_FRONTMATTER);
    expect(content).toBe('# Test Skill\n\nDo something awesome.');
  });
});

describe('computeContentHash', () => {
  it('computes sha256 hash with prefix', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces deterministic hashes', () => {
    const a = computeContentHash('test content');
    const b = computeContentHash('test content');
    expect(a).toBe(b);
  });

  it('produces different hashes for different content', () => {
    const a = computeContentHash('content a');
    const b = computeContentHash('content b');
    expect(a).not.toBe(b);
  });
});

describe('formatVerificationResult', () => {
  it('formats verified result', () => {
    const result: VerificationResult = {
      status: 'verified',
      signer: 'skills.sh',
      signed_at: '2026-03-14T10:00:00Z',
    };
    expect(formatVerificationResult(result)).toContain('Verified');
    expect(formatVerificationResult(result)).toContain('skills.sh');
  });

  it('formats no-signature result', () => {
    const result: VerificationResult = { status: 'no-signature' };
    expect(formatVerificationResult(result)).toContain('No signature');
  });

  it('formats hash-mismatch result', () => {
    const result: VerificationResult = {
      status: 'hash-mismatch',
      expected: 'sha256:aaa',
      actual: 'sha256:bbb',
    };
    expect(formatVerificationResult(result)).toContain('tampered');
  });

  it('formats invalid-signature result', () => {
    const result: VerificationResult = {
      status: 'invalid-signature',
      reason: 'bad sig',
    };
    expect(formatVerificationResult(result)).toContain('Invalid');
  });

  it('formats key-fetch-failed result', () => {
    const result: VerificationResult = {
      status: 'key-fetch-failed',
      signer: 'example.com',
      error: 'timeout',
    };
    expect(formatVerificationResult(result)).toContain('example.com');
  });
});
