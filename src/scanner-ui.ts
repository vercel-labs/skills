import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ScanResult, ScanSeverity } from './scanner.ts';
import { checkSkillOnVT, type VTVerdict } from './vt.ts';

const SEVERITY_LABELS: Record<ScanSeverity, string> = {
  critical: pc.bgRed(pc.white(pc.bold(' CRITICAL '))),
  high: pc.red(pc.bold('HIGH')),
  medium: pc.yellow('MEDIUM'),
  low: pc.blue('LOW'),
  info: pc.dim('INFO'),
};

const SEVERITY_ORDER: Record<ScanSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function displayVTVerdict(verdict: VTVerdict): void {
  if (!verdict.found) {
    p.log.message(pc.dim('  VirusTotal: not found (local scan only)'));
    return;
  }

  if (verdict.verdict === 'malicious') {
    p.log.message(
      `  ${pc.red('◆ VirusTotal: ✗ malicious')} ${pc.dim(`(${verdict.maliciousCount}/${verdict.totalEngines} engines)`)}`
    );
  } else if (verdict.verdict === 'suspicious') {
    p.log.message(
      `  ${pc.yellow('◆ VirusTotal: ⚠ suspicious')} ${pc.dim(`(${verdict.maliciousCount}/${verdict.totalEngines} engines)`)}`
    );
  } else {
    p.log.message(
      `  ${pc.green('◆ VirusTotal: ✓ clean')} ${pc.dim(`(${verdict.maliciousCount}/${verdict.totalEngines} engines)`)}`
    );
  }

  if (verdict.codeInsight) {
    const truncated =
      verdict.codeInsight.length > 200
        ? verdict.codeInsight.slice(0, 197) + '...'
        : verdict.codeInsight;
    p.log.message(pc.dim(`    Code Insight: ${truncated}`));
  }

  if (verdict.permalink) {
    p.log.message(pc.dim(`    ${verdict.permalink}`));
  }
}

export interface PresentScanOptions {
  yes?: boolean;
  vtKey?: string;
  /** Map of skill name → primary content (SKILL.md) for VT hash lookup */
  skillContents?: Map<string, string>;
}

/**
 * Present scan results to the user and decide whether to proceed.
 * Returns true to continue installation, false to abort.
 */
export async function presentScanResults(
  results: ScanResult[],
  options: PresentScanOptions
): Promise<boolean> {
  const allFindings = results.flatMap((r) =>
    r.findings.map((f) => ({ ...f, skillName: r.skillName }))
  );

  // Collect all URLs across results
  const allUrls = [...new Set(results.flatMap((r) => r.urls))];

  // Run VT lookups if key and content are provided
  const vtVerdicts = new Map<string, VTVerdict>();
  let vtEscalate = false;

  if (options.vtKey && options.skillContents) {
    for (const [skillName, content] of options.skillContents) {
      try {
        const verdict = await checkSkillOnVT(content, options.vtKey);
        vtVerdicts.set(skillName, verdict);
        if (verdict.found && verdict.verdict === 'malicious') {
          vtEscalate = true;
        }
      } catch {
        // VT lookup failed — continue without it
      }
    }
  }

  if (allFindings.length === 0 && !vtEscalate) {
    p.log.success(pc.green('Security scan passed — no issues found'));

    // Show VT results even when local scan is clean
    if (vtVerdicts.size > 0) {
      for (const [, verdict] of vtVerdicts) {
        displayVTVerdict(verdict);
      }
    }

    // If URLs found in an otherwise clean skill, show them and prompt
    if (allUrls.length > 0) {
      return displayUrlsAndPrompt(allUrls, options);
    }

    return true;
  }

  // Compute overall max severity
  let overallMax: ScanSeverity = 'info';
  for (const f of allFindings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[overallMax]) {
      overallMax = f.severity;
    }
  }

  // Display findings
  if (allFindings.length > 0) {
    console.log();
    p.log.warn(
      pc.yellow(
        `Security scan found ${allFindings.length} issue${allFindings.length !== 1 ? 's' : ''}`
      )
    );

    for (const result of results) {
      if (result.findings.length === 0) continue;

      if (results.length > 1) {
        p.log.message(pc.bold(`  ${result.skillName}:`));
      }

      for (const finding of result.findings) {
        const label = SEVERITY_LABELS[finding.severity];
        const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        p.log.message(`  ${label} ${finding.message}`);
        p.log.message(pc.dim(`    ${location}: ${finding.matchedText}`));
      }
    }
  }

  // Show VT verdicts
  if (vtVerdicts.size > 0) {
    console.log();
    for (const [, verdict] of vtVerdicts) {
      displayVTVerdict(verdict);
    }
  }

  // Show URLs found in skill files
  if (allUrls.length > 0) {
    console.log();
    p.log.info(`External URLs found in skill files (${allUrls.length}):`);
    for (const url of allUrls) {
      p.log.message(pc.dim(`  ${url}`));
    }
  }

  console.log();

  // If VT says malicious, escalate to critical regardless of local findings
  if (vtEscalate) {
    overallMax = 'critical';
  }

  // Decide based on severity
  if (SEVERITY_ORDER[overallMax] <= SEVERITY_ORDER['medium']) {
    // medium/low/info — auto-continue with note
    p.log.info(pc.dim('Low/medium severity findings — proceeding with installation'));
    return true;
  }

  if (overallMax === 'critical') {
    // Critical findings — always prompt, even with --yes
    p.log.error(pc.red(pc.bold('Critical security issues detected. This skill may be malicious.')));
    const confirmed = await p.confirm({
      message: pc.red('Install anyway? This is strongly discouraged.'),
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      return false;
    }
    return true;
  }

  // High severity
  if (options.yes) {
    p.log.warn(pc.yellow('High severity findings detected — proceeding (--yes flag set)'));
    return true;
  }

  const confirmed = await p.confirm({
    message: pc.yellow('Security warnings found. Continue with installation?'),
  });
  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }
  return true;
}

/**
 * Display extracted URLs and prompt the user to confirm.
 * Used when the scan is clean but URLs are present.
 */
async function displayUrlsAndPrompt(urls: string[], options: PresentScanOptions): Promise<boolean> {
  console.log();
  p.log.info(`External URLs found in skill files (${urls.length}):`);
  for (const url of urls) {
    p.log.message(pc.dim(`  ${url}`));
  }

  if (options.yes) {
    p.log.info(pc.dim('Proceeding with installation (--yes flag set)'));
    return true;
  }

  const confirmed = await p.confirm({
    message: 'This skill references external URLs. Continue with installation?',
  });
  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }
  return true;
}
