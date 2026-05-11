export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  return trimmed;
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  let currentObject: Record<string, unknown> | null = null;
  let currentArray: unknown[] | null = null;
  let currentKey: string | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (indent > 0 && currentKey) {
      if (trimmed.startsWith('- ')) {
        if (!currentArray) {
          currentArray = [];
          root[currentKey] = currentArray;
        }
        currentArray.push(parseScalar(trimmed.slice(2)));
        continue;
      }

      const nestedMatch = trimmed.match(/^([^:]+):(?:\s*(.*))?$/);
      if (nestedMatch) {
        if (!currentObject) {
          currentObject = {};
          root[currentKey] = currentObject;
        }
        currentObject[nestedMatch[1]!.trim()] = parseScalar(nestedMatch[2] ?? '');
      }
      continue;
    }

    currentObject = null;
    currentArray = null;
    currentKey = null;

    const match = trimmed.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1]!.trim();
    const value = match[2] ?? '';
    if (value === '') {
      currentKey = key;
      root[key] = {};
    } else {
      root[key] = parseScalar(value);
    }
  }

  return root;
}

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = parseSimpleYaml(match[1]!);
  return { data, content: match[2] ?? '' };
}
