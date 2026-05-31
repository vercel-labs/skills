---
name: skill-scanner
description: >
  Scans the agent environment and recommends the right skills for the current
  project — whether it is new or already in progress. Trigger whenever the user
  starts a new project, says "let's get started", "what do I need", "audit my
  tools", "are we well equipped", "what skills could help here", or asks about
  their current setup at any point during a project. Also trigger when the user
  opens a project folder for the first time OR returns to an existing one and
  wonders if they have the right tools. Do NOT trigger for a simple coding
  question or a direct installation request.
---

## Purpose

Act like a teammate who takes stock of available tools — whether it is day one
or month six of a project. Skills are installed incrementally over time; a
project that started without `web-fetch` may need it now. Running this audit on
an existing project is just as valuable as running it at the start.

## Step 1 — Detect project context

Read configuration files in the current directory to identify the project type
and technologies in use:

| File | Signal |
|------|--------|
| `package.json` | Node.js — read `dependencies` to detect React, Vue, Next.js, Express... |
| `requirements.txt` / `pyproject.toml` | Python — look for FastAPI, Django, scrapy, pandas, requests... |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `CLAUDE.md` | Project instructions — often reveals the main intent |
| Dominant file extensions | `.tsx/.jsx` = frontend, `.py` = Python, `.sql` = data... |

If no configuration file is found, ask the user in one sentence: "What type of
project is this?"

**Recognized project types** (non-exhaustive):
- `frontend` — React, Vue, Angular, Next.js, Svelte
- `api` — Express, FastAPI, Django REST, Go HTTP
- `scraping` — requests, BeautifulSoup, scrapy, Playwright, Selenium
- `data` — pandas, numpy, matplotlib, Jupyter, dbt, SQL
- `cli` — argparse, click, cobra, clap
- `mobile` — React Native, Flutter
- `fullstack` — frontend + backend detected together
- `skill-dev` — SKILL.md present, Claude Code skills project

## Step 2 — Inventory what is already installed

Run these two commands (in parallel if possible):

```bash
npx skills list
claude plugin list
```

Build two lists:
- **Installed skills**: exact names
- **Installed plugins**: exact names

If shell commands are unavailable (sandbox or restricted environment), fall
back to the session context (system-reminder available skills list) and note
the limitation in the report.

## Step 3 — Search for relevant skills

For the detected project type, run 1 to 2 targeted searches:

```bash
npx skills find <project-keyword>
```

Examples:
- React project -> `npx skills find frontend`
- Scraping project -> `npx skills find scraping` then `npx skills find web`
- Data project -> `npx skills find data`

Keep only results with a **meaningful popularity score** (prefer skills with
1,000+ installs or GitHub stars) — popularity signals quality in this
ecosystem.

## Step 4 — Gap analysis

Cross-reference the found skills with the already-installed skills list.
Only keep skills that are **absent** and **genuinely useful** for this project.

Selection criteria for the final recommendation:
- Directly related to the detected project type or frameworks
- Not already installed
- Clear popularity or usefulness (do not recommend obscure skills)
- Not a high-risk skill (silently exclude any marked with high/critical risk)

## Step 5 — Display the report

Standard report format:

```
[skill-scanner] Environment Audit

Project detected  : <type> (<detected frameworks>)
Installed         : <N> skills, <M> plugins

Already well-equipped for:
  - <skill-name> - <why it is relevant for this project>

Recommended skills (<N>/5 max):

1. <skill-name>
   -> <one sentence: what it brings to THIS project>
   -> npx skills add <command>

2. <skill-name>
   -> ...

Note: To install, use skill-guard — it will check the risk level before
      each installation.
```

**Special cases:**

- **Everything already installed** -> Display only:
  `All set for this project — nothing to add.`

- **No relevant skill found** -> State honestly:
  `No specific skill found for this project type on skills.sh.`

- **Project type unclear** -> Ask one short question before continuing.

## Golden rule: skill-guard integration

Never execute `npx skills add` or `claude plugin install` directly.
Present the commands in the report for the user to submit themselves —
skill-guard will trigger automatically for each installation.

The goal is to inform, not to install on behalf of the user.
