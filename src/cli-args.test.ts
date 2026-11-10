import { describe, it, expect } from 'vitest';
import { parseCliArgs } from './cli-args.ts';
import { parseAddOptions } from './add.ts';

const spec = {
  global: { type: 'boolean', short: 'g' },
  yes: { type: 'boolean', short: 'y' },
  agent: { type: 'list', short: 'a', value: 'an agent name' },
  metadata: { type: 'string', value: 'a JSON value' },
} as const;

const parse = (args: string[]) => {
  const { errors, ...rest } = parseCliArgs(args, spec);
  return { ...rest, errors: errors.map((e) => e.message) };
};

describe('parseCliArgs', () => {
  it('reads space and equals forms the same for one value', () => {
    expect(parse(['--agent', 'cursor']).values).toEqual({ agent: ['cursor'] });
    expect(parse(['--agent=cursor']).values).toEqual({ agent: ['cursor'] });
    expect(parse(['-a', 'cursor']).values).toEqual({ agent: ['cursor'] });
    expect(parse(['-a=cursor']).values).toEqual({ agent: ['cursor'] });
    expect(parse(['-acursor']).values).toEqual({ agent: ['cursor'] });
  });

  it('collects following arguments for list options only in the space form', () => {
    expect(parse(['--agent', 'a', 'b', '-g', 'src'])).toMatchObject({
      values: { agent: ['a', 'b'], global: true },
      positionals: ['src'],
    });
    expect(parse(['--agent=a', 'src'])).toMatchObject({
      values: { agent: ['a'] },
      positionals: ['src'],
    });
    expect(parse(['--agent=a', '--agent', 'b', 'c']).values).toEqual({ agent: ['a', 'b', 'c'] });
  });

  it('keeps values containing = and leading dashes in the equals form', () => {
    expect(parse(['--metadata={"a":"b=c"}']).values).toEqual({ metadata: ['{"a":"b=c"}'] });
    expect(parse(['--agent=-x']).values).toEqual({ agent: ['-x'] });
  });

  it('expands grouped short switches', () => {
    expect(parse(['-gy']).values).toEqual({ global: true, yes: true });
  });

  it('treats everything after -- as positional', () => {
    expect(parse(['--agent', 'a', '--', 'b', '--global'])).toMatchObject({
      values: { agent: ['a'] },
      positionals: ['b', '--global'],
    });
  });

  it('reports missing values instead of taking the next option', () => {
    expect(parse(['--agent', '-y'])).toMatchObject({
      values: {},
      errors: ['--agent requires an agent name'],
    });
    expect(parse(['--agent=']).errors).toEqual(['--agent requires an agent name']);
    expect(parse(['-a']).errors).toEqual(['-a requires an agent name']);
    expect(parse(['--metadata']).errors).toEqual(['--metadata requires a JSON value']);
  });

  it('rejects values on boolean options', () => {
    expect(parse(['--global=true', 'src'])).toMatchObject({
      values: {},
      positionals: ['src'],
      errors: ['--global does not take a value'],
    });
  });

  it('returns unknown options without failing', () => {
    expect(parse(['--force', 'src', '--frozen-lockfile=1'])).toMatchObject({
      positionals: ['src'],
      unknown: ['--force', '--frozen-lockfile'],
      errors: [],
    });
  });

  it('ignores prototype keys that are not in the spec', () => {
    expect(parse(['--__proto__', 'x']).unknown).toEqual(['--__proto__']);
    expect(parse(['--toString=1']).unknown).toEqual(['--toString']);
  });
});

describe('parseAddOptions with equals syntax', () => {
  it('filters with --skill=<name> (#2039)', () => {
    const { source, options, errors } = parseAddOptions(['owner/repo', '--skill=foo']);
    expect(errors).toEqual([]);
    expect(source).toEqual(['owner/repo']);
    expect(options.skill).toEqual(['foo']);
  });

  it('does not take the source as an agent after --agent=<name>', () => {
    const { source, options } = parseAddOptions(['--agent=claude-code', 'owner/repo']);
    expect(source).toEqual(['owner/repo']);
    expect(options.agent).toEqual(['claude-code']);
  });
});
