import { describe, expect, it } from 'vitest';
import { buildSecurityLines } from './add.js';
import { stripTerminalEscapes } from './sanitize.js';
import type { AuditResponse } from './telemetry.js';

const skills = [
  {
    slug: 'connected-service-automation',
    displayName: 'connected-service-automation',
  },
];

function render(auditData: AuditResponse): string {
  return stripTerminalEscapes(
    buildSecurityLines(auditData, skills, 'colinalexander/super-skills').join('\n')
  );
}

describe('security audit installation output', () => {
  it('shows enriched warning details and a provider-specific review URL', () => {
    const output = render({
      'connected-service-automation': {
        socket: {
          risk: 'medium',
          alerts: 1,
          analyzedAt: '2026-08-31T00:00:00Z',
          provider: 'Socket',
          providerSlug: 'socket',
          status: 'warn',
          summary: 'Broad scope permits high-impact external actions.',
          riskLevel: 'MEDIUM',
          categories: ['ANOMALY'],
        },
      },
    });

    expect(output).toContain('Review before installing:');
    expect(output).toContain('connected-service-automation · Socket · WARN · MEDIUM · ANOMALY');
    expect(output).toContain('Broad scope permits high-impact external actions.');
    expect(output).toContain(
      'https://skills.sh/colinalexander/super-skills/connected-service-automation/security/socket'
    );
  });

  it('falls back to the compact alert when detail enrichment is unavailable', () => {
    const output = render({
      'connected-service-automation': {
        socket: {
          risk: 'low',
          alerts: 1,
          analyzedAt: '2026-08-31T00:00:00Z',
        },
      },
    });

    expect(output).toContain('connected-service-automation · Socket · WARN · LOW');
    expect(output).toContain('1 alert reported.');
    expect(output).toContain('/connected-service-automation/security/socket');
  });

  it('keeps passing audits compact', () => {
    const output = render({
      'connected-service-automation': {
        socket: {
          risk: 'safe',
          alerts: 0,
          analyzedAt: '2026-08-31T00:00:00Z',
        },
      },
    });

    expect(output).not.toContain('Review before installing:');
    expect(output).toContain('0 alerts');
  });

  it('strips terminal escapes from remote audit text', () => {
    const output = buildSecurityLines(
      {
        'connected-service-automation': {
          socket: {
            risk: 'medium',
            alerts: 1,
            analyzedAt: '2026-08-31T00:00:00Z',
            provider: '\u001b]8;;https://example.com\u0007Socket\u001b]8;;\u0007',
            status: 'warn',
            summary: '\u001b[31mRemote warning\u001b[0m',
            riskLevel: 'MEDIUM',
          },
        },
      },
      skills,
      'colinalexander/super-skills'
    ).join('\n');

    expect(output).not.toContain('\u001b]8;;https://example.com');
    expect(output).not.toContain('\u001b[31mRemote warning');
    expect(stripTerminalEscapes(output)).toContain('Socket · WARN · MEDIUM');
    expect(stripTerminalEscapes(output)).toContain('Remote warning');
  });
});
