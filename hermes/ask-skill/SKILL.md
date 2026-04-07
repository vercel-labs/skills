---
name: ask
description: Ask mode for Hermes — read-only, non-mutating mode for answering questions, analyzing code, or providing explanations without making any changes.
version: 1.0.0
author: Sanath Kumar U
license: MIT
metadata:
  hermes:
    tags: [read-only, ask-mode, non-mutating, analysis, question-answering]
---

# Ask Mode

Use this skill when the user asks a question or wants analysis/explanation without any code changes or side effects.

## Core behavior

For this turn, you are in **read-only ask mode**.

- Do NOT edit any files.
- Do NOT create or modify any files on disk UNLESS EXPLICITLY ASKED by user 
- Do NOT run mutating terminal commands (commit, push, write, delete, etc.).
- Do NOT execute code or scripts.
- Do NOT create cron jobs, send messages, or trigger external actions.
- You MAY use read-only tools: `read_file`, `search_files`, `web_search`, `web_extract`, `terminal` (with read-only commands like `cat`, `grep`, `ls`), `browser_navigate`, `session_search`, `vision_analyze`.
- Do NOT use: `write_file`, `patch`, `terminal` (with write/change commands), `execute_code`, `delegate_task`, `cronjob`, `skill_manage` (write actions), etc.

## Interaction style

- Answer the question directly and concisely.
- If context inspection is needed to answer, do it with read-only tools only.
- If the question is ambiguous, ask a clarifying question.
- No preamble like "I can't do that" — just answer if possible, or say you don't know.

## Activation

Activated by:
- User says "ask mode", "read only", "just asking", "don't change anything"
- User prefixes with `/ask`
- The intent is clearly a question or analysis with no action required
