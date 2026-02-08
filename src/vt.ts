import { createHash } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VTVerdict {
  found: boolean;
  verdict: 'malicious' | 'suspicious' | 'undetected' | 'unknown';
  maliciousCount: number;
  totalEngines: number;
  codeInsight?: string;
  permalink?: string;
  severityLevel?: string;
}

interface VTAnalysisStats {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
  timeout: number;
  'confirmed-timeout': number;
  failure: number;
  'type-unsupported': number;
}

interface VTFileAttributes {
  threat_verdict?: string;
  last_analysis_stats?: VTAnalysisStats;
  crowdsourced_ai_results?: Array<{ analysis?: string }>;
  threat_severity?: { threat_severity_level?: string };
  sha256?: string;
}

interface VTFileResponse {
  data?: {
    attributes?: VTFileAttributes;
    links?: { self?: string };
  };
}

// ── Functions ────────────────────────────────────────────────────────────────

const NOT_FOUND: VTVerdict = {
  found: false,
  verdict: 'unknown',
  maliciousCount: 0,
  totalEngines: 0,
};

/**
 * Check a single file hash against VirusTotal.
 * Returns a VTVerdict with the result, or a graceful fallback on errors.
 */
export async function lookupFileHash(sha256: string, apiKey: string): Promise<VTVerdict> {
  let response: Response;
  try {
    response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { 'x-apikey': apiKey },
    });
  } catch {
    // Network error — return gracefully
    return NOT_FOUND;
  }

  if (response.status === 404) {
    return NOT_FOUND;
  }

  if (response.status === 429) {
    // Rate limited — return gracefully
    return NOT_FOUND;
  }

  if (!response.ok) {
    return NOT_FOUND;
  }

  let body: VTFileResponse;
  try {
    body = (await response.json()) as VTFileResponse;
  } catch {
    return NOT_FOUND;
  }

  const attrs = body.data?.attributes;
  if (!attrs) {
    return NOT_FOUND;
  }

  // Compute total engines
  const stats = attrs.last_analysis_stats;
  const maliciousCount = stats?.malicious ?? 0;
  const totalEngines = stats ? Object.values(stats).reduce((sum, n) => sum + n, 0) : 0;

  // Map VT threat_verdict to our verdict type
  let verdict: VTVerdict['verdict'] = 'unknown';
  const tv = attrs.threat_verdict?.toLowerCase();
  if (tv === 'verdict_malicious' || tv === 'malicious') {
    verdict = 'malicious';
  } else if (tv === 'verdict_suspicious' || tv === 'suspicious') {
    verdict = 'suspicious';
  } else if (tv === 'verdict_undetected' || tv === 'undetected') {
    verdict = 'undetected';
  } else if (maliciousCount > 0) {
    // Fallback: if engines flagged it but no explicit verdict
    verdict = maliciousCount >= 5 ? 'malicious' : 'suspicious';
  } else if (stats) {
    verdict = 'undetected';
  }

  // Extract Code Insight (Gemini analysis) if available
  const aiResults = attrs.crowdsourced_ai_results;
  const codeInsight = aiResults?.[0]?.analysis;

  // Build permalink
  const fileHash = attrs.sha256 ?? sha256;
  const permalink = `https://www.virustotal.com/gui/file/${fileHash}`;

  return {
    found: true,
    verdict,
    maliciousCount,
    totalEngines,
    codeInsight,
    permalink,
    severityLevel: attrs.threat_severity?.threat_severity_level,
  };
}

/**
 * Compute SHA-256 of content and look it up on VirusTotal.
 */
export async function checkSkillOnVT(skillContent: string, apiKey: string): Promise<VTVerdict> {
  const sha256 = createHash('sha256').update(skillContent).digest('hex');
  return lookupFileHash(sha256, apiKey);
}
