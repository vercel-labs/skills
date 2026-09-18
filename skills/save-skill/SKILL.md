| name | save-skill |
|------|------------|
| description | Helps users create and save new agent skills by guiding them through the skill creation process, generating the SKILL.md file with the correct format, and committing it to GitHub via a fork and pull request. Use this skill when the user wants to teach Claude a new capability, create a custom skill, or add a skill to the open agent skills ecosystem. |

# Save Skill

This skill helps you create new agent skills and save them to the open agent skills ecosystem by generating a properly formatted `SKILL.md` file and submitting it via a GitHub Pull Request.

## When to Use This Skill

Use this skill when the user:

- Says "I want to teach you a new skill" or "I want to save a skill to you"
- Asks "how do I create a new skill?"
- Wants to add a custom capability to Claude's skill library
- Says "create a skill that can do X"
- Wants to contribute a new skill to the `vercel-labs/skills` repository

## What is a Skill?

A skill is a `SKILL.md` file inside a named folder under `skills/` in the `vercel-labs/skills` repository. Each skill contains:

- A metadata table with `name` and `description`
- A title and overview
- A "When to Use" section
- Step-by-step instructions for the agent to follow

## How to Create and Save a New Skill

### Step 1: Understand What the Skill Should Do

Ask the user:
- What task should this skill perform?
- On which website or tool does it operate?
- What are the key steps involved?

### Step 2: Generate the SKILL.md Content

Use this template:

```markdown
| name | skill-name |
|------|------------|
| description | Short description of when to use this skill. |

# Skill Title

Brief overview of what this skill does.

## When to Use This Skill

Use this skill when the user:
- [condition 1]
- [condition 2]

## How to Use This Skill

### Step 1: [Step title]
[Instructions]

### Step 2: [Step title]
[Instructions]
```

### Step 3: Fork the Repository

Navigate to https://github.com/vercel-labs/skills/fork and create a fork in the user's GitHub account.

### Step 4: Create the File

1. Go to: `https://github.com/{username}/skills/new/main/skills/{skill-name}`
2. Name the file `SKILL.md`
3. Paste the generated content
4. Click **Commit changes**

### Step 5: Open a Pull Request

1. Navigate to the fork on GitHub
2. Click **Contribute -> Open pull request**
3. Add a descriptive title and description
4. Submit the Pull Request to `vercel-labs/skills`

## Tips

- Keep skill names lowercase with hyphens (e.g., `save-skill`, `find-skills`)
- The `description` field in the metadata table is used by the agent to decide when to activate the skill -- make it clear and specific
- Skills should be focused on a single domain or task
- Always verify the skill works before submitting the PR
