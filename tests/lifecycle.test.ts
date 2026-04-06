import { describe, it, expect } from 'vitest';
import {
  parseLifecycle,
  formatDeprecationWarning,
  formatYankWarning,
  formatLifecycleAnnotation,
} from '../src/lifecycle.ts';

describe('parseLifecycle', () => {
  it('defaults to active when no status field', () => {
    const result = parseLifecycle({});
    expect(result.status).toBe('active');
    expect(result.deprecated).toBeUndefined();
    expect(result.yanked).toBeUndefined();
  });

  it('parses explicit active status', () => {
    const result = parseLifecycle({ status: 'active' });
    expect(result.status).toBe('active');
  });

  it('parses deprecated status with details', () => {
    const result = parseLifecycle({
      status: 'deprecated',
      deprecated: {
        since: '2026-01-01',
        reason: 'Replaced by better-skill',
        replacement: 'org/better-skill',
        sunset: '2026-06-15',
      },
    });
    expect(result.status).toBe('deprecated');
    expect(result.deprecated?.reason).toBe('Replaced by better-skill');
    expect(result.deprecated?.replacement).toBe('org/better-skill');
    expect(result.deprecated?.sunset).toBe('2026-06-15');
    expect(result.deprecated?.since).toBe('2026-01-01');
  });

  it('parses yanked status with details', () => {
    const result = parseLifecycle({
      status: 'yanked',
      yanked: {
        since: '2026-02-01',
        reason: 'Security vulnerability',
        advisory: 'https://example.com/advisory/001',
      },
    });
    expect(result.status).toBe('yanked');
    expect(result.yanked?.reason).toBe('Security vulnerability');
    expect(result.yanked?.advisory).toBe('https://example.com/advisory/001');
  });

  it('infers deprecated from deprecated object without status', () => {
    const result = parseLifecycle({
      deprecated: {
        reason: 'Superseded',
        replacement: 'new-skill',
      },
    });
    expect(result.status).toBe('deprecated');
    expect(result.deprecated?.reason).toBe('Superseded');
  });

  it('infers yanked from yanked object without status', () => {
    const result = parseLifecycle({
      yanked: {
        reason: 'Broken',
      },
    });
    expect(result.status).toBe('yanked');
    expect(result.yanked?.reason).toBe('Broken');
  });

  it('handles boolean deprecated shorthand', () => {
    const result = parseLifecycle({ deprecated: true });
    expect(result.status).toBe('deprecated');
    expect(result.deprecated?.reason).toBe('This skill has been deprecated');
  });

  it('handles string "true" deprecated shorthand', () => {
    const result = parseLifecycle({ deprecated: 'true' });
    expect(result.status).toBe('deprecated');
  });

  it('handles boolean yanked shorthand', () => {
    const result = parseLifecycle({ yanked: true });
    expect(result.status).toBe('yanked');
    expect(result.yanked?.reason).toBe('This skill has been yanked');
  });

  it('provides default reason when deprecated object has no reason', () => {
    const result = parseLifecycle({
      status: 'deprecated',
      deprecated: { since: '2026-01-01' },
    });
    expect(result.deprecated?.reason).toBe('This skill has been deprecated');
  });

  it('provides default reason when yanked object has no reason', () => {
    const result = parseLifecycle({
      status: 'yanked',
      yanked: {},
    });
    expect(result.yanked?.reason).toBe('This skill has been yanked');
  });

  it('treats unknown status values as active', () => {
    const result = parseLifecycle({ status: 'unknown-value' });
    expect(result.status).toBe('active');
  });

  it('case-insensitive status parsing', () => {
    expect(parseLifecycle({ status: 'Deprecated' }).status).toBe('deprecated');
    expect(parseLifecycle({ status: 'YANKED' }).status).toBe('yanked');
    expect(parseLifecycle({ status: 'Active' }).status).toBe('active');
  });
});

describe('formatDeprecationWarning', () => {
  it('formats basic deprecation', () => {
    const output = formatDeprecationWarning({ reason: 'Replaced by new-skill' }, 'old-skill');
    expect(output).toContain('old-skill');
    expect(output).toContain('deprecated');
    expect(output).toContain('Replaced by new-skill');
  });

  it('includes replacement command', () => {
    const output = formatDeprecationWarning(
      { reason: 'Use new version', replacement: 'org/new-skill' },
      'old-skill'
    );
    expect(output).toContain('npx skills add org/new-skill');
  });

  it('includes sunset date', () => {
    const output = formatDeprecationWarning(
      { reason: 'End of life', sunset: '2026-06-15' },
      'old-skill'
    );
    expect(output).toContain('2026-06-15');
  });
});

describe('formatYankWarning', () => {
  it('formats basic yank', () => {
    const output = formatYankWarning({ reason: 'Security issue' }, 'bad-skill');
    expect(output).toContain('bad-skill');
    expect(output).toContain('yanked');
    expect(output).toContain('Security issue');
  });

  it('includes advisory URL', () => {
    const output = formatYankWarning(
      { reason: 'Vuln found', advisory: 'https://advisory.example.com/001' },
      'bad-skill'
    );
    expect(output).toContain('https://advisory.example.com/001');
  });
});

describe('formatLifecycleAnnotation', () => {
  it('returns null for active skills', () => {
    const annotation = formatLifecycleAnnotation({ status: 'active' });
    expect(annotation).toBeNull();
  });

  it('formats deprecated annotation with replacement', () => {
    const annotation = formatLifecycleAnnotation({
      status: 'deprecated',
      deprecated: {
        reason: 'Old',
        replacement: 'new-skill',
        sunset: '2026-06-15',
      },
    });
    expect(annotation).toContain('deprecated');
    expect(annotation).toContain('new-skill');
    expect(annotation).toContain('2026-06-15');
  });

  it('formats yanked annotation', () => {
    const annotation = formatLifecycleAnnotation({
      status: 'yanked',
      yanked: { reason: 'Security issue' },
    });
    expect(annotation).toContain('yanked');
    expect(annotation).toContain('Security issue');
  });
});
