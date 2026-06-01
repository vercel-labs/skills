import { parse as parseYaml } from 'yaml';

/**
 * Strip leading HTML comments + blank lines so frontmatter can be preceded by
 * provenance / attribution / license headers without breaking the parser.
 *
 * Without this, a SKILL.md like:
 *
 *   <!-- Absorbed from upstream/repo (MIT). -->
 *   ---
 *   name: my-skill
 *   description: ...
 *   ---
 *
 * is silently skipped: the regex below anchors `---` at byte 0, so the leading
 * comment kills the match and the file is treated as body-only with no
 * extracted name/description. Downstream that means the skill never surfaces
 * in the install picker.
 *
 * Matches: leading whitespace, any number of `<!-- ... -->` blocks (single- or
 * multi-line), and any blank lines between them. Stops as soon as it hits the
 * first non-comment / non-whitespace character.
 */
function stripLeadingCommentsAndWhitespace(raw: string): string {
  // Repeated whitespace runs OR HTML-comment blocks. `+` lets us no-op when the
  // file already starts with `---` (no match -> replace returns input unchanged).
  return raw.replace(/^(?:\s+|<!--[\s\S]*?-->)+/, '');
}

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 *
 * Tolerates leading HTML comments + blank lines before the frontmatter so
 * authors can preserve provenance / attribution / license headers above the
 * frontmatter without the parser silently skipping the skill.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const stripped = stripLeadingCommentsAndWhitespace(raw);
  const match = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
  return { data, content: match[2] ?? '' };
}
