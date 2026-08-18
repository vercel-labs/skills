import { describe, it, expect } from 'vitest';
import { isTrustedPackUrl } from './add.ts';

describe('isTrustedPackUrl', () => {
  it('trusts a skills.sh pack URL', () => {
    expect(isTrustedPackUrl('https://skills.sh/p/acme-foo')).toBe(true);
  });

  it('trusts a www.skills.sh pack URL', () => {
    expect(isTrustedPackUrl('https://www.skills.sh/p/acme-foo')).toBe(true);
  });

  it('rejects a skills.sh URL outside /p/', () => {
    expect(isTrustedPackUrl('https://skills.sh/other')).toBe(false);
  });

  it('rejects an untrusted host', () => {
    expect(isTrustedPackUrl('https://attacker.example/p/x')).toBe(false);
  });

  it('rejects the wrong protocol', () => {
    expect(isTrustedPackUrl('http://skills.sh/p/x')).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(isTrustedPackUrl('not a url')).toBe(false);
  });
});
