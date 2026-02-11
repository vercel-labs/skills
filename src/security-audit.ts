import { readFile, readdir, stat } from 'fs/promises';
import { join, basename, dirname, resolve, extname } from 'path';
import matter from 'gray-matter';
import { listInstalledSkills } from './installer.ts';

// ============================================
// Types
// ============================================

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'credential-exposure'
  | 'malicious-payload'
  | 'data-exfiltration'
  | 'suspicious-url';

export interface SecurityFinding {
  category: FindingCategory;
  risk: RiskLevel;
  title: string;
  description: string;
  match: string;
  line: number;
  filePath?: string;
}

export interface AuditResult {
  skillName: string;
  skillPath: string;
  findings: SecurityFinding[];
  riskScore: number;
  riskLabel: 'clean' | 'low' | 'medium' | 'high' | 'critical';
}

// ============================================
// Detection Rules
// ============================================

interface DetectionRule {
  id: string;
  pattern: RegExp;
  risk: RiskLevel;
  title: string;
  description: string;
  category: FindingCategory;
}

export const DETECTION_RULES: DetectionRule[] = [
  // Category 1: credential-exposure
  {
    id: 'aws-access-key',
    pattern: /AKIA[0-9A-Z]{16}/,
    risk: 'critical',
    title: 'AWS Access Key ID',
    description: 'Hardcoded AWS access key ID detected',
    category: 'credential-exposure',
  },
  {
    id: 'aws-secret-key',
    pattern: /(?:aws|amazon).{0,20}(?:secret|key).{0,20}['"][A-Za-z0-9/+=]{40}['"]/i,
    risk: 'critical',
    title: 'AWS Secret Key',
    description: 'Hardcoded AWS secret access key detected',
    category: 'credential-exposure',
  },
  {
    id: 'github-token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    risk: 'critical',
    title: 'GitHub Token',
    description: 'GitHub personal access token or OAuth token detected',
    category: 'credential-exposure',
  },
  {
    id: 'github-fine-grained',
    pattern: /github_pat_[A-Za-z0-9_]{22,}/,
    risk: 'critical',
    title: 'GitHub Fine-Grained Token',
    description: 'GitHub fine-grained personal access token detected',
    category: 'credential-exposure',
  },
  {
    id: 'generic-api-key',
    pattern:
      /(?:api[_-]?key|apikey|api[_-]?secret|api[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i,
    risk: 'high',
    title: 'Generic API Key',
    description: 'Potential API key or secret detected',
    category: 'credential-exposure',
  },
  {
    id: 'generic-secret',
    pattern:
      /(?:secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-/.+=]{8,}['"]/i,
    risk: 'high',
    title: 'Generic Secret',
    description: 'Potential secret, password, or token detected',
    category: 'credential-exposure',
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    risk: 'critical',
    title: 'Private Key',
    description: 'Private key material detected',
    category: 'credential-exposure',
  },
  {
    id: 'slack-token',
    pattern: /xox[bpors]-[A-Za-z0-9\-]{10,}/,
    risk: 'critical',
    title: 'Slack Token',
    description: 'Slack API token detected',
    category: 'credential-exposure',
  },
  {
    id: 'stripe-key',
    pattern: /sk_live_[A-Za-z0-9]{20,}/,
    risk: 'critical',
    title: 'Stripe Secret Key',
    description: 'Stripe live secret key detected',
    category: 'credential-exposure',
  },
  {
    id: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/,
    risk: 'medium',
    title: 'Bearer Token',
    description: 'Hardcoded bearer authentication token detected',
    category: 'credential-exposure',
  },
  {
    id: 'password-in-url',
    pattern: /(?:https?|ftp):\/\/[^:@\s]+:[^@\s]+@(?!localhost|127\.0\.0\.1|\[::1\])/,
    risk: 'high',
    title: 'Password in URL',
    description: 'URL contains embedded credentials',
    category: 'credential-exposure',
  },

  // Category 2: malicious-payload
  {
    id: 'rm-rf-root',
    pattern: /rm\s+-[a-z]*[rf][a-z]*[rf][a-z]*\s+(?:\/(?:\s|[;&|]|$)|\/\*|~\/|\$HOME|\$\{HOME\})/,
    risk: 'critical',
    title: 'Recursive Force Delete',
    description: 'Dangerous recursive force delete targeting root, home, or critical paths',
    category: 'malicious-payload',
  },
  {
    id: 'curl-pipe-shell',
    pattern: /curl\s[^|]*\|\s*(?:ba)?sh\b/,
    risk: 'critical',
    title: 'Curl Pipe to Shell',
    description: 'Remote code execution via curl piped to shell',
    category: 'malicious-payload',
  },
  {
    id: 'wget-pipe-shell',
    pattern: /wget\s[^|]*\|\s*(?:ba)?sh\b/,
    risk: 'critical',
    title: 'Wget Pipe to Shell',
    description: 'Remote code execution via wget piped to shell',
    category: 'malicious-payload',
  },
  {
    id: 'base64-decode-exec',
    pattern: /base64\s+(?:-d|--decode)\s*\|\s*(?:bash|sh|eval)/,
    risk: 'critical',
    title: 'Base64 Decode and Execute',
    description: 'Obfuscated payload decoded and executed via shell',
    category: 'malicious-payload',
  },
  {
    id: 'reverse-shell',
    pattern: /(?:\/dev\/tcp\/|bash\s+-i\s.*>&\s*\/dev|nc\s+-e\s)/,
    risk: 'critical',
    title: 'Reverse Shell',
    description: 'Reverse shell pattern detected',
    category: 'malicious-payload',
  },
  {
    id: 'dd-disk-write',
    pattern: /\bdd\s+.*?of=\/dev\//,
    risk: 'critical',
    title: 'Direct Disk Write',
    description: 'Direct disk write using dd command',
    category: 'malicious-payload',
  },
  {
    id: 'eval-usage',
    pattern: /\beval\s+["'`$]/,
    risk: 'medium',
    title: 'Eval Usage',
    description: 'Dynamic code execution via eval',
    category: 'malicious-payload',
  },
  {
    id: 'chmod-777',
    pattern: /chmod\s+(?:-R\s+)?(?:777|a\+rwx)/,
    risk: 'high',
    title: 'Chmod 777',
    description: 'Setting world-readable/writable/executable permissions',
    category: 'malicious-payload',
  },
  {
    id: 'crontab-modify',
    pattern: /crontab\s+-[re]/,
    risk: 'high',
    title: 'Crontab Modification',
    description: 'Modifying scheduled tasks via crontab',
    category: 'malicious-payload',
  },
  {
    id: 'python-exec',
    pattern: /python[3]?\s+-c\s+/,
    risk: 'medium',
    title: 'Python Inline Execution',
    description: 'Inline Python code execution',
    category: 'malicious-payload',
  },
  {
    id: 'node-exec',
    pattern: /node\s+-e\s+/,
    risk: 'medium',
    title: 'Node Inline Execution',
    description: 'Inline Node.js code execution',
    category: 'malicious-payload',
  },
  {
    id: 'sudo-usage',
    pattern: /\bsudo\b\s+/,
    risk: 'low',
    title: 'Sudo Usage',
    description: 'Command executed with elevated privileges',
    category: 'malicious-payload',
  },
  {
    id: 'disable-security',
    pattern: /(?:--no-verify|--insecure|-k)\b/,
    risk: 'low',
    title: 'Security Bypass Flag',
    description: 'Command uses flags that disable security checks',
    category: 'malicious-payload',
  },

  // Category 3: data-exfiltration
  {
    id: 'curl-post-data',
    pattern: /curl\s[^|]*?(?:-X\s*POST|-d\s|--data\b|--data-raw\b|--data-binary\b)/i,
    risk: 'high',
    title: 'Curl POST with Data',
    description: 'Data being sent via curl POST request',
    category: 'data-exfiltration',
  },
  {
    id: 'exfil-env-vars',
    pattern:
      /(?:curl|wget|fetch)\s[^|]*?\$(?:\{?(?:HOME|USER|HOSTNAME|SSH_AUTH_SOCK|AWS_|OPENAI_|GITHUB_|API_|SECRET_|TOKEN_|KEY_)\w*\}?)/i,
    risk: 'critical',
    title: 'Environment Variable Exfiltration',
    description: 'Sensitive environment variables being sent to remote endpoint',
    category: 'data-exfiltration',
  },
  {
    id: 'nc-connection',
    pattern: /\bnc\b\s+(?:-[a-z]*\s+)*\S+\s+\d+/,
    risk: 'high',
    title: 'Netcat Connection',
    description: 'Netcat connection to remote host',
    category: 'data-exfiltration',
  },
  {
    id: 'scp-remote',
    pattern: /\bscp\b\s+.*?:/,
    risk: 'medium',
    title: 'SCP Remote Transfer',
    description: 'File transfer to remote host via SCP',
    category: 'data-exfiltration',
  },
  {
    id: 'rsync-remote',
    pattern: /\brsync\b\s+.*?:/,
    risk: 'medium',
    title: 'Rsync Remote Transfer',
    description: 'File synchronization to remote host via rsync',
    category: 'data-exfiltration',
  },

  // Category 4: suspicious-url
  {
    id: 'ip-address-url',
    pattern: /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    risk: 'medium',
    title: 'IP Address URL',
    description: 'URL uses raw IP address instead of domain name',
    category: 'suspicious-url',
  },
  {
    id: 'non-https-url',
    pattern: /http:\/\/(?!localhost\b|127\.0\.0\.1\b|0\.0\.0\.0\b|\[::1\])[^\s)'"]+/,
    risk: 'low',
    title: 'Non-HTTPS URL',
    description: 'Unencrypted HTTP URL detected',
    category: 'suspicious-url',
  },
  {
    id: 'suspicious-tld',
    pattern: /https?:\/\/[^\s)'"]*\.(?:tk|ml|ga|cf|gq|xyz|top|buzz|work|click)\b/i,
    risk: 'medium',
    title: 'Suspicious TLD',
    description: 'URL uses a TLD commonly associated with abuse',
    category: 'suspicious-url',
  },
  {
    id: 'url-shortener',
    pattern:
      /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly)\//i,
    risk: 'medium',
    title: 'URL Shortener',
    description: 'Shortened URL hides the actual destination',
    category: 'suspicious-url',
  },
  {
    id: 'ngrok-url',
    pattern: /https?:\/\/[a-z0-9-]+\.ngrok(?:\.io|-free\.app|\.app)/i,
    risk: 'high',
    title: 'Ngrok URL',
    description: 'URL points to an ngrok tunnel (potentially ephemeral or untrusted)',
    category: 'suspicious-url',
  },
  {
    id: 'pastebin-url',
    pattern: /https?:\/\/(?:pastebin\.com|paste\.ee|hastebin\.com|dpaste\.org)\//i,
    risk: 'high',
    title: 'Pastebin URL',
    description: 'URL points to a paste service (commonly used for payload hosting)',
    category: 'suspicious-url',
  },
];

// ============================================
// Placeholder Exclusion
// ============================================

const PLACEHOLDER_PATTERN =
  /\b(?:YOUR_|XXXX|xxxx|example|EXAMPLE|placeholder|PLACEHOLDER|changeme|CHANGEME|replace.?me|INSERT_|TODO|FIXME)\b/i;

// ============================================
// ANSI Colors
// ============================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';

// ============================================
// Scannable file extensions
// ============================================

const SCANNABLE_EXTENSIONS = new Set(['.md', '.sh', '.json', '.yaml', '.yml', '.js', '.ts', '.py']);
const MAX_FILE_SIZE = 1_000_000; // 1MB
const MAX_SCAN_DEPTH = 3;

// ============================================
// Core Functions
// ============================================

/**
 * Scans a single line of text against all detection rules.
 * Skips credential findings that match common placeholder patterns.
 * Returns an array of security findings for the line.
 */
export function scanLine(line: string, lineNumber: number, filePath?: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const rule of DETECTION_RULES) {
    const match = rule.pattern.exec(line);
    if (!match) continue;

    const matchedText = match[0];

    // Skip credential findings that contain placeholder patterns
    if (rule.category === 'credential-exposure' && PLACEHOLDER_PATTERN.test(matchedText)) {
      continue;
    }

    const truncatedMatch =
      matchedText.length > 100 ? matchedText.substring(0, 100) + '...' : matchedText;

    findings.push({
      category: rule.category,
      risk: rule.risk,
      title: rule.title,
      description: rule.description,
      match: truncatedMatch,
      line: lineNumber,
      filePath,
    });
  }

  return findings;
}

/**
 * Audits a skill's content string by scanning each line for security issues.
 * Returns an AuditResult with all findings, risk score, and risk label.
 */
export function auditSkillContent(
  content: string,
  skillName: string,
  skillPath: string
): AuditResult {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const findings: SecurityFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineFindings = scanLine(lines[i]!, i + 1);
    findings.push(...lineFindings);
  }

  const riskScore = calculateRiskScore(findings);
  const riskLabel = getRiskLabel(riskScore);

  return {
    skillName,
    skillPath,
    findings,
    riskScore,
    riskLabel,
  };
}

/**
 * Recursively collects scannable files from a directory up to MAX_SCAN_DEPTH.
 * Skips .git and node_modules directories, and filters by SCANNABLE_EXTENSIONS.
 */
async function collectFiles(dirPath: string, depth: number): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return [];

  const files: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const subFiles = await collectFiles(fullPath, depth + 1);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SCANNABLE_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Directory not readable, skip
  }

  return files;
}

/**
 * Checks if a buffer contains binary content by looking for null bytes in the first 512 bytes.
 */
function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Audits an entire skill directory by collecting and scanning all eligible files.
 * Reads the skill name from SKILL.md frontmatter if available, otherwise uses the directory name.
 */
export async function auditSkillDirectory(dirPath: string): Promise<AuditResult> {
  const resolvedPath = resolve(dirPath);
  let skillName = basename(resolvedPath);

  // Try to read SKILL.md for the skill name
  try {
    const skillMdPath = join(resolvedPath, 'SKILL.md');
    const skillMdContent = await readFile(skillMdPath, 'utf-8');
    const { data } = matter(skillMdContent);
    if (data.name) {
      skillName = data.name;
    }
  } catch {
    // No SKILL.md or can't parse, use directory name
  }

  const files = await collectFiles(resolvedPath, 0);
  const allFindings: SecurityFinding[] = [];

  for (const filePath of files) {
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE) continue;

      const buffer = await readFile(filePath);
      if (isBinaryContent(buffer)) continue;

      const content = buffer.toString('utf-8');
      const normalized = content.replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const lineFindings = scanLine(lines[i]!, i + 1, filePath);
        allFindings.push(...lineFindings);
      }
    } catch {
      // Can't read file, skip
    }
  }

  const riskScore = calculateRiskScore(allFindings);
  const riskLabel = getRiskLabel(riskScore);

  return {
    skillName,
    skillPath: resolvedPath,
    findings: allFindings,
    riskScore,
    riskLabel,
  };
}

/**
 * Audits a map of file paths to content strings (e.g. from well-known endpoints).
 * Filters files by scannable extensions before scanning each line for security issues.
 */
export function auditSkillFiles(
  files: Map<string, string>,
  skillName: string,
  skillPath: string
): AuditResult {
  const allFindings: SecurityFinding[] = [];

  for (const [relativePath, content] of files) {
    const ext = extname(relativePath).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineFindings = scanLine(lines[i]!, i + 1, relativePath);
      allFindings.push(...lineFindings);
    }
  }

  const riskScore = calculateRiskScore(allFindings);
  const riskLabel = getRiskLabel(riskScore);

  return {
    skillName,
    skillPath,
    findings: allFindings,
    riskScore,
    riskLabel,
  };
}

/**
 * Calculates a numeric risk score (0-100) from findings based on severity weights.
 * Critical=25, high=15, medium=8, low=3, info=0.
 */
export function calculateRiskScore(findings: SecurityFinding[]): number {
  const weights: Record<RiskLevel, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
  };

  let score = 0;
  for (const finding of findings) {
    score += weights[finding.risk];
  }

  return Math.min(score, 100);
}

/**
 * Converts a numeric risk score into a human-readable risk label.
 * Returns 'clean' (0), 'low' (1-25), 'medium' (26-50), 'high' (51-75), or 'critical' (76+).
 */
export function getRiskLabel(score: number): AuditResult['riskLabel'] {
  if (score === 0) return 'clean';
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

// ============================================
// Report Formatting
// ============================================

const RISK_ORDER: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Returns an ANSI-colored badge string for a risk level (e.g. "CRITICAL" in red).
 */
function riskBadge(risk: RiskLevel): string {
  switch (risk) {
    case 'critical':
      return `${RED}${BOLD}CRITICAL${RESET}`;
    case 'high':
      return `${RED}HIGH${RESET}`;
    case 'medium':
      return `${YELLOW}MEDIUM${RESET}`;
    case 'low':
      return `${DIM}LOW${RESET}`;
    case 'info':
      return `${DIM}INFO${RESET}`;
  }
}

/**
 * Renders a colored progress bar showing the risk score out of 100.
 * Uses block characters and color based on the risk label.
 */
function riskScoreBar(score: number, label: AuditResult['riskLabel']): string {
  const filled = Math.round((score / 100) * 12);
  const empty = 12 - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  let color: string;
  switch (label) {
    case 'clean':
      color = GREEN;
      break;
    case 'low':
      color = GREEN;
      break;
    case 'medium':
      color = YELLOW;
      break;
    case 'high':
      color = RED;
      break;
    case 'critical':
      color = RED + BOLD;
      break;
  }

  return `${color}${bar}${RESET} ${score}/100 ${color}(${label.toUpperCase()})${RESET}`;
}

/**
 * Returns an ANSI-colored label for a finding category (e.g. "Credential Exposure" in cyan).
 */
function categoryLabel(category: FindingCategory): string {
  switch (category) {
    case 'credential-exposure':
      return `${CYAN}Credential Exposure${RESET}`;
    case 'malicious-payload':
      return `${RED}Malicious Payload${RESET}`;
    case 'data-exfiltration':
      return `${YELLOW}Data Exfiltration${RESET}`;
    case 'suspicious-url':
      return `${YELLOW}Suspicious URL${RESET}`;
  }
}

/**
 * Formats a full ANSI-colored audit report for one or more skills.
 * Groups findings by category, sorts by severity, and includes a risk score bar and summary counts.
 */
export function formatAuditReport(results: AuditResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    lines.push('');
    lines.push(`${BOLD}Security Audit: ${result.skillName}${RESET}`);
    lines.push(`${DIM}${result.skillPath}${RESET}`);
    lines.push('');

    if (result.findings.length === 0) {
      lines.push(`${GREEN}\u2713 No security issues found${RESET}`);
      lines.push('');
      continue;
    }

    // Group findings by category
    const grouped = new Map<FindingCategory, SecurityFinding[]>();
    for (const finding of result.findings) {
      const group = grouped.get(finding.category) || [];
      group.push(finding);
      grouped.set(finding.category, group);
    }

    // Sort categories by highest severity finding within each
    const sortedCategories = Array.from(grouped.entries()).sort(([, a], [, b]) => {
      const aMax = Math.min(...a.map((f) => RISK_ORDER.indexOf(f.risk)));
      const bMax = Math.min(...b.map((f) => RISK_ORDER.indexOf(f.risk)));
      return aMax - bMax;
    });

    for (const [category, findings] of sortedCategories) {
      // Sort findings within category by severity
      findings.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk));

      lines.push(`  ${categoryLabel(category)}`);

      for (const finding of findings) {
        const fileInfo = finding.filePath ? ` ${DIM}${basename(finding.filePath)}${RESET}` : '';
        lines.push(
          `    ${riskBadge(finding.risk)} ${TEXT}${finding.title}${RESET}${fileInfo}:${finding.line}`
        );
        lines.push(`      ${DIM}${finding.match}${RESET}`);
      }

      lines.push('');
    }

    // Risk score bar
    lines.push(`  ${riskScoreBar(result.riskScore, result.riskLabel)}`);

    // Summary counts
    const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of result.findings) {
      counts[finding.risk]++;
    }
    const parts: string[] = [];
    if (counts.critical > 0) parts.push(`${counts.critical} critical`);
    if (counts.high > 0) parts.push(`${counts.high} high`);
    if (counts.medium > 0) parts.push(`${counts.medium} medium`);
    if (counts.low > 0) parts.push(`${counts.low} low`);
    if (counts.info > 0) parts.push(`${counts.info} info`);
    lines.push(`  ${TEXT}${result.findings.length} findings: ${parts.join(', ')}${RESET}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================
// Audit Summary (for add.ts integration)
// ============================================

export interface AuditFormatter {
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

/**
 * Returns a padded, colored risk badge using the provided formatter (for add.ts integration).
 */
function formatRiskBadge(risk: RiskLevel, f: AuditFormatter): string {
  const padded = risk.toUpperCase().padEnd(8);
  switch (risk) {
    case 'critical':
      return f.bold(f.red(padded));
    case 'high':
      return f.red(padded);
    case 'medium':
      return f.yellow(padded);
    case 'low':
      return f.dim(padded);
    case 'info':
      return f.dim(padded);
  }
}

/**
 * Returns a colored category label using the provided formatter (for add.ts integration).
 */
function formatCategoryLabel(category: FindingCategory, f: AuditFormatter): string {
  switch (category) {
    case 'credential-exposure':
      return f.cyan('Credential Exposure');
    case 'malicious-payload':
      return f.red('Malicious Payload');
    case 'data-exfiltration':
      return f.yellow('Data Exfiltration');
    case 'suspicious-url':
      return f.yellow('Suspicious URL');
  }
}

/**
 * Formats a compact audit summary using the provided formatter.
 * Returns an array of lines suitable for display in the installation flow.
 */
export function formatAuditSummary(result: AuditResult, f: AuditFormatter): string[] {
  if (result.findings.length === 0) {
    return [f.green('\u2713') + ' Security audit: clean'];
  }

  const lines: string[] = [];

  lines.push(
    `Risk: ${result.riskLabel === 'critical' ? f.bold(f.red(result.riskLabel.toUpperCase())) : result.riskLabel === 'high' ? f.red(result.riskLabel.toUpperCase()) : result.riskLabel === 'medium' ? f.yellow(result.riskLabel.toUpperCase()) : result.riskLabel.toUpperCase()} (${result.riskScore}/100)`
  );
  lines.push('');

  // Group findings by category
  const grouped = new Map<FindingCategory, SecurityFinding[]>();
  for (const finding of result.findings) {
    const group = grouped.get(finding.category) || [];
    group.push(finding);
    grouped.set(finding.category, group);
  }

  // Sort categories by highest severity finding within each
  const sortedCategories = Array.from(grouped.entries()).sort(([, a], [, b]) => {
    const aMax = Math.min(...a.map((fi) => RISK_ORDER.indexOf(fi.risk)));
    const bMax = Math.min(...b.map((fi) => RISK_ORDER.indexOf(fi.risk)));
    return aMax - bMax;
  });

  for (const [category, findings] of sortedCategories) {
    findings.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk));

    lines.push(`  ${formatCategoryLabel(category, f)}`);

    for (const finding of findings) {
      const location = finding.filePath
        ? `${f.dim(basename(finding.filePath))}:${finding.line}`
        : `line ${finding.line}`;
      lines.push(`    ${formatRiskBadge(finding.risk, f)}  ${finding.title}  ${location}`);
    }

    lines.push('');
  }

  // Summary counts
  const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of result.findings) {
    counts[finding.risk]++;
  }
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);
  if (counts.info > 0) parts.push(`${counts.info} info`);
  lines.push(`${result.findings.length} findings: ${parts.join(', ')}`);

  return lines;
}

// ============================================
// CLI Entry Point
// ============================================

/**
 * CLI entry point for the `skills audit` command.
 * Supports auditing installed skills (--installed), a specific file, or a directory.
 * Exits with code 1 if medium or higher risk findings are detected.
 */
export async function runAudit(args: string[]): Promise<void> {
  const isInstalled = args.includes('--installed') || args.includes('-i');
  const isGlobal = args.includes('--global') || args.includes('-g');

  // Filter out flags from args to get path
  const positionalArgs = args.filter((a) => !a.startsWith('-'));

  if (isInstalled) {
    // Audit installed skills
    const skills = await listInstalledSkills({ global: isGlobal || undefined });

    if (skills.length === 0) {
      console.log(`${DIM}No installed skills found.${RESET}`);
      process.exit(0);
    }

    console.log(`${TEXT}Auditing ${skills.length} installed skill(s)...${RESET}`);
    console.log();

    const results: AuditResult[] = [];
    for (const skill of skills) {
      const result = await auditSkillDirectory(skill.canonicalPath);
      results.push(result);
    }

    console.log(formatAuditReport(results));

    const hasMediumPlus = results.some((r) =>
      r.findings.some((f) => f.risk === 'critical' || f.risk === 'high' || f.risk === 'medium')
    );
    process.exit(hasMediumPlus ? 1 : 0);
    return;
  }

  // Path-based audit
  let targetPath: string;

  if (positionalArgs.length > 0) {
    targetPath = resolve(positionalArgs[0]!);
  } else {
    targetPath = process.cwd();
  }

  // Check if targeting a specific file or directory
  try {
    const targetStat = await stat(targetPath);

    if (targetStat.isFile()) {
      // Single file audit
      const content = await readFile(targetPath, 'utf-8');
      const skillName = basename(dirname(targetPath));
      const result = auditSkillContent(content, skillName, targetPath);

      console.log(formatAuditReport([result]));

      const hasMediumPlus = result.findings.some(
        (f) => f.risk === 'critical' || f.risk === 'high' || f.risk === 'medium'
      );
      process.exit(hasMediumPlus ? 1 : 0);
      return;
    }

    if (targetStat.isDirectory()) {
      const result = await auditSkillDirectory(targetPath);

      console.log(formatAuditReport([result]));

      const hasMediumPlus = result.findings.some(
        (f) => f.risk === 'critical' || f.risk === 'high' || f.risk === 'medium'
      );
      process.exit(hasMediumPlus ? 1 : 0);
      return;
    }
  } catch {
    console.error(`${RED}Error: Path not found: ${targetPath}${RESET}`);
    process.exit(1);
  }
}
