export type SkillFileIncludes = readonly string[];

interface CompiledRule {
  negate: boolean;
  regex: RegExp;
}

export interface SkillFileSelector {
  explicit: boolean;
  shouldInclude: (filePath: string) => boolean;
}

export function parseSkillFileIncludes(data: Record<string, unknown>): string[] | undefined {
  if (!Object.hasOwn(data, 'files')) return undefined;
  if (!Array.isArray(data.files)) return undefined;

  return data.files
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeIncludePattern)
    .filter((entry): entry is string => entry !== null);
}

export function hasExplicitSkillFileIncludes(fileIncludes: SkillFileIncludes | undefined): boolean {
  return fileIncludes !== undefined;
}

export function createSkillFileSelector(fileIncludes?: SkillFileIncludes): SkillFileSelector {
  const explicit = hasExplicitSkillFileIncludes(fileIncludes);
  const rules = explicit ? (fileIncludes ?? []).map(compileRule).filter(isCompiledRule) : [];

  return {
    explicit,
    shouldInclude(filePath: string): boolean {
      const normalized = normalizeSkillFilePath(filePath);
      if (!normalized) return false;
      if (isRootSkillMd(normalized)) return true;
      if (!explicit) return true;

      let included = false;
      for (const rule of rules) {
        if (rule.regex.test(normalized)) {
          included = !rule.negate;
        }
      }
      return included;
    },
  };
}

export function selectSkillSnapshotFiles<T extends { path: string }>(
  files: T[],
  fileIncludes?: SkillFileIncludes
): T[] {
  const selector = createSkillFileSelector(fileIncludes);
  return files.filter((file) => selector.shouldInclude(file.path));
}

export function selectSkillFileMap<T>(
  files: Map<string, T>,
  fileIncludes?: SkillFileIncludes
): Map<string, T> {
  const selector = createSkillFileSelector(fileIncludes);
  return new Map([...files].filter(([filePath]) => selector.shouldInclude(filePath)));
}

function normalizeIncludePattern(input: string): string | null {
  let pattern = input.trim();
  if (!pattern) return null;

  let negate = false;
  if (pattern.startsWith('!')) {
    negate = true;
    pattern = pattern.slice(1).trim();
  }

  while (pattern.startsWith('./')) {
    pattern = pattern.slice(2);
  }

  pattern = pattern.replace(/\/+/g, '/');
  if (!isSafePattern(pattern)) return null;
  return negate ? `!${pattern}` : pattern;
}

function normalizeSkillFilePath(filePath: string): string | null {
  let normalized = filePath.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  if (!isSafePattern(normalized)) return null;
  return normalized;
}

function isSafePattern(pattern: string): boolean {
  if (!pattern || pattern.includes('\0')) return false;
  if (pattern.startsWith('/') || pattern.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(pattern)) return false;
  if (pattern.includes('\\')) return false;

  const withoutTrailingSlash = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  if (!withoutTrailingSlash) return false;

  return withoutTrailingSlash.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function compileRule(rawPattern: string): CompiledRule | null {
  const negate = rawPattern.startsWith('!');
  const pattern = negate ? rawPattern.slice(1) : rawPattern;
  const directory = pattern.endsWith('/');
  const normalizedPattern = directory ? pattern.slice(0, -1) : pattern;
  if (!normalizedPattern) return null;

  const source = globToRegExpSource(normalizedPattern);
  return {
    negate,
    regex: new RegExp(directory ? `^${source}(?:/.*)?$` : `^${source}$`),
  };
}

function globToRegExpSource(pattern: string): string {
  let source = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*' && pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    source += escapeRegExp(char);
  }

  return source;
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function isCompiledRule(rule: CompiledRule | null): rule is CompiledRule {
  return rule !== null;
}

function isRootSkillMd(path: string): boolean {
  return path.toLowerCase() === 'skill.md';
}
