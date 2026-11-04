import { createHash } from 'crypto';
import { parseFrontmatter } from './frontmatter.ts';

/**
 * Copy lineage for `--record-lineage`: `metadata.derived-from` and
 * `metadata.derived-from-hash` in an installed SKILL.md. Semantics follow the
 * reference implementation at https://github.com/sangaraju1988/skill-derivation-graph
 * (skillgraph/hashing.py), proposed in agentskills/agentskills discussion #620.
 */

const LINEAGE_KEYS = ['derived-from', 'derived-from-hash'];

// Python's str.strip() whitespace set (not JS \s, which also matches \uFEFF and
// misses \x1c-\x1f and \x85), so hashes match the reference byte for byte.
const PY_WS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const TRAILING_WS = new RegExp(`[${PY_WS}]+$`);
const LEADING_WS = new RegExp(`^[${PY_WS}]+`);

/**
 * Normalise SKILL.md text: LF line endings, trailing whitespace stripped per
 * line, lineage keys dropped from a leading `---` frontmatter block, trailing
 * blank lines removed, exactly one trailing newline.
 */
export function normaliseSkillText(text: string): string {
  let lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(TRAILING_WS, ''));
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (end !== -1) {
    const front = lines
      .slice(1, end)
      .filter(
        (line) => !LINEAGE_KEYS.some((key) => line.replace(LEADING_WS, '').startsWith(`${key}:`))
      );
    lines = [lines[0]!, ...front, ...lines.slice(end)];
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/** `sha256:<hex>` of the normalised SKILL.md text. */
export function hashSkillText(text: string): string {
  return `sha256:${createHash('sha256').update(normaliseSkillText(text), 'utf8').digest('hex')}`;
}

/**
 * Write both lineage keys into the frontmatter `metadata` map, replacing any
 * existing values and creating `metadata` if absent. Every other line is kept
 * as is. Returns null when there is no frontmatter or the result would not
 * parse back to the expected values (e.g. a flow-style `metadata: {}`).
 */
export function setLineage(raw: string, derivedFrom: string, hash: string): string | null {
  const lines = raw.split('\n');
  const text = (i: number) => lines[i]!.replace(/\r$/, '');
  if (text(0).replace(/^\uFEFF/, '') !== '---') return null;
  let end = lines.findIndex((_, i) => i > 0 && text(i) === '---');
  if (end === -1) return null;

  const cr = lines[0]!.endsWith('\r') ? '\r' : '';
  const indentOf = (line: string) => line.length - line.trimStart().length;
  let indent = '  ';
  let insertAt: number;

  const meta = lines.findIndex((_, i) => i > 0 && i < end && /^metadata:\s*(#.*)?$/.test(text(i)));
  if (meta === -1) {
    lines.splice(end, 0, `metadata:${cr}`);
    insertAt = end + 1;
  } else {
    // The block runs until the next non-blank line at column 0.
    let last = meta;
    for (let i = meta + 1; i < end; i++) {
      const line = text(i);
      if (line.trim() === '') continue;
      if (indentOf(line) === 0) break;
      if (last === meta && !line.trimStart().startsWith('#')) {
        indent = line.slice(0, indentOf(line));
      }
      last = i;
    }
    for (let i = last; i > meta; i--) {
      const line = text(i);
      if (
        indentOf(line) === indent.length &&
        LINEAGE_KEYS.some((key) => line.trimStart().startsWith(`${key}:`))
      ) {
        lines.splice(i, 1);
        last--;
        end--;
      }
    }
    insertAt = last + 1;
  }

  lines.splice(
    insertAt,
    0,
    `${indent}derived-from: ${JSON.stringify(derivedFrom)}${cr}`,
    `${indent}derived-from-hash: ${JSON.stringify(hash)}${cr}`
  );
  const result = lines.join('\n');

  try {
    const metadata = parseFrontmatter(result).data.metadata as Record<string, unknown> | undefined;
    if (metadata?.['derived-from'] !== derivedFrom || metadata['derived-from-hash'] !== hash) {
      return null;
    }
  } catch {
    return null;
  }
  return result;
}

/**
 * Browsable base URL for a clone URL: credentials, query and a trailing `.git`
 * are dropped, and SSH/git transports map to https. Null if unrecognised.
 */
export function repoWebUrl(url: string): string | null {
  let base: string;
  const scp = url.match(/^[^@/]+@([^:/]+):(.+)$/);
  if (scp) {
    base = `https://${scp[1]}/${scp[2]}`;
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        base = `file://${parsed.pathname}`;
      } else if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        base = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } else if (parsed.protocol === 'ssh:' || parsed.protocol === 'git:') {
        // The SSH/git port says nothing about the web port, so drop it.
        base = `https://${parsed.hostname}${parsed.pathname}`;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  return base.replace(/\/+$/, '').replace(/\.git$/, '');
}
