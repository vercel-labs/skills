# Next.js + React (frontend only)

Short ref for agents. **New React/Next project → pnpm.** Install SkillCodex skills with **npm** (`npm install @skillcodex/skills`). If a lockfile exists, match it.

## Pick your setup

| Project | Start with |
|---------|------------|
| **Marketing / docs / app (default)** | Next.js App Router |
| Small SPA, no SEO routing | Vite + React (bottom of this file) |

## Next.js greenfield (recommended)

```bash
pnpm create next-app@latest my-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
cd my-app && pnpm install
```

### Versions to target (stable, 2026)

| Package | Use |
|---------|-----|
| node | 20 or 22 LTS |
| pnpm | 10.x |
| next | 15.x (latest stable) |
| react / react-dom | 19.x |
| typescript | 5.x, `strict: true` |
| tailwindcss | 4.x via `@tailwindcss/postcss` |

### Rules

- **Only `.tsx`** - don’t add `.jsx` files
- App Router: `src/app/` for routes, `src/components/` for UI
- Use `export const metadata` or `generateMetadata` for SEO - not a hand-rolled `<head>` in client components
- Images: `next/image` with `width` + `height` (helps LCP and CLS)
- Fonts: `next/font` (avoids layout shift)
- Data: Server Components by default; `"use client"` only when you need hooks or browser APIs

### Useful commands

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
```

## Tailwind v4 (Next)

In `postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

In `src/app/globals.css`:

```css
@import "tailwindcss";
```

Theme tokens live in CSS variables in the same file - keeps light/dark simple.

## Vite + React (when not using Next)

```bash
pnpm create vite@latest my-app --template react-ts
```

Same rules: TS strict, `.tsx` only, Tailwind v4 with `@tailwindcss/vite`.

## Dev server (Next 15+)

**Turbopack** is commonly the default for `pnpm dev` on new apps - faster HMR. Production `pnpm build` still validates the full webpack/Rust pipeline your host uses; always run **`build` in CI** even if local dev uses Turbopack.

## Error and loading files

Use `error.tsx`, `not-found`, `loading.tsx`, and `global-error.tsx` per route segment - see SkillCodex skill **`error-loading-not-found`** for UX and logging boundaries. For **structured logs, correlation IDs, and PII rules**, see **`observability-handbook`**.

## Motion

`framer-motion` v12 - animate `opacity` and `transform` only. Skip `transition: all`.
