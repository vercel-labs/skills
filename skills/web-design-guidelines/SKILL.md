---
name: web-design-guidelines
description: Web design for documentation-style UIs - build or audit per SkillCodex design rules (React, TypeScript, Tailwind). Use for doc browsers, skill directories, UI review, testimonials with avatars, and accessible buttons. Prefer CSS motion on div; avoid motion.div in server components.
version: "2.1.0"
tags:
  - ui
  - design-system
  - accessibility
  - react
  - documentation
---

# Web design guidelines (SkillCodex doc UI)

This skill merges **doc UI implementation** (build) and **UI review (audit)**.

Canonical rules live at **SkillCodex** (design-guidelines):  
https://github.com/bh611627/skillcodex/blob/main/references/design-guidelines.md  

**STRICT UI ONLY** - no backend, API, database, or auth logic.

**Stack (React only):** **React** + **TypeScript** + **Tailwind CSS** + **react-markdown** + **remark-gfm** + **react-icons**. Use **optional** `framer-motion` only in **Client Components** / client files. If the app uses **Next.js**, use `next/image` and `next/link` where applicable; in **Vite** or **CRA**, use standard `<img>` (or a small wrapper) and `react-router`/`<a>` - same layout and Tailwind rules apply.

---

## Motion: use `<div>` first; fix `motion.div` errors

**Default:** implement hover, fade, and lift with **`<div>`** + Tailwind (`transition-[transform,opacity]`, `hover:-translate-y-0.5`, `motion-reduce:transform-none`). This avoids common build and runtime issues.

**If using framer-motion:** `motion` only runs in the browser.

- **Next.js App Router:** any file using `motion.div` must start with **`'use client'`** and import:  
  `import { motion } from "framer-motion"`  
  Do **not** use `motion.*` in **Server Components** - that causes errors. Either move the animated piece into a small client child or replace with a plain **`<div>`** + Tailwind.
- **Type / lint errors on `motion.div`:** prefer replacing with **`<div className="...">`** using the same transition classes as in design-guidelines. Reserve `motion` for enter/exit animations that truly need the library.
- **Always** honor **`prefers-reduced-motion`** (Tailwind `motion-reduce:*` or Framer `useReducedMotion`).

---

## Mode A - Build / implement doc UI

Use when the user wants a **premium documentation-style** interface (browse, search, detail, **outcomes** visible - **no fake install counts**).

1. Apply **design-guidelines** end-to-end:  
   https://raw.githubusercontent.com/bh611627/skillcodex/main/references/design-guidelines.md  
   Include **testimonials** with **avatar images** (`alt` required) and **buttons** with **`cursor-pointer`**, hover, **`focus-visible`**.
2. **Tailwind-first**, mobile-first, mandatory **skeleton loaders** on async surfaces (use `<div className="animate-pulse ...">`, not `motion` for skeletons).
3. **Package manager:** **pnpm** for new projects; **match the user’s lockfile** in existing repos. For SkillCodex npm modules use **`npm install @skillcodex/skills`**.
4. **Data / content:** follow SkillCodex **data-source** rules when mirroring a skill registry:  
   https://github.com/bh611627/skillcodex/blob/main/references/data-source.md  
5. **Motion:** prefer **`div` + Tailwind**; use **`framer-motion`** only in client boundaries and only when CSS is insufficient.

**Output:** commands, file paths, checklist pass/fail.

---

## Mode B - Audit / review existing UI

Use when the user asks to review, audit, or check accessibility.

1. Read project **TSX/JSX** against **design-guidelines** (URL above).
2. Flag: missing skeletons, weak whitespace, custom CSS where Tailwind suffices, gradients, glass, SaaS landing/dashboard patterns, a11y gaps, **testimonials without `alt`**, **buttons** without pointer/hover/focus, **`motion` in a server file** (Next) or **`motion.div` without `'use client'`**.
3. Optional deep pass: Vercel **Web Interface Guidelines** -  
   `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`

**Output:** grouped **`file:line`** findings + checklist. No preamble.

---

## Outcomes

- **Build:** Components wired; skeletons on load; theme + tokens; dev server runs.
- **Audit:** Actionable list or explicit pass.

## Output rules

State **Mode A** or **Mode B**. Then evidence (paths or findings).

## Scope and boundaries

- **Frontend documentation UIs** only - not SaaS marketing sites.

## Safety

- **Build:** edit UI files; user runs install/dev.
- **Audit:** suggest only; use public raw URLs for guidelines.

---

## References (SkillCodex)

| Topic | URL |
|-------|-----|
| Design guidelines | https://github.com/bh611627/skillcodex/blob/main/references/design-guidelines.md |
| React stack / tooling | https://github.com/bh611627/skillcodex/blob/main/references/react-stack.md |
| Data rules | https://github.com/bh611627/skillcodex/blob/main/references/data-source.md |
| This skill (full SKILL.md) | https://github.com/bh611627/skillcodex/tree/main/skills/web-design-guidelines/SKILL.md |
| npm | https://www.npmjs.com/package/@skillcodex/skills |

**CLI install:** `npx skills add https://github.com/bh611627/skillcodex --skill web-design-guidelines`
