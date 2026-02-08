import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

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
    console.log(`${TEXT}${cognitiveType} already exists at ${DIM}${displayPath}${RESET}`);
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

  console.log(`${TEXT}Initialized ${cognitiveType}: ${DIM}${itemName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(
    `  1. Edit ${TEXT}${displayPath}${RESET} to define your ${cognitiveType} instructions`
  );
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx synk add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx synk add https://example.com/${displayPath}${RESET}`
  );
  console.log();
}
