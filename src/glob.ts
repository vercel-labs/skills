import { posix } from 'path';

type MatchesGlob = (path: string, pattern: string) => boolean;

/**
 * Translates a glob into an anchored RegExp. Supports `*`, `**`, `?`,
 * `[...]` (with `!` or `^` negation) and non-nested `{a,b}` alternation.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] !== '*') {
        re += '[^/]*';
        continue;
      }
      i++;
      // `a/**/b` also matches `a/b`.
      if (pattern[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, end);
      const negate = body[0] === '!' || body[0] === '^';
      if (negate) body = body.slice(1);
      re += `[${negate ? '^/' : ''}${body.replace(/[\\\]]/g, '\\$&')}]`;
      i = end;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      const alternatives = pattern.slice(i + 1, end).split(',');
      re += `(?:${alternatives.map((a) => globToRegExp(a).source.slice(1, -1)).join('|')})`;
      i = end;
    } else {
      re += c.replace(/[.+^$()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export const fallbackMatchesGlob: MatchesGlob = (path, pattern) => globToRegExp(pattern).test(path);

/** `path.posix.matchesGlob` landed in Node 22.5; the CLI supports Node 22.2. */
export const matchesGlob: MatchesGlob =
  (posix as { matchesGlob?: MatchesGlob }).matchesGlob ?? fallbackMatchesGlob;
