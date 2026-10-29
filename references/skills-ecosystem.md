# skills.sh, Vercel CLI, and contributing

## Three different repos (do not confuse them)

| Repo | What it is |
|------|------------|
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | The **`npx skills` CLI** and a small **`skills/`** tree of bundled agent skills (e.g. [`find-skills`](https://github.com/vercel-labs/skills/tree/main/skills/find-skills)). PR new skills **into a fork of this repo**; see SkillCodex [`contrib/vercel-labs-skills`](../contrib/vercel-labs-skills/README.md). |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Vercel’s **official skill collection** (`react-best-practices`, `web-design-guidelines`, etc.). Listed on [skills.sh](https://skills.sh/). |
| **Your repo** `bh611627/skillcodex` | **SkillCodex** - your skills. Install the same way: `npx skills add owner/repo`. |

## Use SkillCodex today (no Vercel merge needed)

Anyone can install from your GitHub URL:

```bash
npx skills add https://github.com/bh611627/skills --skill web-design-guidelines
npx skills add bh611627/skills --list
```

Same CLI as Vercel’s docs describe for [agent-skills](https://github.com/vercel-labs/agent-skills#installation). **SkillCodex publishing:** npm vs skills.sh leaderboard is documented in [docs/publishing-skills-sh-and-npm.md](../docs/publishing-skills-sh-and-npm.md) (aligned with [skills.sh/docs](https://www.skills.sh/docs)).

## Publish your design skill into **agent-skills** (PR workflow)

Target repo: **[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)** (not `vercel-labs/skills`). Maintainers review PRs; nothing is guaranteed until merged.

### Naming (required)

Upstream **already has** [`skills/web-design-guidelines/`](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) - it only audits against Vercel’s [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines). Your SkillCodex skill **adds doc-UI build + audit** and must use a **new folder name** so it does not collide.

**Recommended slug:** `skillcodex-doc-ui` (kebab-case; matches “documentation-style UI + guidelines” and stays distinct from Vercel’s audit-only skill).

Alternatives if maintainers prefer: `skillcodex-documentation-ui`, `nextjs-doc-ui-guidelines`.

The `name:` field in YAML frontmatter **must** match the directory name.

### Self-contained bundle

Skills in that repo are **folders under `skills/`**, not links to your repo. Copy content in so `SKILL.md` references work without leaving the skill folder:

| Source (this repo) | Upstream path |
|--------------------|---------------|
| `skills/web-design-guidelines/SKILL.md` | `skills/skillcodex-doc-ui/SKILL.md` (edit paths + frontmatter; see below) |
| `references/design-guidelines.md` | `skills/skillcodex-doc-ui/references/design-guidelines.md` |
| `references/react-stack.md` | `skills/skillcodex-doc-ui/references/react-stack.md` |
| `references/data-source.md` | `skills/skillcodex-doc-ui/references/data-source.md` |

In `SKILL.md`, change links like `../../references/design-guidelines.md` to `./references/design-guidelines.md` (or `references/design-guidelines.md`).

### Frontmatter (match upstream style)

Align with existing skills in `agent-skills` (see [`composition-patterns/SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/main/skills/composition-patterns/SKILL.md)): include `license: MIT` and `metadata: author:` / `version:`. Move long SkillCodex-only keys (`outcomes`, `stack`, …) into the body if reviewers want a **compact upstream-style** YAML block.

Put a **single, specific** `description:` line (triggers like “build doc UI”, “audit documentation UI”, “SkillCodex-style browser”).

### Zip + README (repo convention)

Their [AGENTS.md](https://github.com/vercel-labs/agent-skills/blob/main/AGENTS.md) documents packaging other skills with a zip next to the folder:

```bash
cd skills
zip -r skillcodex-doc-ui.zip skillcodex-doc-ui/
```

Several skills ship a `.zip` beside the directory; include the zip in the PR if you want parity with `web-design-guidelines.zip` etc.

Add an **“skillcodex-doc-ui”** subsection to the repo’s root **`README.md`** (same pattern as **web-design-guidelines** or **react-best-practices**: when to use, categories, one install line). The install command for users stays:

```bash
npx skills add vercel-labs/agent-skills
```

- after merge, your skill ships with the bundle; optionally users can still use `npx skills add bh611627/skills --skill web-design-guidelines` for your standalone repo.

### Git steps

1. Fork **vercel-labs/agent-skills** on GitHub.
2. Clone your fork, branch: `git checkout -b add-skillcodex-doc-ui`.
3. Add `skills/skillcodex-doc-ui/` (+ optional zip), edit root `README.md`.
4. `git push -u origin add-skillcodex-doc-ui`
5. Open PR **from your fork → `vercel-labs/agent-skills` `main`**.

### PR description template (paste and fill in)

```markdown
## Summary
- Adds **skillcodex-doc-ui**: build SkillCodex-style documentation UIs (Next, Tailwind, motion, skeletons) and/or audit against included reference docs.
- Does **not** replace existing **web-design-guidelines** (Vercel audit vs WIG); complements it for doc-site implementation.

## Source
Derived from [bh611627/skillcodex](https://github.com/bh611627/skills) (MIT). References co-located under `skills/skillcodex-doc-ui/references/`.

## Test plan
- [ ] `npx skills add <my-fork>/agent-skills` lists / installs new skill locally
- [ ] Links in SKILL.md resolve under `skills/skillcodex-doc-ui/`
```

Optional: open an **Issue** first (“Proposal: add SkillCodex doc UI skill”) if you want maintainer feedback before the full PR.

## Get listed on skills.sh

The directory at [skills.sh](https://skills.sh/) aggregates skills from **public GitHub repos** that work with `npx skills add`. You do **not** need to merge into `agent-skills` to be installable - any valid repo with `skills/*/SKILL.md` works. Broader discovery on skills.sh may depend on their indexing (not controlled from this repo).

## Summary

| Goal | Action |
|------|--------|
| Users install SkillCodex skills | Share: `npx skills add bh611627/skills --skill <name>` |
| Ship npm modules | `npm publish` for `@skillcodex/skills` ([publishing.md](./publishing.md)) |
| Contribute to Vercel’s bundle | PR to **agent-skills**, not **skills** (CLI) |
