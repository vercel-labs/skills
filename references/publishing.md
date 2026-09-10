# Publishing skills (GitHub + npm)

SkillCodex skills ship in two places:

- **GitHub:** https://github.com/bh611627/skills
- **npm:** https://www.npmjs.com/package/@skillcodex/skills

## GitHub (primary)

```
skills/<skill-name>/SKILL.md
```

For: sharing, portfolios, browsing on GitHub, copying into agents.

```bash
git clone https://github.com/bh611627/skills.git
# use skills/<name>/SKILL.md in your agent
```

## npm (install skills)

```bash
npm install @skillcodex/skills
```

```ts
import contentCreator from "@skillcodex/skills/content-creator";
```

`pnpm add @skillcodex/skills` is fine if the project already uses pnpm.

Package source in this repo: `package/` (maintainers run `pnpm run sync` inside `package/`).

## Package manager

- **Skill package:** prefer **`npm install @skillcodex/skills`** in docs and UI install snippets
- **New React / Next app:** **pnpm** (`pnpm create next-app@latest …`)
- **Existing repo:** match lockfile

## vs skills.sh (what SkillCodex adds)

| skills.sh | SkillCodex |
|-----------|------------|
| Install leaderboard | **Outcomes** per skill |
| Opaque add command | Full SKILL.md + GitHub path |
| Unknown contents | Readable instructions + output rules |
| Single install path | GitHub + npm documented |

Do not fabricate download counts or stars.

## CLI ecosystem (skills.sh / Vercel)

How `npx skills` relates to [skills.sh](https://skills.sh/) and Vercel repos: [skills-ecosystem.md](./skills-ecosystem.md).

## Git workflow and version bumps

Branches, sync/build/validate, and npm version bumps: [GIT_WORKFLOW.md](../GIT_WORKFLOW.md).
