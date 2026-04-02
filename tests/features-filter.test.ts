import { describe, it, expect } from 'vitest';
import { filterSkillContent } from '../src/features/filter.ts';
import type { FeatureDeclaration } from '../src/features/parser.ts';

const declaration: FeatureDeclaration = {
  default: ['app-router'],
  available: {
    'app-router': { description: 'App Router', section: 'App Router' },
    'pages-router': { description: 'Pages Router', section: 'Pages Router' },
    typescript: { description: 'TypeScript', section: 'TypeScript' },
  },
};

const sampleContent = `---
name: next-skill
description: Next.js skill
features:
  default: [app-router]
  available:
    app-router:
      section: App Router
    pages-router:
      section: Pages Router
    typescript:
      section: TypeScript
---

# Next.js Skill

This is the preamble that is always included.

## Getting Started

This is a non-feature section, always included.

## App Router

Use the App Router for modern Next.js apps.

### Nested Content

This nested section is part of App Router.

## Pages Router

Use the Pages Router for legacy Next.js apps.

## TypeScript

TypeScript configuration for Next.js.

## Deployment

Non-feature section about deployment.
`;

describe('filterSkillContent', () => {
  it('keeps preamble and activated feature sections', () => {
    const result = filterSkillContent(sampleContent, declaration, ['app-router']);
    expect(result).toContain('This is the preamble');
    expect(result).toContain('## App Router');
    expect(result).toContain('Nested Content');
    expect(result).not.toContain('## Pages Router');
    expect(result).not.toContain('## TypeScript');
  });

  it('keeps non-feature sections', () => {
    const result = filterSkillContent(sampleContent, declaration, ['app-router']);
    expect(result).toContain('## Getting Started');
    expect(result).toContain('## Deployment');
  });

  it('includes multiple activated features', () => {
    const result = filterSkillContent(sampleContent, declaration, ['app-router', 'typescript']);
    expect(result).toContain('## App Router');
    expect(result).toContain('## TypeScript');
    expect(result).not.toContain('## Pages Router');
  });

  it('keeps only non-feature content when no features activated', () => {
    const result = filterSkillContent(sampleContent, declaration, []);
    expect(result).toContain('This is the preamble');
    expect(result).toContain('## Getting Started');
    expect(result).toContain('## Deployment');
    expect(result).not.toContain('## App Router');
    expect(result).not.toContain('## Pages Router');
    expect(result).not.toContain('## TypeScript');
  });

  it('removes frontmatter from output', () => {
    const result = filterSkillContent(sampleContent, declaration, ['app-router']);
    expect(result).not.toContain('---');
    expect(result).not.toContain('features:');
  });

  it('handles content with no frontmatter', () => {
    const noFrontmatter = `# My Skill

Preamble here.

## App Router

Router content.

## Other Section

Other content.
`;
    const result = filterSkillContent(noFrontmatter, declaration, ['app-router']);
    expect(result).toContain('# My Skill');
    expect(result).toContain('## App Router');
    expect(result).toContain('## Other Section');
  });

  it('includes all features with full activated list', () => {
    const result = filterSkillContent(sampleContent, declaration, [
      'app-router',
      'pages-router',
      'typescript',
    ]);
    expect(result).toContain('## App Router');
    expect(result).toContain('## Pages Router');
    expect(result).toContain('## TypeScript');
  });
});
