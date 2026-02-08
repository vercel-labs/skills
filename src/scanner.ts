import { readFile } from 'fs/promises';
import { join } from 'path';
import { readdir, stat } from 'fs/promises';
import type { Skill, RemoteSkill } from './types.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ScanFinding {
  rule: string;
  severity: ScanSeverity;
  message: string;
  file: string;
  line?: number;
  matchedText: string;
}

export interface ScanResult {
  skillName: string;
  findings: ScanFinding[];
  maxSeverity: ScanSeverity | null;
  clean: boolean;
  /** All unique URLs found in skill files */
  urls: string[];
}

interface ScanRule {
  id: string;
  severity: ScanSeverity;
  description: string;
  pattern: RegExp;
}

// ── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<ScanSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxSev(a: ScanSeverity | null, b: ScanSeverity): ScanSeverity {
  if (a === null) return b;
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

// ── Scan rules ───────────────────────────────────────────────────────────────

export const SCAN_RULES: ScanRule[] = [
  // ── Data exfiltration ────────────────────────────────────────────────────
  {
    id: 'exfil-curl-post',
    severity: 'critical',
    description: 'Potential data exfiltration via curl POST',
    pattern: /curl\s[^|]*?-[XdFT]\s*(?:POST\b|.*(?:secret|token|key|password|credential|env))/i,
  },
  {
    id: 'exfil-webhook',
    severity: 'critical',
    description: 'Webhook URL that could be used for data exfiltration',
    pattern:
      /https?:\/\/(?:hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks|webhook\.site|pipedream\.net|requestbin|hookbin)/i,
  },
  {
    id: 'exfil-fetch-post',
    severity: 'high',
    description: 'Fetch/HTTP POST with sensitive data',
    pattern:
      /(?:fetch|axios|http|request)\s*\(.*(?:secret|token|key|password|credential|api.?key)/i,
  },
  {
    id: 'exfil-env-read',
    severity: 'high',
    description: 'Reading environment variables or sensitive files',
    pattern:
      /(?:read|cat|type|get-content|less|more)\s+.*(?:\.env\b|\.ssh\/|\.aws\/|\.gnupg\/|credentials|\.netrc)/i,
  },
  {
    id: 'exfil-base64-pipe',
    severity: 'high',
    description: 'Base64 encoding piped to network command',
    pattern: /base64\s.*\|\s*(?:curl|wget|fetch|nc|ncat)/i,
  },

  // ── Prompt injection ─────────────────────────────────────────────────────
  {
    id: 'injection-ignore-instructions',
    severity: 'critical',
    description: 'Prompt injection: override previous instructions',
    pattern:
      /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts|rules|directives|guidelines)/i,
  },
  {
    id: 'injection-new-persona',
    severity: 'critical',
    description: 'Prompt injection: persona hijacking',
    pattern:
      /you\s+are\s+(?:now|no\s+longer)\s+(?:a\s+)?(?:DAN|jailbr(?:oken|eak)|uncensored|unrestricted|evil|unfiltered)/i,
  },
  {
    id: 'injection-hidden-html',
    severity: 'high',
    description: 'Hidden instructions in HTML comments',
    pattern: /<!--\s*(?:system|instruction|prompt|ignore|override|hidden)\b[^>]{10,}/i,
  },
  {
    id: 'injection-system-prompt',
    severity: 'high',
    description: 'Attempts to override system prompt',
    pattern:
      /(?:\[system\]|\[INST\]|<\|system\|>|<system>|<\/?s>)\s*(?:you\s+(?:are|must|should|will)|ignore|override|forget)/i,
  },
  {
    id: 'injection-do-anything-now',
    severity: 'critical',
    description: 'Known jailbreak phrase (DAN)',
    pattern: /\bDAN\b.*(?:do\s+anything\s+now|jailbreak|ignore\s+(?:all\s+)?(?:safety|rules))/i,
  },

  // ── Dangerous filesystem operations ──────────────────────────────────────
  {
    id: 'fs-rm-rf-root',
    severity: 'critical',
    description: 'Recursive deletion of root or home directory',
    pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/\s|\/\*|~\/?\s|~\/?\*|\$HOME)/,
  },
  {
    id: 'fs-overwrite-shell-config',
    severity: 'critical',
    description: 'Overwriting shell configuration files',
    pattern:
      /(?:>|tee)\s+.*(?:\.bashrc|\.bash_profile|\.zshrc|\.profile|\.zprofile|\.config\/fish)/i,
  },
  {
    id: 'fs-chmod-world-writable',
    severity: 'high',
    description: 'Setting world-writable permissions',
    pattern: /chmod\s+(?:777|a\+w|o\+w)\s/,
  },
  {
    id: 'fs-modify-ssh-keys',
    severity: 'high',
    description: 'Modifying SSH authorized_keys',
    pattern: /(?:>>?|tee)\s+.*\.ssh\/authorized_keys/i,
  },
  {
    id: 'fs-crontab-modify',
    severity: 'high',
    description: 'Modifying crontab or scheduled tasks',
    pattern: /(?:crontab|schtasks)\s+.*(?:-e|\/create|\/change)/i,
  },
  {
    id: 'fs-xattr-quarantine-bypass',
    severity: 'critical',
    description: 'macOS quarantine bypass (xattr -c/-d)',
    pattern: /xattr\s+(?:-[cdr]+\s+|.*com\.apple\.quarantine)/i,
  },

  // ── Credential patterns ──────────────────────────────────────────────────
  {
    id: 'cred-aws-key',
    severity: 'high',
    description: 'AWS access key ID pattern',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'cred-openai-key',
    severity: 'high',
    description: 'OpenAI API key pattern',
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/,
  },
  {
    id: 'cred-private-key',
    severity: 'high',
    description: 'Private key block',
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/,
  },
  {
    id: 'cred-github-token',
    severity: 'high',
    description: 'GitHub personal access token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/,
  },

  // ── Suspicious downloads & remote execution ────────────────────────────
  {
    id: 'download-curl-pipe-sh',
    severity: 'critical',
    description: 'Download and execute pattern (curl | sh)',
    pattern: /(?:curl|wget)\s+[^|]*\|\s*(?:ba)?sh\b/i,
  },
  {
    id: 'download-pipe-python',
    severity: 'critical',
    description: 'Download and execute via python',
    pattern: /(?:curl|wget)\s+[^|]*\|\s*python/i,
  },
  {
    id: 'download-exec-binary',
    severity: 'critical',
    description: 'Download and execute a binary or script',
    pattern: /(?:curl|wget)\s+.*-[oO]\s*\S+.*&&\s*(?:chmod\s+\+x|\.\/|bash|sh|python|node)\b/i,
  },
  {
    id: 'download-curl-subshell',
    severity: 'critical',
    description: 'Download and execute via command substitution ($(curl ...))',
    pattern: /(?:ba)?sh\s+.*\$\(\s*(?:curl|wget)\b/i,
  },
  {
    id: 'download-password-archive',
    severity: 'high',
    description: 'Password-protected archive download (malware evasion)',
    pattern: /(?:unzip|7z|tar)\s+.*(?:-p\s*\S+|-P\s*\S+|--password)/i,
  },
  {
    id: 'download-password-social',
    severity: 'high',
    description: 'Social engineering: archive with password instructions',
    pattern:
      /(?:extract|unzip|open|unpack)\s+.*(?:pass(?:word)?[:=]\s*[`'"]|using\s+pass(?:word)?[:=\s])/i,
  },
  {
    id: 'remote-skill-overwrite',
    severity: 'critical',
    description: 'Downloading content to overwrite skill/agent files',
    pattern:
      /(?:curl|wget)\s+.*(?:>\s*.*(?:SKILL\.md|HEARTBEAT\.md|\.claude|\.cursor|\.agents|skills\/))/i,
  },
  {
    id: 'remote-instruction-load',
    severity: 'high',
    description: 'Loading remote instructions or configuration at runtime',
    pattern:
      /(?:curl|wget|fetch|axios)\s+.*(?:skill\.json|skill\.md|instructions|config)\b.*(?:>|>>|\|\s*(?:source|eval|exec))/i,
  },

  // ── Obfuscated content ────────────────────────────────────────────────
  {
    id: 'obfuscation-base64-block',
    severity: 'critical',
    description: 'Large base64-encoded block (potential hidden instructions)',
    pattern: /(?:base64|atob|decode)\s*[:(]\s*['"`][A-Za-z0-9+/=]{100,}/i,
  },
  {
    id: 'obfuscation-base64-decode-exec',
    severity: 'critical',
    description: 'Base64 decode piped to execution',
    pattern: /base64\s+(?:-d|--decode)\s*.*\|\s*(?:ba)?sh\b/i,
  },
  {
    id: 'obfuscation-eval-encoded',
    severity: 'high',
    description: 'Eval of decoded/obfuscated string',
    pattern: /eval\s*\(\s*(?:atob|Buffer\.from|base64|decode|unescape)/i,
  },
  {
    id: 'obfuscation-unicode-escape',
    severity: 'high',
    description: 'Unicode escape sequences (potential instruction smuggling)',
    pattern: /(?:\\u[0-9a-fA-F]{4}){8,}/,
  },

  // ── Reverse shell ─────────────────────────────────────────────────────
  {
    id: 'reverse-shell-bash',
    severity: 'critical',
    description: 'Bash reverse shell pattern',
    pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp\//i,
  },
  {
    id: 'reverse-shell-nc',
    severity: 'critical',
    description: 'Netcat reverse shell pattern',
    pattern: /(?:nc|ncat|netcat)\s+.*\s+-e\s+(?:\/bin\/(?:ba)?sh|cmd)/i,
  },
  {
    id: 'reverse-shell-python',
    severity: 'critical',
    description: 'Python reverse shell pattern',
    pattern: /python[23]?\s+-c\s+.*(?:socket|subprocess|os\.(?:dup2|popen|system)).*connect/i,
  },

  // ── Improper credential handling ──────────────────────────────────────
  {
    id: 'cred-handling-echo-secret',
    severity: 'high',
    description: 'Printing/echoing secrets or API keys',
    pattern:
      /(?:echo|print|console\.log|puts|write)\s+.*(?:\$\{?(?:API_KEY|SECRET|TOKEN|PASSWORD|OPENAI|ANTHROPIC)|process\.env\.\w*(?:KEY|SECRET|TOKEN|PASS))/i,
  },
  {
    id: 'cred-handling-embed-in-url',
    severity: 'high',
    description: 'Credentials embedded in URL or command',
    pattern:
      /(?:curl|wget|fetch|http)\s+.*(?:[-?&](?:api_?key|token|secret|password|auth)=\$|Authorization:\s*Bearer\s+\$)/i,
  },

  // ── Additional secret patterns ────────────────────────────────────────
  {
    id: 'cred-slack-token',
    severity: 'high',
    description: 'Slack bot/user token',
    pattern: /\bxox[bposatrm]-[0-9a-zA-Z-]{10,}/,
  },
  {
    id: 'cred-stripe-key',
    severity: 'high',
    description: 'Stripe secret key',
    pattern: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/,
  },
  {
    id: 'cred-anthropic-key',
    severity: 'high',
    description: 'Anthropic API key pattern',
    pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/,
  },
  {
    id: 'cred-generic-high-entropy',
    severity: 'medium',
    description: 'Generic API key assignment pattern',
    pattern:
      /(?:api_?key|secret_?key|auth_?token|access_?token)\s*[:=]\s*['"][a-zA-Z0-9_\-/+]{32,}['"]/i,
  },

  // ── System service modification ───────────────────────────────────────
  {
    id: 'system-systemctl-modify',
    severity: 'high',
    description: 'Modifying systemd services',
    pattern: /systemctl\s+(?:enable|start|daemon-reload).*(?:>|tee)\s+.*\.service/i,
  },
  {
    id: 'system-service-file-write',
    severity: 'high',
    description: 'Writing to systemd or launchd service directories',
    pattern:
      /(?:>|tee)\s+.*(?:\/etc\/systemd\/|\/Library\/LaunchDaemons\/|\/Library\/LaunchAgents\/|~\/\.config\/systemd\/)/i,
  },
  {
    id: 'system-startup-modify',
    severity: 'high',
    description: 'Modifying startup/init scripts for persistence',
    pattern: /(?:>|>>|tee)\s+.*(?:\/etc\/rc\.local|\/etc\/init\.d\/|~\/\.local\/share\/autostart)/i,
  },

  // ── Financial access ──────────────────────────────────────────────────
  {
    id: 'finance-crypto-wallet',
    severity: 'medium',
    description: 'Cryptocurrency wallet or private key access',
    pattern:
      /(?:wallet|seed\s+phrase|private\s+key|mnemonic)\s+.*(?:send|transfer|sign|export|extract|read)/i,
  },
  {
    id: 'finance-trading-api',
    severity: 'medium',
    description: 'Direct access to trading or payment APIs',
    pattern:
      /(?:api\.binance|api\.coinbase|api\.stripe|api\.paypal|api\.bybit|polymarket)\.\w+.*(?:order|trade|transfer|withdraw|payment)/i,
  },

  // ── Suspicious directives ────────────────────────────────────────────────
  {
    id: 'directive-no-confirm',
    severity: 'high',
    description: 'Instructing agent to skip confirmation',
    pattern:
      /(?:never|don'?t|do\s+not|skip|bypass|disable)\s+(?:ask\s+(?:for\s+)?(?:confirmation|permission|approval)|prompt\s+(?:the\s+)?user|confirm\s+(?:before|with))/i,
  },
  {
    id: 'directive-silent-exec',
    severity: 'high',
    description: 'Instructing agent to execute silently',
    pattern:
      /(?:silently|quietly|secretly|covertly|invisibly)\s+(?:execute|run|install|download|send|upload|delete|modify)/i,
  },
  {
    id: 'directive-hide-output',
    severity: 'medium',
    description: 'Instructing agent to hide output from user',
    pattern:
      /(?:hide|suppress|conceal|mask|don'?t\s+show|do\s+not\s+show|never\s+show)\s+(?:the\s+)?(?:output|result|response|error|log)s?\s+(?:from|to)\s+(?:the\s+)?user/i,
  },
  {
    id: 'directive-disable-safety',
    severity: 'critical',
    description: 'Instructing agent to disable safety measures',
    pattern:
      /(?:disable|bypass|ignore|skip|turn\s+off|circumvent)\s+(?:safety|security|sandbox|guardrail|restriction|filter|protection)/i,
  },
  {
    id: 'directive-paste-terminal',
    severity: 'high',
    description: 'Social engineering: instructing user to paste commands into terminal',
    pattern:
      /(?:copy|paste|run|execute)\s+.*(?:into|in)\s+(?:your\s+)?(?:terminal|shell|command\s+(?:line|prompt)|console|powershell)/i,
  },

  // ── Agent config file access ────────────────────────────────────────────
  {
    id: 'cred-agent-config-access',
    severity: 'high',
    description: 'Accessing agent configuration or credential files',
    pattern:
      /~\/\.(?:clawdbot|claude|cursor|cline|codex|opencode|agents)\/(?:\.env|config|credentials|auth|secret)/i,
  },
];

// ── Core scan function ───────────────────────────────────────────────────────

// URL extraction pattern — matches http(s) URLs, excluding trailing punctuation/markdown
const URL_PATTERN = /https?:\/\/[^\s)<>"'`]+/gi;

export function scanSkillContent(skillName: string, files: Map<string, string>): ScanResult {
  const findings: ScanFinding[] = [];
  let computedMaxSeverity: ScanSeverity | null = null;
  const urlSet = new Set<string>();

  for (const [fileName, content] of files) {
    const lines = content.split('\n');

    for (const rule of SCAN_RULES) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = rule.pattern.exec(line);
        if (match) {
          const matchedText = match[0].length > 120 ? match[0].slice(0, 117) + '...' : match[0];
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            message: rule.description,
            file: fileName,
            line: i + 1,
            matchedText,
          });
          computedMaxSeverity = maxSev(computedMaxSeverity, rule.severity);
        }
      }
    }

    // Extract URLs
    let urlMatch;
    while ((urlMatch = URL_PATTERN.exec(content)) !== null) {
      // Strip trailing punctuation that's likely not part of the URL
      const url = urlMatch[0].replace(/[.,;:!?)}\]]+$/, '');
      urlSet.add(url);
    }
  }

  return {
    skillName,
    findings,
    maxSeverity: computedMaxSeverity,
    clean: findings.length === 0,
    urls: [...urlSet],
  };
}

// ── Content extraction helpers ───────────────────────────────────────────────

/**
 * Read all files from a git-cloned skill directory.
 */
export async function extractSkillFiles(skill: Skill): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  async function readDir(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && /\.(md|txt|yaml|yml|json|sh|py|js|ts|ps1|bat|cmd)$/i.test(entry.name)) {
        const content = await readFile(fullPath, 'utf-8');
        files.set(relativePath, content);
      } else if (entry.isDirectory()) {
        await readDir(fullPath, relativePath);
      }
    }
  }

  await readDir(skill.path, '');
  return files;
}

/**
 * Wrap a RemoteSkill's content in a Map for scanning.
 */
export function extractRemoteSkillFiles(remoteSkill: RemoteSkill): Map<string, string> {
  const files = new Map<string, string>();
  files.set('SKILL.md', remoteSkill.content);
  return files;
}

/**
 * Return files directly from a well-known skill.
 */
export function extractWellKnownSkillFiles(skill: {
  files: Map<string, string>;
}): Map<string, string> {
  return skill.files;
}
