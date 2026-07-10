---
name: find-skills
description: >
  Use when the user explicitly asks to discover, search, compare, or install
  agent skills, or wants an installable extension for a recurring capability.
  Trigger for "find a skill for X", "is there a skill that can...", and "extend
  this agent". NOT for ordinary how-to or "can you do X" requests that can be
  completed directly without searching the skills ecosystem.
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Says "find a skill for X" or "is there a skill for X"
- Explicitly asks to search or compare installable skills
- Wants to extend the agent with a reusable capability
- Wants installable tools, templates, or workflows from the skills ecosystem
- Describes a recurring gap and asks whether a skill could cover it

Do not trigger merely because a task is specialized. If the user asked to do the
task and it can be completed directly, do the task.

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query] [--owner <owner>]` - Search for skills interactively or by keyword, optionally scoped to a GitHub owner
- `npx skills add <package>` - Install a skill from GitHub or other sources
- `npx skills check` - Check for skill updates
- `npx skills update` - Update all installed skills

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Use the Leaderboard as a Discovery Hint

The [skills.sh leaderboard](https://skills.sh/) can surface established candidates,
but it is not a quality or safety gate. Do not exclude a better task fit merely
because it has fewer installs.

### Step 3: Search for Skills

If the leaderboard doesn't cover the user's need, run the find command:

```bash
npx skills find [query] [--owner <owner>]
```

For example:

- User asks "find me a skill for React performance" → `npx skills find react performance`
- User asks "compare installable PR-review skills" → `npx skills find pr review`
- User asks "is there a reusable changelog skill?" → `npx skills find changelog`

### Step 4: Verify Quality Before Recommending

**Do not recommend a skill based solely on search results.** Inspect the actual
package first:

1. Read its `SKILL.md` and confirm the trigger, outcome, and NOT-for boundary fit
   the user's recurring need.
2. Follow every directly referenced file needed for the normal path. Verify that
   paths exist and that required scripts, templates, dependencies, and commands
   match the package layout.
3. Inspect executable scripts and installation instructions for network access,
   secret handling, external writes, destructive behavior, or user-wide changes.
   Do not infer authority for those actions from the skill.
4. Check whether the documented APIs and commands fit the user's current harness
   and appear maintained. If inspection is incomplete, label the recommendation
   unverified instead of presenting it as safe for unattended installation.
5. Use installs, stars, publisher reputation, and leaderboard position only as
   secondary adoption or maintenance signals after package fit and behavior.

### Step 5: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. What package files were inspected and any material side effects or gaps
3. The current install count and source as secondary context
4. The install command they can run
5. A link to learn more at skills.sh

Example response:

```
I found a skill that might help! The "react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.
I checked its SKILL.md and normal-path references for fit and side effects.

To install it:
npx skills add vercel-labs/agent-skills@react-best-practices

Learn more: https://skills.sh/vercel-labs/agent-skills/react-best-practices
```

### Step 6: Offer to Install

If the user wants to proceed, you can install the skill for them:

```bash
npx skills add <owner/repo@skill> -g -y
```

The `-g` flag installs globally (user-level) and `-y` skips confirmation prompts.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user could create their own skill with `npx skills init`

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, you could create your own skill:
npx skills init my-xyz-skill
```

## Gotchas

- Install counts, stars, and leaderboard position are adoption signals, not proof
  that a skill is safe, current, or suitable. Inspect the package before
  recommending it.
- `npx skills add ... -g -y` changes user-wide agent state without another
  confirmation prompt. Run it only when the user explicitly asked to install.
- A narrow failed query is not evidence that no skill exists. Try one meaningful
  synonym or category query, then stop and offer direct help.
