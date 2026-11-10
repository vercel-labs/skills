import { isCI } from './ci.ts';

const TELEMETRY_URL = 'https://www.skills.sh/tele/t';
const AUDIT_URL = 'https://www.skills.sh/tele/audit';

interface InstallTelemetryData {
  event: 'install';
  source: string;
  skills: string;
  agents: string;
  global?: '1';
  skillFiles?: string; // JSON stringified { skillName: relativePath }
  /** User-facing URL that can be passed back to `skills add`. */
  installUrl?: string;
  /** Caller-provided JSON attached to this install telemetry event. */
  metadata?: string;
  /**
   * Source type for different hosts:
   * - 'github': GitHub repository (default, uses raw.githubusercontent.com)
   * - 'raw': Direct URL to SKILL.md (generic raw URL)
   * - Provider IDs like 'mintlify', 'huggingface', etc.
   */
  sourceType?: string;
}

interface RemoveTelemetryData {
  event: 'remove';
  source?: string;
  skills: string;
  agents: string;
  global?: '1';
  sourceType?: string;
}

interface UpdateTelemetryData {
  event: 'update';
  scope?: string;
  skillCount: string;
  successCount: string;
  failCount: string;
}

interface FindTelemetryData {
  event: 'find';
  query: string;
  resultCount: string;
  interactive?: '1';
}

interface SyncTelemetryData {
  event: 'experimental_sync';
  skillCount: string;
  successCount: string;
  agents: string;
}

type TelemetryData =
  | InstallTelemetryData
  | RemoveTelemetryData
  | UpdateTelemetryData
  | FindTelemetryData
  | SyncTelemetryData;

let cliVersion: string | null = null;
let detectedAgentName: string | null = null;

/**
 * Set the detected AI agent name for telemetry tracking.
 * Called once during agent detection, then included in all telemetry events.
 */
export function setDetectedAgent(agentName: string | null): void {
  detectedAgentName = agentName;
}

function isEnabled(): boolean {
  return !process.env.DISABLE_TELEMETRY && !process.env.DO_NOT_TRACK;
}

export function setVersion(version: string): void {
  cliVersion = version;
}

// ─── Security audit data ───

export interface PartnerAudit {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  alerts?: number;
  score?: number;
  analyzedAt: string;
  provider?: string;
  status?: string;
  summary?: string;
  riskLevel?: string;
  categories?: string[];
}

export type SkillAuditData = Record<string, PartnerAudit>;
export type AuditResponse = Record<string, SkillAuditData>;

export const AUDIT_PROVIDERS = [
  { key: 'ath', label: 'Gen Agent Trust Hub', slug: 'agent-trust-hub' },
  { key: 'socket', label: 'Socket', slug: 'socket' },
  { key: 'snyk', label: 'Snyk', slug: 'snyk' },
] as const;

export function isFlaggedAudit(audit: PartnerAudit | undefined): audit is PartnerAudit {
  if (!audit) return false;
  return (
    audit.status === 'warn' ||
    audit.status === 'fail' ||
    (audit.alerts ?? 0) > 0 ||
    audit.risk === 'medium' ||
    audit.risk === 'high' ||
    audit.risk === 'critical'
  );
}

type AuditDetail = Pick<
  PartnerAudit,
  'provider' | 'status' | 'summary' | 'riskLevel' | 'categories'
> & {
  slug: string;
};

async function fetchSkillAuditDetails(
  source: string,
  skillSlug: string,
  timeoutMs: number
): Promise<{ audits?: AuditDetail[] } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://skills.sh/api/v1/skills/audit/${encodeURIComponent(source)}/${encodeURIComponent(skillSlug)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    return (await response.json()) as { audits?: AuditDetail[] };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch security audit results for skills from the audit API.
 * Returns null on any error or timeout — never blocks installation.
 */
export async function fetchAuditData(
  source: string,
  skillSlugs: string[],
  timeoutMs = 3000
): Promise<AuditResponse | null> {
  if (!isEnabled()) return null;
  if (skillSlugs.length === 0) return null;

  try {
    const params = new URLSearchParams({
      source,
      skills: skillSlugs.join(','),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${AUDIT_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const auditData = (await response.json()) as AuditResponse;

    // The compact endpoint only returns counts and risk levels; enrich flagged
    // skills with provider details. Failures stay advisory (compact result is kept).
    await Promise.all(
      skillSlugs
        .filter((slug) => Object.values(auditData[slug] ?? {}).some(isFlaggedAudit))
        .map(async (skillSlug) => {
          const details = await fetchSkillAuditDetails(source, skillSlug, timeoutMs);
          if (!Array.isArray(details?.audits)) return;

          for (const { slug, provider, status, summary, riskLevel, categories } of details.audits) {
            const key = AUDIT_PROVIDERS.find((p) => p.slug === slug)?.key;
            const partnerAudit = key && auditData[skillSlug]?.[key];
            if (partnerAudit) {
              Object.assign(partnerAudit, { provider, status, summary, riskLevel, categories });
            }
          }
        })
    );

    return auditData;
  } catch {
    return null;
  }
}

// Pending telemetry promises — awaited before CLI exit so we don't lose data,
// but never block the main workflow.
const pendingTelemetry: Promise<void>[] = [];

export function track(data: TelemetryData): void {
  if (!isEnabled()) return;

  try {
    const params = new URLSearchParams();

    // Add version
    if (cliVersion) {
      params.set('v', cliVersion);
    }

    // Add CI flag if running in CI
    if (isCI()) {
      params.set('ci', '1');
    }

    // Add detected AI agent name
    if (detectedAgentName) {
      params.set('agent', detectedAgentName);
    }

    // Add event data
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }

    // Fire and forget during the workflow, but track the promise so
    // flushTelemetry() can await it before the process exits.
    const p = fetch(`${TELEMETRY_URL}?${params.toString()}`)
      .catch(() => {})
      .then(() => {});
    pendingTelemetry.push(p);
  } catch {
    // Silently fail - telemetry should never break the CLI
  }
}

/**
 * Wait for all in-flight telemetry requests to settle.
 * Called once at CLI exit so the process doesn't hang on open sockets
 * but also doesn't drop data by exiting too early.
 */
export async function flushTelemetry(timeoutMs = 5000): Promise<void> {
  if (pendingTelemetry.length === 0) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.all(pendingTelemetry), timeout]);
}
