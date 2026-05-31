---
name: skill-guard
description: >
  Security guard for Claude Code skill and plugin installations — with two
  modes. (1) INTERCEPT mode: trigger IMMEDIATELY whenever the user asks to
  install a Claude plugin (claude plugin install), a skill (npx skills add),
  or any equivalent — even if the user types the command directly. Display a
  risk pictogram and block if risk is detected. (2) AUDIT mode: trigger when
  the user asks "are my skills safe?", "audit my installed skills", "scan my
  environment for risks", "what did I install?", or just installed skill-guard
  for the first time. Never let an installation pass without a risk report.
---

## Two modes

skill-guard works in two complementary modes:

- **Intercept mode** — checks risk BEFORE (or during) a new installation
- **Audit mode** — scans everything ALREADY installed and flags risks

---

## INTERCEPT MODE — Before a new installation

### Step 1 — Identify the package

Extract from the request:
- **Package name** (e.g. `code-review`, `find-skills`)
- **Source** (e.g. `claude-plugins-official`, `vercel-labs/skills`, GitHub URL)
- **Command type**: `claude plugin install` or `npx skills add`

### Step 2 — Collect risk data

**Case A: `claude plugin install X@marketplace`**

Run before installing:
```
claude plugin details X@marketplace
```
Inspect the inventory for red flags:
- Hooks present (automatic execution)
- MCP servers present (network access)
- Bash scripts executed at install time
- Unusual permissions

External scanners (Socket, Snyk) are not available for this channel.
Compensate with structural inventory analysis + web search if in doubt.

**Case B: `npx skills add <repo> --skill <name>`**

Socket/Snyk scores appear in the installation output before files are written
to disk. Two-phase protocol:

Phase 1 — Quick pre-check: WebFetch `https://skills.sh/<org>/<repo>` for
published risk scores. If unavailable (client-side rendered), go to Phase 2.

Phase 2 — Intercept during install: run the command and watch the output for
the "Security Risk Assessments" section:
```
Security Risk Assessments
  <skill-name>  <Gen>  <Socket>  <Snyk>
  Details: https://skills.sh/<org>/<repo>
```
As soon as these scores appear, apply the risk rule below.
If risk detected: show report, ask for confirmation.
If user declines: immediately run `npx skills remove <name> -y`.

**Web search fallback** (if data is insufficient):
```
<package-name> security vulnerability site:socket.dev OR site:snyk.io
```

### Step 3 — Apply the risk rule

| Icon | Level | Condition |
|------|-------|-----------|
| ✅ | Safe | Safe + 0 alerts across all available scanners |
| ⚠️ | Medium risk | Medium Risk on at least one scanner |
| ❌ | High risk | High or Critical Risk on at least one scanner |
| ❓ | Unknown | No risk data available |

### Step 4 — Display the report and act

```
[ICON] <package-name>
  Source   : <marketplace or URL>
  Scanners : Gen=[result] - Socket=[result] - Snyk=[result]
  Details  : <URL if available>
```

- **Safe**: proceed with installation.
- **Medium risk**: ask "A medium risk was detected. Do you still want to install?"
  Do not proceed without explicit confirmation.
- **High risk**: warn strongly. Recommend against installing.
  Ask for explicit confirmation. If already installed, offer immediate removal.
- **Unknown**: state that risk data is unavailable and ask for confirmation.

---

## AUDIT MODE — Scan what is already installed

Trigger this mode when the user asks about the safety of their current
environment — especially right after installing skill-guard for the first time.

### Step 1 — Inventory everything installed

Run in parallel:
```bash
npx skills list
claude plugin list
```

Build a complete list: every installed skill and plugin by name.

### Step 2 — Check each item for risk

For each **plugin** (`claude plugin install` origin):
```
claude plugin details <plugin-name>
```
Look for: hooks, MCP servers, bash scripts, unusual permissions.

For each **skill** (`npx skills add` origin):
Try `https://skills.sh/<org>/<name>` via WebFetch to retrieve risk scores.
If risk scores are unavailable, mark as ❓ Unknown — but do NOT stop there.
For every ❓ item, fetch its social proof data (see Step 2b below).

Run checks in parallel to keep the audit fast.

### Step 2b — Social proof for ❓ Unknown items

When risk data is unavailable for a skill or plugin, collect trust signals
from GitHub to help the user decide. These signals replace missing scanner
data with real-world adoption evidence.

For GitHub-based skills, query the GitHub API:
```
gh api repos/<owner>/<repo>
```
Extract and display:
- **Install count** — from skills.sh page if available (`X installs`)
- **GitHub stars** — `stargazers_count`
- **Created** — `created_at` (how old is this project?)
- **Last updated** — `pushed_at` (is it actively maintained?)
- **Open issues** — `open_issues_count` (sign of community activity)
- **Author** — `owner.login` (known maintainer or anonymous?)

Interpret the signals and assign a confidence tier:

| Tier | Verdict | Signals |
|------|---------|---------|
| **Community-trusted** | "Trusted by the community — install with confidence" | 10k+ installs AND 2+ years old AND recent update AND known author |
| **Promising** | "Good adoption, looks healthy" | 1k+ installs AND 6+ months old AND maintained |
| **Cautious** | "Low adoption — review before installing" | <1k installs OR <3 months old OR no recent update |
| **Risky** | "Very new or abandoned — treat with caution" | <100 installs AND <1 month old OR last update >1 year ago |

Well-known authors (vercel-labs, anthropics, google, microsoft, etc.) bump
the tier up by one level regardless of other signals — reputation matters.
Never penalize a skill for unknown scanner data if the community signals
are strongly positive. Social proof at scale IS a form of validation.

For Claude plugins with unknown risk, run `claude plugin details` and report
the full component inventory (hooks, MCP servers, scripts) as a proxy for
trust — the structure itself tells a story.

### Step 3 — Produce the security report

```
[skill-guard] Security Audit
=================================
Installed: <N> skills   <M> plugins

SKILLS
  ✅ <name>  — <source / reason safe>
  ⚠️ <name>  — <scanner> <risk level> — consider removing
  ❌ <name>  — HIGH RISK — strongly recommend removal
  ❓ <name>  — no scanner data — <stars> stars, <installs> installs,
             created <date>, last update <date>, by @<author>

PLUGINS
  ✅ <name>  — <inventory summary: no hooks, no MCP>
  ⚠️ <name>  — <red flag found>

SUMMARY
  <N> safe   <N> medium risk   <N> high risk   <N> unknown

RECOMMENDED ACTIONS
  - Remove: <list of high-risk items>
  - Review: <list of medium-risk items>
  - No action: <all-clear items>
```

### Step 4 — Offer actions for flagged items

**For ⚠️ and ❌ items:**
- Explain clearly why it is flagged
- Offer the removal command but do NOT run it automatically
- Let the user decide

```
To remove <name>: npx skills remove <name> -y
             or: claude plugin uninstall <name>
```

**For ❓ Unknown items:**
Display the social proof summary and let the user judge:

```
❓ <name> — no scanner data available
   Installs  : <number> (skills.sh)
   Stars     : <number> (GitHub)
   Created   : <date> (<age>)
   Updated   : <date> (<time since last update>)
   Author    : @<owner> (<link>)
   Verdict   : <tier> — <one-sentence assessment>
              e.g. "⚠️  Cautious   — Only 3 installs, created last week, unknown author"
              e.g. "👍 Promising  — 2k installs, 8 months old, maintained"
              e.g. "✅ Trusted    — 45k installs, 2 years old, active, @vercel-labs"
```

Do not recommend removal for ❓ items based on unknown data alone —
let the social proof guide the user's own judgment.

---

## Self-assessment — Mandatory closing of every audit

At the end of every audit report, skill-guard must evaluate itself using the
exact same criteria it just applied to every other skill. No exceptions.

Fetch skill-guard's own live data from GitHub:
```
gh api repos/baalyerob/skill-guard
```
Apply the full social proof analysis (installs, stars, age, last update,
author, scanner data) and assign a tier using the same logic as Step 2b.

Then close the report with this block:

```
---------------------------------------------
[skill-guard] Honest self-assessment
---------------------------------------------
If this evaluation were applied to skill-guard today:

  Scanner data : [result — likely Unknown for now]
  Installs     : [N from skills.sh]
  Stars        : [N from GitHub]
  Created      : [date] ([age])
  Last update  : [date]
  Author       : @baalyerob (individual, not an organization)

  Verdict : [tier icon] [tier name] — [honest one-sentence assessment]

  "[A sincere closing sentence in first person — e.g.:
   'I am a young tool with no scanner validation yet.
    Use your own judgment — and watch my GitHub for growth.']"
---------------------------------------------
```

This self-assessment must be honest even when unflattering. A new skill with
zero installs and no scanner data should say so clearly. Trust is built through
transparency, not by hiding inconvenient truths about oneself.

The closing sentence should be written in the first person ("I"), sincere,
and acknowledge both the limitations and the intent of the tool.

---

## Absolute rule

Never skip a risk check — whether for a new installation or an audit of
existing ones. The user's security takes priority over speed.
