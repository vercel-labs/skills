
import assert from 'node:assert';
import { filterSkills } from '../src/skills.js';
import type { Skill } from '../src/types.js';

// Mock skill factory
function makeSkill(name: string, path: string = '/tmp/skill'): Skill {
  return { name, description: 'desc', path };
}

console.log('Running skill matching tests...');

const skills: Skill[] = [
  makeSkill('convex-best-practices'),
  makeSkill('Convex Best Practices'),
  makeSkill('simple-skill'),
  makeSkill('foo'),
  makeSkill('bar'),
];

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
    failed++;
  }
}

test('Direct match - exact case', () => {
  const result = filterSkills(skills, ['foo']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'foo');
});

test('Direct match - case insensitive', () => {
  const result = filterSkills(skills, ['FOO']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'foo');
});

test('Smart match - quoted multi-word (simulated as single arg)', () => {
  const result = filterSkills(skills, ['Convex Best Practices']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'Convex Best Practices');
});

test('Smart match - unquoted multi-word (split args)', () => {
  // Simulates: --skill Convex Best Practices -> ['Convex', 'Best', 'Practices']
  const result = filterSkills(skills, ['Convex', 'Best', 'Practices']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'Convex Best Practices');
});

test('Smart match - unquoted mixed with other args', () => {
  // Simulates: --skill Convex Best Practices foo
  const result = filterSkills(skills, ['Convex', 'Best', 'Practices', 'foo']);
  assert.strictEqual(result.length, 2);
  const names = result.map(s => s.name).sort();
  assert.deepStrictEqual(names, ['Convex Best Practices', 'foo']);
});

test('No match - partial words', () => {
  // "Convex Best" should NOT match "Convex Best Practices"
  const result = filterSkills(skills, ['Convex', 'Best']);
  assert.strictEqual(result.length, 0);
});

test('No match - broken sequence', () => {
  const result = filterSkills(skills, ['Convex', 'Practices']);
  assert.strictEqual(result.length, 0);
});


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
