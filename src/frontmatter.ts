import { parse as parseYaml, stringify } from 'yaml';

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
  return { data, content: match[2] ?? '' };
}

/**
 * `raw` with its frontmatter `name` set to `name`, replacing the existing
 * value (including the continuation lines of a multi-line one) or adding it
 * first. Everything else is kept byte for byte. Without frontmatter, `raw` is
 * returned unchanged.
 */
export function setFrontmatterName(raw: string, name: string): string {
  const match = raw.match(/^(\uFEFF?---(\r?\n))([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!match) return raw;
  const [whole, open, eol, body, close] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const nameLine = stringify({ name }).trimEnd();
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => /^name\s*:/.test(line));
  if (index === -1) {
    lines.unshift(nameLine);
  } else {
    let end = index + 1;
    while (end < lines.length && /^[ \t]/.test(lines[end]!)) end++;
    lines.splice(index, end - index, nameLine);
  }
  return open + lines.join(eol) + close + raw.slice(whole.length);
}
