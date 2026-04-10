## Background Context

This is the repo for the Vercel `skills` CLI.

[Agent Skills](https://agentskills.io/home) are a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows. At its core, a skill is a folder containing a SKILL.md file. This file includes metadata (name and description, at minimum) and instructions that tell an agent how to perform a specific task. Skills can also bundle scripts, templates, and reference materials.

Agent harnesses that support the SKILL.md spec typically look for and load agent skills in two places: (1) the user's home folder (~), and (2) the repo in which the `skills` CLI was invoked. Harnesses load skills using the concept of "progressive disclosure", meaning that when an agent session is started, the harness loads skill metadata (`name` and `description`) into the context window up front.

When the agent sees this metadata, it can decide on it's own which skills are most relevant to the task at hand and load the full skill contents.

To understand the relationship between the `skills` CLI and agent skills, you can roughly think of it as:

> The `skills` CLI is to agent skills what npm is to Node.

## Problem

When the SKILL.md spec introduced the concept of progressive disclosure, it was a simple yet effective leap forward for context management.

However, prematurely bloating the context window can still be a problem if the user has lots of skills installed. For example:

The average agent skill contributes approximately 65 tokens to the frontloaded skill index that is inserted into the context window. This means that it takes roughly ~150 installed skills in order for the skill index to eat around ~10,000 tokens.

150 skills might sound like a lot, but they can accumulate quickly.

## Solution

Currently, the API / command surface of the `skills` CLI allows for the essentials (e.g. `add`, `update`, `remove`, etc.). However, what is lacking is the ability to **manage** skills at a more granular level. The `skills` CLI lacks...

- The concept of disabling a skill without actually uninstalling it
- The notion of skill groups

Adding granular skills management features to the `skills` CLI helps to resolve the core tension described in the problem statement. It allows users to install as many skills as they want while still allowing the user a degree of control over the context window.

Any new commands related to skills management must be compatible with and orthogonal to all existing features (e.g. `skills update`, `skills install`, etc.) and the `skill-lock.json` file.

## Your Task

**First**, explore this repo and ensure you have a solid understanding of each command that the CLI exposes, including any flags and how it relates to the lockfile.
**Second**, engage in a Q&A session with me, asking several questions at a time so that we can iteratively refine the design. When you ask a question, also provide a few proposed directions or answers that I can quickly choose from.
**Third**, when the Q&A session is complete, synthesize our discussion into a cohesive and thorough design doc saved to the root of this repo.
