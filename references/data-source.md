# Data for UI builds

UI only: no backend, API, database, or auth unless the user explicitly asks later.

## When to use real data (default if available)

Use the user's data when **any** of these are true:

- They gave a **full command** with skill names, paths, or repo layout
- The project already has `skills/**/SKILL.md` (or they pointed at this SkillCodex repo)
- They attached or pasted SKILL.md content
- They already have `src/data/skills.ts` (or similar) with real entries

**Do not** generate mock skills on top of that. Wire the UI to their files or module.

## When to add mock data

Add a small **static seed** in `src/data/skills.ts` **only** when:

- Greenfield UI with **no** skill files and **no** data module yet
- User only asked to scaffold pages/components with no content source

Keep mock minimal (e.g. 3 items mirroring this library). Tell the user to replace with real `skills/` paths when ready.

## Loading pattern

- Real data: import from filesystem at build time, or read from committed `skills/` in the monorepo, or user-provided JSON/TS
- Mock data: one file, clearly named `mockSkills` or `seedSkills`, easy to delete
- Skeletons: show while parsing/loading real files too (not only for mock)

## Still forbidden (unless user asks)

- REST/GraphQL APIs for skills
- Database
- Auth/login for browsing skills
