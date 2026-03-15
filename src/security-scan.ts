/**
 * Pre-install security scanning for skills.
 *
 * Runs a security scan on skill source directories before installation
 * to detect potential risks (credential theft, data exfiltration,
 * backdoors, prompt injection, etc.).
 *
 * Uses @elliotllliu/agent-shield when available, falls back to a
 * built-in lightweight check.
 *
 * @see https://github.com/vercel-labs/skills/issues/613
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import pc from 'picocolors';

export interface ScanResult {
  /** Whether the scan completed successfully */
  scanned: boolean;
  /** Number of high-severity findings */
  highCount: number;
  /** Number of medium-severity findings */
  mediumCount: number;
  /** Number of low-severity findings */
  lowCount: number;
  /** Human-readable summary */
  summary: string;
  /** Whether agent-shield was used (vs built-in) */
  scanner: 'agent-shield' | 'built-in';
}

// ─── Built-in lightweight patterns ───

const HIGH_RISK_PATTERNS = [
  { pattern: /eval\s*\(/, label: 'eval() usage' },
  { pattern: /exec\s*\(/, label: 'exec() usage' },
  { pattern: /child_process/, label: 'child_process import' },
  { pattern: /\.ssh\/|\.aws\/|\.env\b/, label: 'sensitive path access' },
  { pattern: /<!--[\s\S]*?-->/, label: 'HTML comment (hidden instructions)' },
];

const MEDIUM_RISK_PATTERNS = [
  { pattern: /fetch\s*\(|https?:\/\//, label: 'network request' },
  { pattern: /readFile|readFileSync|fs\.read/, label: 'file system read' },
  { pattern: /writeFile|writeFileSync|fs\.write/, label: 'file system write' },
  { pattern: /process\.env/, label: 'environment variable access' },
];

/**
 * Run a built-in lightweight security scan on a directory.
 */
export async function builtInScan(dir: string): Promise<ScanResult> {
  let highCount = 0;
  let mediumCount = 0;
  const findings: string[] = [];

  async function scanFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');

      for (const { pattern, label } of HIGH_RISK_PATTERNS) {
        if (pattern.test(content)) {
          highCount++;
          findings.push(`${pc.red('HIGH')} ${label} in ${filePath}`);
        }
      }

      for (const { pattern, label } of MEDIUM_RISK_PATTERNS) {
        if (pattern.test(content)) {
          mediumCount++;
          findings.push(`${pc.yellow('MED')}  ${label} in ${filePath}`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  async function scanDir(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDir(fullPath);
        } else if (entry.isFile() && /\.(md|ts|js|py|json|yaml|yml)$/.test(entry.name)) {
          await scanFile(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await scanDir(dir);

  const total = highCount + mediumCount;
  const summary =
    total === 0
      ? pc.green('No security issues found')
      : `${highCount > 0 ? pc.red(`${highCount} high`) : ''}${highCount > 0 && mediumCount > 0 ? ', ' : ''}${mediumCount > 0 ? pc.yellow(`${mediumCount} medium`) : ''} risk finding(s)`;

  return {
    scanned: true,
    highCount,
    mediumCount,
    lowCount: 0,
    summary,
    scanner: 'built-in',
  };
}

/**
 * Check if agent-shield is available.
 */
function isAgentShieldAvailable(): boolean {
  try {
    const result = spawnSync('npx', ['@elliotllliu/agent-shield', '--version'], {
      timeout: 10_000,
      stdio: 'pipe',
      shell: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Run agent-shield scan on a directory.
 */
function agentShieldScan(dir: string): ScanResult {
  try {
    const result = spawnSync('npx', ['@elliotllliu/agent-shield', 'scan', dir, '--json'], {
      timeout: 30_000,
      stdio: 'pipe',
      shell: true,
    });

    if (result.status !== 0) {
      throw new Error('agent-shield scan failed');
    }

    const output = result.stdout?.toString('utf-8') || '';
    try {
      const data = JSON.parse(output);
      const highCount = (data.findings || []).filter(
        (f: { severity: string }) => f.severity === 'high' || f.severity === 'critical'
      ).length;
      const mediumCount = (data.findings || []).filter(
        (f: { severity: string }) => f.severity === 'medium'
      ).length;
      const lowCount = (data.findings || []).filter(
        (f: { severity: string }) => f.severity === 'low'
      ).length;

      const total = highCount + mediumCount + lowCount;
      const summary =
        total === 0
          ? pc.green('No security issues found')
          : `${highCount > 0 ? pc.red(`${highCount} high`) : ''}${mediumCount > 0 ? `, ${pc.yellow(`${mediumCount} medium`)}` : ''}${lowCount > 0 ? `, ${lowCount} low` : ''} risk finding(s)`;

      return {
        scanned: true,
        highCount,
        mediumCount,
        lowCount,
        summary,
        scanner: 'agent-shield',
      };
    } catch {
      // JSON parse failed, treat as plain output
      return {
        scanned: true,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        summary: output.trim().split('\n').pop() || 'Scan complete',
        scanner: 'agent-shield',
      };
    }
  } catch {
    return {
      scanned: false,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      summary: 'Scan failed',
      scanner: 'agent-shield',
    };
  }
}

/**
 * Run a pre-install security scan on a skill directory.
 * Tries agent-shield first, falls back to built-in patterns.
 */
export async function runSecurityScan(dir: string): Promise<ScanResult> {
  // Try agent-shield first
  if (isAgentShieldAvailable()) {
    const result = agentShieldScan(dir);
    if (result.scanned) return result;
  }

  // Fallback to built-in scan
  return builtInScan(dir);
}

/**
 * Format scan result for display.
 */
export function formatScanResult(result: ScanResult): string[] {
  const lines: string[] = [];

  const scannerLabel =
    result.scanner === 'agent-shield' ? pc.dim('(via Agent Shield)') : pc.dim('(built-in check)');

  lines.push(`  Security: ${result.summary} ${scannerLabel}`);

  return lines;
}
