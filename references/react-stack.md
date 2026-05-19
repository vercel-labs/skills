# React stack

Frontend only. Details: [stack-nextjs.md](./stack-nextjs.md). UI/icons: [design-guidelines.md](./design-guidelines.md).

## Package managers

| Use case | Command |
|----------|---------|
| **Install SkillCodex skills** | `npm install @skillcodex/skills` |
| **New React / Next doc UI** | **pnpm** (fast; default for SkillCodex UI) |
| **User's existing project** | **Match their lockfile** - pnpm if `pnpm-lock.yaml`, npm if `package-lock.json`, yarn if `yarn.lock` |

## When to ask

| Situation | Action |
|-----------|--------|
| Greenfield, user did not name stack | Ask once: Next (default) or Vite? |
| User named Next, npm, pnpm, etc. | Do not ask |
| Lockfile exists | Match lockfile |

Default for **new apps**: **pnpm + Next.js + TypeScript + Tailwind v4**.

## Greenfield install

```bash
pnpm create next-app@latest app --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
pnpm add framer-motion react-markdown remark-gfm react-icons
# framer-motion is required for SkillCodex UI motion (see design-guidelines.md)
```

Optional (user asks for emoji picker):

```bash
pnpm add @emoji-mart/react @emoji-mart/data
```

Emoji Mart: `set="apple"` per [design-guidelines.md](./design-guidelines.md).

## Rules

- `.tsx` only
- Skill data: real files when user has them; mock seed only if none ([data-source.md](./data-source.md))
- No backend, DB, or auth unless user explicitly requests later
