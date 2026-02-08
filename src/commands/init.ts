import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import pc from 'picocolors';
import { logger } from '../utils/logger.ts';

export function runInit(args: string[]): void {
  const cwd = process.cwd();

  // Parse --type flag
  let cognitiveType: 'skill' | 'agent' | 'prompt' = 'skill';
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-t' || arg === '--type') && i + 1 < args.length) {
      const typeVal = args[i + 1]!;
      if (typeVal === 'skill' || typeVal === 'agent' || typeVal === 'prompt') {
        cognitiveType = typeVal;
      }
      i++;
    } else if (arg && !arg.startsWith('-')) {
      filteredArgs.push(arg);
    }
  }

  const itemName = filteredArgs[0] || basename(cwd);
  const hasName = filteredArgs[0] !== undefined;

  const fileNames: Record<string, string> = {
    skill: 'SKILL.md',
    agent: 'AGENT.md',
    prompt: 'PROMPT.md',
  };
  const fileName = fileNames[cognitiveType]!;

  const itemDir = hasName ? join(cwd, itemName) : cwd;
  const itemFile = join(itemDir, fileName);
  const displayPath = hasName ? `${itemName}/${fileName}` : fileName;

  if (existsSync(itemFile)) {
    logger.log(`${cognitiveType} already exists at ${pc.dim(displayPath)}`);
    return;
  }

  if (hasName) {
    mkdirSync(itemDir, { recursive: true });
  }

  let content: string;
  if (cognitiveType === 'agent') {
    content = `---
name: ${itemName}
description: A brief description of this agent
---

# ${itemName}

Agent instructions here.

## Role

Describe the agent's role and capabilities.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;
  } else if (cognitiveType === 'prompt') {
    content = `---
name: ${itemName}
description: A brief description of this prompt
---

# ${itemName}

Prompt template content here.

## Context

Describe when this prompt should be used.

## Template

Your prompt template goes here.
`;
  } else {
    content = `---
name: ${itemName}
description: A brief description of what this skill does
---

# ${itemName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;
  }

  writeFileSync(itemFile, content);

  logger.log(`Initialized ${cognitiveType}: ${pc.dim(itemName)}`);
  logger.line();
  logger.dim('Created:');
  logger.log(`  ${displayPath}`);
  logger.line();
  logger.dim('Next steps:');
  logger.log(`  1. Edit ${pc.cyan(displayPath)} to define your ${cognitiveType} instructions`);
  logger.log(`  2. Update the ${pc.cyan('name')} and ${pc.cyan('description')} in the frontmatter`);
  logger.line();
  logger.dim('Publishing:');
  logger.log(
    `  ${pc.dim('GitHub:')}  Push to a repo, then ${pc.cyan(`npx synk add <owner>/<repo>`)}`
  );
  logger.log(
    `  ${pc.dim('URL:')}     Host the file, then ${pc.cyan(`npx synk add https://example.com/${displayPath}`)}`
  );
  logger.line();
}
