# SkillCodex design guidelines

> **STRICTLY UI/UX ONLY** - no backend, no APIs, no database, no authentication logic.
>
> Build a **premium documentation-style** UI for browsing, reading, and creating `SKILL.md` files (like [skills.sh](https://www.skills.sh/) but clearer). Inspired by SkillCodex - not SkillForge.

**Feel:** extremely clean, highly readable, Apple-level refined, documentation-first, calm, structured, minimal, professional. **NOT** generic template churn or flashy visuals; **no** gradient-heavy treatment; **no** glassmorphism (`backdrop-blur`); avoid vendor-style metric dashboards and sales-led landing chrome.

Canonical web UI rules: **this file**. Use the **web-design-guidelines** skill (SkillCodex) to implement or audit doc UIs.

If the user names an industry or product type, use the **tables in this document** for layout, type, color, and motion defaults. If nothing matches, pick the two closest rows, blend layout bias + motion tier + color mood, and state your assumption in one line.

---

## Package manager

| Task | Tool |
|------|------|
| New Next/React doc UI | **pnpm** (fast default) |
| Install `@skillcodex/skills` | **npm** |
| Existing user project | **Match lockfile** (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm) |

**UI stack (React - do not drop the core):** **React**, **TypeScript**, **Tailwind CSS**, **react-markdown**, **remark-gfm**, **react-icons**. Host with **Next.js (App Router)** or **Vite + React**; same layout and component rules apply.

```bash
# Next.js (common for doc UIs)
pnpm create next-app@latest skillcodex-ui --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
cd skillcodex-ui && pnpm install
pnpm add react-markdown remark-gfm react-icons
# optional - only after reading "Motion policy" below:
pnpm add framer-motion
pnpm dev
```

```bash
# Vite + React - install Tailwind per current Vite + Tailwind docs, then:
pnpm add react-markdown remark-gfm react-icons
pnpm dev
```

---

## Design vocabulary (use these terms consistently)

Use the same words in specs, comments, and generated output so nothing drifts between `motion.div` refactors and plain `div`.

| Term | Meaning for SkillCodex doc UIs |
|------|--------------------------------|
| **Surface** | Card, panel, or page region with one background token (`--surface` / `bg-[var(--surface)]`) |
| **Rhythm** | Vertical spacing from the whitespace scale - never arbitrary one-off `mt-7` |
| **Scannability** | Headings, lists, and tags let users find a skill in under 10 seconds |
| **Information scent** | Headings, breadcrumbs, and previews hint at what is inside the next click |
| **Affordance** | Hover, focus, and cursor states prove something is clickable |
| **Density** | **Comfortable** (default docs), **compact** (tables/filters only), never **cramped** vendor-style metric dashboards |
| **Elevation** | Border + subtle shadow or border-only - no heavy drop shadows |
| **Accent** | **One** muted sage/stone family - no rainbow CTAs |
| **Conversion pressure** | How hard the UI pushes a funnel - **low** for docs (SkillCodex default) |
| **Motion tier** | **0** = opacity/transform micro-states on `div` only; **1** = CSS keyframes / `animate-*` / `@keyframes` on `div` only (still no Framer); **2** = Framer `motion` in **one** named `*Motion.tsx` / `*Client.tsx` leaf only |
| **Motion API** | **Per file, one API only:** either **DOM+CSS** (tiers 0–1) **or** **Framer** (tier 2). Mixing `motion.*` and plain layout `div` in the same file is forbidden - split or pick Tier 0 |
| **Shell vs leaf** | **Shell** = layout, lists, cards, typography (Tier 0). **Leaf** = optional Tier 2 file that owns all `motion` for one widget |
| **Hydration boundary** | Next App Router: any file with `motion` or `framer-motion` import must start with `'use client'` and live outside RSC parents as a child import |
| **Skeleton honesty** | Placeholders match final layout width/height bands so layout does not jump |
| **Doc-trust** | Testimonials read as documentation quotes, not marketing carousel |
| **Module boundary** | Server file vs `*Motion.tsx` / `*Client.tsx` - Framer never crosses back into RSC parents |
| **Token stability** | One shared class string (e.g. `CARD_HOVER`) per interaction pattern - do not duplicate in `motion` props and `className` |
| **Stack fidelity** | Patterns match the real stack (Next App Router vs Vite) without inventing APIs |

---

## Motion policy (single source of truth - avoids refactor / token confusion)

**Problem:** Implementors bounce between `motion.div` and `<div>`, duplicate `className` strings on both, leave dead `framer-motion` imports, and break RSC. That wastes tokens and produces inconsistent hover. **Rule:** default UI is **100% DOM + Tailwind**. Framer is an **opt-in leaf**, never a refactor ping-pong inside one file.

### Architecture: shell (always) + optional motion leaf (rare)

| Layer | File pattern | Contains | Motion tier |
|-------|----------------|----------|-------------|
| **Shell** | `SkillCard.tsx`, `page.tsx`, `layout.tsx` | Structure, text, links, `CARD_HOVER` on `div` | 0 |
| **Surface** | same or `SkillCardSurface.tsx` | Borders, padding, static visuals | 0 |
| **Motion leaf** | `SkillCardMotion.tsx` **only** | All `motion.*` for one widget | 2 |

- **Never** put `motion` next to layout `div` in the same module - split the leaf or delete Framer.
- **Never** rename `motion.div` → `div` while keeping `import { motion }` - remove the import or keep Tier 2 in the leaf file only.

### Tier 0 - Default (no Framer)

- Use **`<div>`** (or semantic elements) + Tailwind: `transition-[transform,opacity]`, `duration-200`, `hover:-translate-y-0.5`, `motion-reduce:transform-none`.
- **All** Server Components, layouts, lists, cards, grids, nav, and skeletons stay Tier 0.
- **Do not** import `framer-motion` in files without `'use client'`.
- Prefer **explicit** transition properties - never `transition-all`.

### Tier 1 - CSS animation on `div` only (still no Framer)

- `animate-pulse`, `animate-spin`, small `@keyframes` for success checkmarks, **native `<details>`** open affordance.
- **Still no** `motion` import. OK in Server Components if the animation is class-only and does not read `window`.

### Tier 2 - Framer only in isolated client leaves

Use **only** when CSS cannot do the job (coordinated enter/exit, shared layout, drag, staggered list mount **and** the user asked for it). Then:

1. **New file** with `'use client'` at line 1, suffix **`Motion`** or **`Client`** (e.g. `SkillCardMotion.tsx`).
2. **All** `motion.div` / `motion.span` for that widget live **only** in that file - no `motion` in parents.
3. **Props contract:** leaf receives data + callbacks; parent stays dumb shell. **No** `motion.*` in `layout.tsx`, `page.tsx`, or route shells (compose: `<SkillCardMotion … />` from a small client wrapper if the page is otherwise server).
4. **Downgrade path:** Tier 2 → Tier 0 = delete leaf file’s `framer-motion` usage **and** move hover back to `CARD_HOVER` on shell - one PR, one direction, no mixed state.
5. **Skeletons:** always `<div className="animate-pulse …">` - **never** `motion` for pulse.

### Shared motion tokens (define once - single string of truth)

Define **once** (e.g. `lib/ui-motion.ts`):

```ts
/** Tier 0 card hover - every card shell uses this unless a Tier 2 leaf fully owns hover */
export const CARD_HOVER =
  "transition-[transform,opacity] duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:hover:translate-y-0 motion-reduce:transition-none";
```

**Do not** copy this string into `motion` `whileHover` **and** `className` - pick one layer (shell uses `CARD_HOVER`; leaf uses `motion` props **or** duplicates intentionally with a comment - prefer shell hover only, motion leaf for enter/exit only).

### Decision tree

1. Skeleton / loading placeholder? → **Tier 0**, `animate-pulse` `div`.
2. Hover / tap / focus ring only? → **Tier 0**, `div` + `CARD_HOVER` or Tailwind states.
3. Simple reveal (`opacity`, `max-height` on `<details>`)? → **Tier 1**, still `div` / native elements.
4. Orchestrated mount, shared layout, drag? → **Tier 2**, new `*Motion.tsx` only - **after** user confirms motion is worth the client bundle.

### Fixing common errors (apply exactly one row)

| Issue | Fix |
|-------|-----|
| RSC error with `motion` / `onClick` on server file | Extract to `*Motion.tsx` with `'use client'` **or** replace with Tier 0 `div` + `CARD_HOVER`. |
| Same file mixes `motion.div` and layout `div` | Split: static markup stays in shell; move **all** `motion` lines to `*Motion.tsx`. |
| Refactor replaced `motion.div` with `div` but import remains | Delete `framer-motion` import from that file; add `CARD_HOVER` to shell. |
| Hover feels “lost” after removing Framer | You removed motion props but not restored `CARD_HOVER` on the shell - add it. |
| Type errors on `motion` | Tier 0 unless leaf is client-only and dependency is installed. |

```tsx
// Tier 0 - default card shell (Server or Client)
<div className={CARD_HOVER}>…</div>
```

---

## vs skills.sh (fill the gaps)

| skills.sh | SkillCodex UI should add |
|-----------|---------------------------|
| Install leaderboard | **Outcomes** per skill (what you get) - no fake install counts |
| `npx skills add owner/repo` | Show **GitHub path** + `npm install @skillcodex/skills` + clone command |
| Opaque listing | Full **SKILL.md** readable; metadata visible before install |
| Directory only | Dual format: GitHub markdown + npm module |
| Search leaderboard | Client search + tag filter + **URL state** `?page=&q=&tag=` |
| - | **Create skill** page (form + live markdown preview, client export) |
| - | **Guidelines** page (design + web interface rules) |
| - | **Skeleton loading** everywhere content loads |

---

## Anti-patterns (forbidden)

- Sales-led landing (hero, **pricing strip**, **testimonial carousel** as primary funnel, logo wall, conversion funnels)
- Vendor metric dashboard (dense analytics, KPI widgets, chart grids)
- **No** heavy gradients; **no** glassmorphism (`backdrop-blur`); **no** neon or glow
- `transition: all`
- Custom CSS classes when Tailwind utilities suffice
- Multiple accent colors or default blue buttons
- **Motion churn:** alternating `motion.div` ↔ `<div>` in one file, or mixing Framer imports with Tier 0 shells
- **Hover duplication:** same hover values in `motion` props and `className` on different layers - pick **shell + `CARD_HOVER`** or **motion leaf only** for that widget’s motion

---

## Core principles

- clarity over decoration
- **whitespace is a design feature** - generous vertical rhythm
- content-first; readability is highest priority
- mobile-first, then `md:` / `lg:`
- Tailwind utilities in TSX; CSS vars only for theme tokens (`bg-[var(--bg)]`, etc.)

### Whitespace rhythm (px)

`8` · `16` · `24` · `32` · `48` · `64` · `96`

- paragraph gap: 16-24
- card padding: `p-6` (24)
- between sections: `space-y-12` / `md:space-y-16` / `md:space-y-24`
- page vertical: `py-16 md:py-24`
- reading column: `max-w-3xl mx-auto`
- page padding: `px-4 md:px-8`

---

## Color and typography

**Light (default):** soft off-white bg, deep charcoal text (not #000), light gray borders, **one** muted sage/stone accent.

**Dark (toggle):** near-black bg `#0f0f12`, soft white text, same accent adapted for contrast. WCAG contrast required.

```css
:root { --bg:#fafaf9; --text:#1c1c1e; --muted:#6b6b6f; --border:#e8e8ed; --surface:#fff; --accent:#5c6b5a; }
.dark { --bg:#0f0f12; --text:#f5f5f7; --muted:#a1a1a6; --border:#2c2c2e; --surface:#161618; --accent:#8fa88c; }
```

- Font: Inter or system UI; mono for code
- H1 large semibold `text-balance`; H2 medium semibold; body `text-base leading-relaxed` (~1.65)
- Use `…` not `...`; `-` in UI lists not em dashes

---

## Named visual styles (SkillCodex)

Use these **named styles** in specs and code comments so implementors pick a coherent look without inventing adjectives per file. All are compatible with **doc-first** SkillCodex UIs (no conversion hero strip, **no** glassmorphism-style overlays). Mix **at most two** named styles per page (primary + accent).

| Style name | Best for | Layout | Color mood | Motion default |
|------------|----------|--------|------------|----------------|
| **Calm academic** | LMS, research, syllabi | Single column + sidebar | Paper neutrals | Tier 0 |
| **Spec sheet neutral** | Product size guides, B2B parts | Tables + mono | Cool gray | Tier 0 |
| **Editorial magazine** | Alumni, longform blogs | Wide measure + pull quotes | High contrast text | Tier 1 sparingly |
| **Trust-center formal** | SOC2, security, finance policy | TOC + articles | Navy or charcoal optional | Tier 0 |
| **Clinical quiet** | Healthcare patient info | Large body, soft borders | Blue-gray | Tier 0 |
| **Field manual** | Outdoor, industrial procedures | Steps + diagrams | Earth + safety amber | Tier 0 |
| **Registry browser** | Skills, packages, extensions | Card grid + tags | One sage/stone accent | Tier 0 |
| **API slate** | REST / GraphQL docs | Sidebar + code | Dark blocks, light prose | Tier 0 |
| **Runbook urgent** | Incidents, status | Alerts + numbered steps | Amber/red disciplined | Tier 0 |
| **Legal letter** | Terms, policies | Dense readable | Low chroma | Tier 0 |
| **Catalog reader** | Wholesale, SKU lists | Facets + tables | Neutral + tabular nums | Tier 0 |
| **Journal soft** | DTC brand editorial | Generous whitespace | Warm white | Tier 0 |
| **Wayfinding clear** | Transit, venues, maps | Icons + labels | High contrast | Tier 0 |
| **Museum wall** | Collections, art labels | Minimal chrome | Off-white | Tier 0 |
| **Data appendix** | Science, census, climate | Figures + captions | Accessible chart colors | Tier 0 |
| **Handbook friendly** | HR, onboarding, schools | Lists + short sections | One soft accent | Tier 0 |
| **Glossary dense** | Banking, tax, insurance defs | Definition lists | Gray | Tier 0 |
| **Conference neutral** | Schedules, speakers | Tables + grids | Cool neutrals | Tier 0 |
| **Community plain** | Forums, mutual aid rules | Article + bullets | Standard link blue | Tier 0 |
| **Portfolio restrained** | Photo, design case studies | Grid + captions | Black/white or one accent | Tier 0 |
| **Open knowledge wiki** | OSM, citizen science | Dense links | Minimal decoration | Tier 0 |
| **Telemetry doc** | SDK, webhooks, observability | Code-forward | Mono + borders | Tier 0 |
| **Accessibility-forward** | A11y statements, VPAT prose | Large targets, clear hierarchy | High contrast | Tier 0 |
| **Print-friendly** | Policies users will PDF | Dense OK, clear H2 | Gray borders | Tier 0 |
| **Dark reader** | Dev docs night theme | Same as light + token swap | Desaturated accent | Tier 0 |
| **Kids-simple** | K-12 portals (not games UI) | Big type, few choices | Primary one hue | Tier 0 |
| **Research citation** | Papers, preprints | Mono DOIs, serif quotes optional | Paper | Tier 0 |
| **Compliance checklist** | Audit, procurement | Checkboxes + tables | Professional | Tier 0 |
| **Product education** | “How it works” without selling | Steps + diagrams | Calm | Tier 0 |
| **Support answer** | KB, macros | Search + short articles | Neutral | Tier 0 |
| **Localization shell** | i18n-ready layouts | Same grid all locales | No text-in-images | Tier 0 |
| **Keyboard-first** | Power-user docs | Skip links, visible focus | Standard | Tier 0 |
| **Low-bandwidth** | Emerging markets / slow nets | Few images, system fonts OK | Simple | Tier 0 |
| **Motion-averse** | `prefers-reduced-motion` default path | Static proof states | Any | Tier 0 only |
| **Micro-celebration** | Success copy only (not confetti marketing) | Inline check + text | One green OK | Tier 1 CSS only |
| **Seasonal tasteful** | Holiday hours, limited banners | Banner + revert plan | Muted seasonal | Tier 0 |
| **Bilingual parallel** | Side-by-side locales | Two columns `md+` | Equal weight type | Tier 0 |
| **Versioned doc** | Changelog + semver | Timeline | Muted dates | Tier 0 |
| **Embargo-safe** | Pre-release product docs | “Unreleased” callouts | Amber label | Tier 0 |
| **Partner neutral** | White-label help centers | No brand color overload | Gray + one partner accent max | Tier 0 |
| **Inclusive forms** | Apply, grant, register | Labels, errors, hints | High contrast errors | Tier 0 |
| **Chart-light** | When numbers matter but no dashboard | Inline SVG or static image | Colorblind-safe palette | Tier 0 |
| **Chart-forbidden** | Legal / policy pages | Prose + tables only | No sparklines as decoration | Tier 0 |
| **Search-primary** | Large catalogs | Sticky search + filters | Neutral | Tier 0 |
| **Tree-primary** | Docs with deep IA | Left nav tree | Mono paths optional | Tier 0 |
| **Split editor** | Create skill / live preview | Two pane `md+` | Subtle divider | Tier 0 |
| **Narrative journey** | City guides, itineraries | H2 per day | One map accent | Tier 0 |
| **Safety-first** | Robotics, chemistry | Warnings top | Amber/red rules | Tier 0 |
| **Equity statement** | DEI, access programs | Plain language | Sincere, no stock photo collage | Tier 0 |

---

## Industry and product layout tables

Use this as a **lookup**: when the user names an industry, align **density**, **tone**, and **motion tier** defaults. SkillCodex doc UIs stay **documentation-first** everywhere - retail catalog contexts here mean **catalog readability**, not checkout marketing chrome.

**Columns:** archetype | layout bias | type scale | color mood | motion default | SkillCodex note

### Education and learning (12)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| K-12 district portal | Single column + sidebar | Larger body, calm H2 | Soft neutrals + one accent | Tier 0 | High clarity, no gamification chrome |
| University course catalog | Grid cards + filters | H3 semibold cards | Stone + deep text | Tier 0 | Outcomes visible per course |
| Bootcamp site | Dense list + hero strip | Strong H1, mono for code | High contrast, single accent | Tier 0 | Avoid “startup gradient” hero |
| MOOC library | Card grid + search | Compact meta lines | Muted borders | Tier 0 | Pagination in URL |
| Tutoring marketplace | Two-column list | Readable names | Warm neutral OK | Tier 0 | No fake urgency timers |
| Certification tracker | Table + status pills | Small caps labels | Cool gray | Tier 0 | Progress as text, not charts wall |
| Library digital | Magazine spacing | Serif optional for quotes | Paper-like bg | Tier 0 | Doc-trust quotes only |
| Research lab public | Wide + appendix | Mono for DOIs | Minimal | Tier 0 | Links open in new tab with `rel` |
| Alumni magazine | Editorial blocks | Large pull quotes | Single accent | Tier 1 only for quote | No carousel |
| Student onboarding | Step list | Clear numbers | Calm | Tier 0 | `aria-current` on steps |
| LMS reader | Max-width prose | Relaxed leading | Low contrast borders | Tier 0 | Markdown-first |
| Open courseware | Directory tree + content | Mono paths | Neutral | Tier 0 | Keyboard tree nav |

### Retail and catalog (12)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Product catalog doc | Grid + facets | SKU mono | Neutral + accent | Tier 0 | No “buy now” strip as hero |
| Size guide | Tables + diagrams | Small captions | Gray tables | Tier 0 | Accessibility for tables |
| Merchant policy center | Article list | Legal-readable | Low chroma | Tier 0 | No marketing language |
| Marketplace seller docs | Sidebar nav | UI labels semibold | Cool | Tier 0 | Code fences for API snippets |
| DTC brand journal | Blog index | Editorial H2 | Restrained | Tier 0 | No full-bleed gradient headers |
| B2B wholesale ordering | Dense tables | Tight but 44px targets | Gray | Tier 0 | Row hover only |
| Subscription box FAQ | Accordion | Question semibold | One accent | Tier 0 | Native `<details>` OK |
| Luxury lookbook PDF web | Full bleed images sparingly | Large captions | Muted gold OK as accent only | Tier 0 | Still no glass hero |
| Grocery pickup help | Short articles | Big touch targets | Green accent OK | Tier 0 | Icon + label |
| Electronics specs | Spec tables | Mono values | Cool gray | Tier 0 | Zebra rows optional |
| Fashion sustainability story | Longform | Pull quotes | Earth tone accent | Tier 0 | No auto-play video |
| Returns portal explainer | Steps + icons | Simple | Blue-gray OK | Tier 0 | Destructive confirm pattern |

### Developer tools and docs (12)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Package registry browser | Cards + tags | Mono version | Neutral | Tier 0 | SkillCodex default |
| API reference | Sidebar + content | H4 endpoints | Code red only in code | Tier 0 | |
| CLI manual | Command blocks | Mono commands | Dark code blocks | Tier 0 | |
| Design tokens table | Wide table | Small labels | Border grid | Tier 0 | |
| Changelog | Timeline list | Date muted | Accent for links | Tier 0 | |
| RFC archive | Article list | Long titles | Minimal | Tier 0 | |
| Contribution guide | On-page TOC | Linked H2 | Standard | Tier 0 | |
| Runbook | Alert callouts | Bold warnings | Amber sparingly | Tier 0 | |
| Status page | Incident list | Timestamp mono | Red for down | Tier 0 | No fake uptime charts |
| SDK quickstart | Tabs or steps | Code prominence | Neutral | Tier 0 | |
| Webhook docs | Tables + payloads | Mono JSON | Cool | Tier 0 | |
| Extension marketplace doc | Grid | Icon + title | One accent | Tier 0 | |

### Finance and compliance (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Investor relations doc | PDF-style sections | Formal | Navy optional | Tier 0 | |
| Policy center | Tree + article | Legal leading | Low chroma | Tier 0 | |
| Tax help articles | FAQ | Question bold | Gray | Tier 0 | |
| Banking glossary | Definition list | Term bold | Minimal | Tier 0 | |
| Insurance explainer | Stepped | Numbers clear | Calm blue-gray | Tier 0 | |
| Mortgage calculator help | Prose + table | Numeric tabular nums | Neutral | Tier 0 | |
| Crypto wallet doc (non-trading) | Security-first | Warnings | Amber alerts | Tier 0 | No price tickers |
| Audit trail UI doc | Table spec | Mono IDs | Cool | Tier 0 | |
| SOC2 trust center | Checklist | Small caps | Professional | Tier 0 | |
| Expense policy | PDF-like | Dense OK | Print-friendly | Tier 0 | |

### Healthcare and wellness (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Hospital patient info | Calm single column | Large body | Soft blue-gray | Tier 0 | No stock health photos as decoration |
| Clinic services | Cards | Clear titles | Muted | Tier 0 | |
| Mental health resources | Gentle spacing | Softer weights | Restrained | Tier 0 | Trigger warnings as plain text |
| Pharmacy FAQ | Accordion | Short answers | Neutral | Tier 0 | |
| Medical research portal | Citation heavy | Serif quotes optional | Paper | Tier 0 | |
| Wellness program guide | Steps | Friendly but not cute | One accent | Tier 0 | |
| Nutrition label explainer | Diagrams | Small caps | Neutral | Tier 0 | |
| Telehealth setup | Checklist | Icons + labels | Cool | Tier 0 | |
| Lab results patient doc | Tables | High readability | High contrast borders | Tier 0 | |
| Public health alerts | Banner + article | Strong hierarchy | Alert color disciplined | Tier 0 | |

### Travel and hospitality (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Hotel amenities doc | Grid | Short | Warm neutral | Tier 0 | |
| Airline baggage rules | Tables | Dense OK | Cool | Tier 0 | |
| City guide editorial | Longform | H2 journey | One map accent | Tier 0 | |
| Visa checklist | Steps | Checkbox list | Minimal | Tier 0 | |
| Car rental terms | Collapsible sections | Legal | Gray | Tier 0 | |
| Train timetable help | Mono times | Tabular nums | Neutral | Tier 0 | |
| Cruise itinerary reader | Day blocks | Clear dates | Navy optional | Tier 0 | |
| Host handbook | Article series | Friendly | Single accent | Tier 0 | |
| Accessibility travel | Bullets + icons | Large targets | High contrast | Tier 0 | |
| Sustainable tourism pledge | Statement + list | Sincere tone | Earth accent OK | Tier 0 | |

### Media and publishing (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Newsroom | Reverse chronological | Headline strong | Black/white OK | Tier 0 | |
| Magazine archive | Card grid | Serif titles optional | Paper | Tier 0 | |
| Podcast show notes | Prose + timestamps | Mono times | Neutral | Tier 0 | |
| Newsletter archive | List | Date column | Muted | Tier 0 | |
| Documentation site | Sidebar + content | Standard SkillCodex | Token | Tier 0 | |
| Research preprint | Two column optional | Citation mono | Minimal | Tier 0 | |
| Photo essay (doc) | Few large images | Captions | Restrained | Tier 0 | `next/image` |
| Wiki | Dense links | Small | Blue links only | Tier 0 | |
| Style guide | Sections | Example + rule | Gray boxes | Tier 0 | |
| Local newspaper digital | Simple list | Readable | High contrast | Tier 0 | |

### Government and nonprofit (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| City services directory | Search + categories | Plain | Official blue OK | Tier 0 | |
| Election info | Timeline | High clarity | Red/blue disciplined | Tier 0 | |
| FOIA reading room | Table | Mono IDs | Gray | Tier 0 | |
| Grant applicant help | Steps | Forms spec | Neutral | Tier 0 | |
| NGO annual report web | Longform | Pull quotes | One accent | Tier 0 | |
| Museum collection browser | Grid + filters | Captions | Warm white | Tier 0 | |
| Park regulations | Articles | Dense OK | Green accent OK | Tier 0 | |
| Public transit doc | Maps + text | Legible | High contrast | Tier 0 | |
| Census explainer | Charts as static images OK | Clear labels | Accessible palettes | Tier 0 | |
| Disaster preparedness | Alert + lists | Strong hierarchy | Amber/red disciplined | Tier 0 | |

### Creative and portfolio (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Photographer portfolio doc | Grid | Large captions | Black/white | Tier 0 | No auto slideshow for core nav |
| Design agency case study | Longform | Big type | One accent | Tier 0 | |
| Architect project sheet | Image + spec | Technical | Cool gray | Tier 0 | |
| Musician press kit | PDF-like | Bold titles | Dark mode OK | Tier 0 | |
| Writer portfolio | List + excerpts | Serif body optional | Paper | Tier 0 | |
| Game studio lore bible | Wiki tree | Fantasy tone in text only | Still no neon UI | Tier 0 | |
| Film production handbook | Sections | Mono slugs | Neutral | Tier 0 | |
| Art gallery labels | Minimal | Small | White wall | Tier 0 | |
| Maker documentation | Steps + photos | Friendly | Single accent | Tier 0 | |
| Open-source maintainer blog | Posts + tags | Code-heavy | GitHub-like | Tier 0 | |

### Science and engineering (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Lab equipment manual | Diagrams + lists | Captions | Cool | Tier 0 | |
| Field geology guide | Wide + figures | Figure numbers | Earth tone OK | Tier 0 | |
| Climate dataset readme | Tables | Mono | Blue-gray | Tier 0 | |
| Robotics safety | Warnings first | Bold | Amber | Tier 0 | |
| Civil engineering specs | Dense tables | Mono | Print-like | Tier 0 | |
| Aerospace checklist | Steps | All caps labels sparingly | Gray | Tier 0 | |
| Chemistry MSDS-style | Sections | Small | Warning icons disciplined | Tier 0 | |
| Open hardware schematic doc | Figures + BOM | Mono part numbers | Neutral | Tier 0 | |
| Math curriculum | Prose + equations | KaTeX blocks | Minimal | Tier 0 | |
| Astronomy outreach | Editorial + facts | Large numerals | Dark bg OK | Tier 0 | |

### Local services and lead-gen docs (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Plumber service area | List + map static | Clear | Blue-gray OK | Tier 0 | No fake reviews strip |
| Legal firm practice areas | Articles | Formal | Navy optional | Tier 0 | |
| Contractor warranty | PDF-like | Dense | Gray | Tier 0 | |
| Restaurant allergen info | Tables | Bold allergens | High contrast | Tier 0 | |
| Gym class schedule | Table | Tabular nums | Neutral | Tier 0 | |
| Salon service menu | Grid | Prices aligned | Soft | Tier 0 | |
| Auto shop estimates explainer | Steps | Icons + text | Cool | Tier 0 | |
| Childcare handbook | Friendly lists | Large | Warm | Tier 0 | |
| Real estate disclosure doc | Longform | Legal | Low chroma | Tier 0 | |
| Cleaning checklist field-ops doc | Tables | Compact | Gray | Tier 0 | Still not dashboard chrome |

### Events and conferences (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Conference schedule | Table + timezone | Mono times | Neutral | Tier 0 | |
| Speaker directory | Grid cards | Bios short | One accent | Tier 0 | |
| Sponsor kit (doc, not deck) | Sections | Clear tiers | Minimal | Tier 0 | |
| Hackathon rules | Numbered | Code blocks | Cool | Tier 0 | |
| Meetup safety | Bullets | Bold verbs | Alert sparingly | Tier 0 | |
| Wedding vendor doc | Soft layout | Elegant type | Pastel accent OK | Tier 0 | No parallax |
| Festival map legend | Key + list | Small | High contrast | Tier 0 | |
| Webinar replay notes | Prose + timestamps | Mono | Neutral | Tier 0 | |

### B2B internal and operations (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| IT helpdesk KB | Search + articles | Mono commands | Gray | Tier 0 | |
| HR handbook | TOC heavy | Formal | Neutral | Tier 0 | |
| Security onboarding | Steps | Warnings | Amber | Tier 0 | |
| Sales playbook (internal) | Sections | Tables | Cool | Tier 0 | Not external landing |
| Support macros library | List + copy buttons | Mono snippets | Neutral | Tier 0 | |
| Incident postmortem template | Headings | Blameless tone | Gray | Tier 0 | |
| Procurement policy | Articles | Dense | Print-friendly | Tier 0 | |
| Facilities floor plan doc | Figures | Labels | Blue-gray | Tier 0 | |
| Data retention policy | Legal | Small | Low chroma | Tier 0 | |
| Vendor comparison (internal) | Table | Neutral | No marketing superlatives | Tier 0 | |

### Community and open knowledge (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| OpenStreetMap contributor guide | Wiki | Technical | Neutral | Tier 0 | |
| Wikipedia-style explainer | Prose | Links blue | Standard | Tier 0 | |
| Citizen science protocol | Steps | Numbered | Minimal | Tier 0 | |
| Mutual aid resource list | List + filters | Urgent readable | High contrast | Tier 0 | |
| Neighborhood forum rules | Article | Clear | Gray | Tier 0 | |
| Open data portal doc | Tables + APIs | Mono | Cool | Tier 0 | |
| Maker faire exhibitor manual | Checklist | Friendly | One accent | Tier 0 | |
| Library of congress style guide | Dense rules | Formal | Paper | Tier 0 | |

### Legal, compliance, and risk (12)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Contract clause browser | Sidebar + article | Legal leading | Low chroma | Tier 0 | Cross-links to definitions |
| Litigation hold explainer | Steps + warnings | Bold dates | Amber | Tier 0 | No sensational copy |
| Trademark usage guide | Do / don't columns | Examples in gray boxes | Neutral | Tier 0 | |
| Patent filing help (public) | Dense lists | Mono application IDs | Cool | Tier 0 | |
| Privacy notice (region packs) | Tabs by jurisdiction | Small caps labels | Calm | Tier 0 | |
| Cookie policy technical | Tables of purposes | Mono vendor IDs | Gray | Tier 0 | |
| Export control FAQ | Q&A | Short answers | Professional | Tier 0 | |
| Workplace investigations policy | Article | Formal | Navy optional | Tier 0 | |
| Whistleblower channel doc | Anonymous-first UX spec | Plain | High contrast | Tier 0 | |
| Subpoena response playbook | Checklist | Redact examples | Gray | Tier 0 | |
| E-discovery glossary | Definitions | Terms bold | Minimal | Tier 0 | |
| Regulatory comment draft help | Outline | Numbered sections | Neutral | Tier 0 | No lobbying tone |

### Machine learning and data products (12)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Model card library | Cards + filters | Risk labels | Muted warnings | Tier 0 | No hype scores |
| Model governance statement | Longform | Pull quotes | One accent | Tier 0 | |
| Dataset documentation | Tables + license blocks | Mono hashes | Cool | Tier 0 | |
| Evaluation harness readme | Code + matrices | Mono metrics | Neutral | Tier 0 | |
| Prompt library (internal) | List + copy | Mono prompts | Gray | Tier 0 | Redact secrets |
| RAG architecture explainer | Diagrams + prose | Captions | Blue-gray | Tier 0 | |
| Embedding index spec | Technical tables | Small | Border grid | Tier 0 | |
| Fine-tuning runbook | Steps | Command blocks | Dark code | Tier 0 | |
| Bias audit report (public summary) | Sections | Charts as static | Accessible palette | Tier 0 | |
| Safety benchmark results | Tables | Tabular nums | Cool | Tier 0 | |
| Tool-calling policy | Bullets | Bold verbs | Amber for “never” | Tier 0 | |
| Synthetic data license | Article + callouts | Legal | Low chroma | Tier 0 | |

### Gaming and interactive media (documentation only) (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Game controls reference | Tables + diagrams | Mono bindings | Dark mode OK | Tier 0 | No neon chrome |
| Lore bible wiki | Tree + articles | Fantasy in text only | Restrained UI | Tier 0 | |
| Patch notes archive | Reverse chrono | Version mono | Neutral | Tier 0 | |
| Accessibility options menu spec | Lists | Large targets | High contrast | Tier 0 | |
| Parental controls guide | Steps | Plain language | Calm | Tier 0 | |
| Modding SDK doc | Sidebar + code | Mono APIs | Cool | Tier 0 | |
| Anti-cheat policy reader | Article | Formal | Gray | Tier 0 | |
| Speedrun rules doc | Numbered | Dense OK | Mono times | Tier 0 | |
| Tournament rulebook | Sections | Tables | Neutral | Tier 0 | |
| Engine migration guide | Steps + code | Warnings | Amber | Tier 0 | |

### Logistics, supply chain, and operations (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Warehouse SOP | Steps + icons | Bold verbs | Cool | Tier 0 | |
| Incoterms explainer | Tables | Small captions | Gray | Tier 0 | |
| Fleet maintenance log spec | Table schema | Mono IDs | Neutral | Tier 0 | |
| Cold chain handling | Warnings first | Diagrams | Blue + amber | Tier 0 | |
| Customs documentation checklist | Checklist | Dense | Print-friendly | Tier 0 | |
| 3PL onboarding | Articles | Clear H2 | One accent | Tier 0 | |
| Barcode / RFID field guide | Technical | Mono | Cool | Tier 0 | |
| Slotting optimization notes | Prose + tables | Tabular nums | Gray | Tier 0 | |
| Reverse logistics returns | Flow diagram + text | Clear | Neutral | Tier 0 | |
| Dock safety | Alert + lists | Strong hierarchy | Amber | Tier 0 | |

### Energy, utilities, and environment (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Net metering explainer | Prose + diagram | Clear numbers | Green accent OK | Tier 0 | |
| Outage map legend | Key + article | High contrast | Official palette | Tier 0 | |
| EV charging etiquette | Short list | Friendly | Cool | Tier 0 | |
| Water quality report reader | Tables | Captions | Blue-gray | Tier 0 | |
| Recycling contamination guide | Icons + bullets | Simple | Earth tone OK | Tier 0 | |
| Solar warranty doc | PDF-like | Dense | Gray | Tier 0 | |
| Grid interconnection queue help | Timeline | Mono dates | Neutral | Tier 0 | |
| Carbon accounting explainer | Tables + footnotes | Small | Low chroma | Tier 0 | |
| Hazmat shipping doc | Warnings | Bold | Amber/red disciplined | Tier 0 | |
| Biodiversity field protocol | Steps | Field-friendly | Earth | Tier 0 | |

### Agriculture and food systems (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Crop rotation handbook | Tables + seasons | Small caps | Earth | Tier 0 | |
| Organic certification checklist | Checklist | Dense | Green discipline | Tier 0 | |
| Allergen labeling rules | Tables | Bold allergens | High contrast | Tier 0 | |
| Cold storage HACCP | Steps + temps | Mono values | Blue-gray | Tier 0 | |
| Farm equipment manual | Diagrams | Captions | Cool | Tier 0 | |
| Seed variety catalog | Grid | SKU mono | Neutral | Tier 0 | |
| Irrigation scheduling doc | Calendar + tables | Tabular nums | Neutral | Tier 0 | |
| Food recall notice template | Alert + bullets | Urgent readable | Red disciplined | Tier 0 | |

### Professional services (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Consulting SOW explainer | Sections | Formal | Navy optional | Tier 0 | |
| Accounting close checklist | Table | Dates mono | Gray | Tier 0 | |
| Audit evidence request list | Bullets + IDs | Mono | Cool | Tier 0 | |
| Architecture review template | Headings | Neutral | Minimal | Tier 0 | |
| M&A diligence index | Tree + status | Small labels | Professional | Tier 0 | |
| Law firm client intake (doc UI) | Forms spec | Accessible | High contrast | Tier 0 | |
| Recruiting scorecard spec | Tables | Dense OK | Neutral | Tier 0 | |
| Fractional CFO playbook | Sections | Tables | Cool | Tier 0 | |
| Design retainer scope | Article | Clear deliverables | One accent | Tier 0 | |
| Expert witness exhibit list | Table | Mono exhibit IDs | Gray | Tier 0 | |

### Real estate and built environment (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Zoning variance explainer | Article + map static | Legal | Low chroma | Tier 0 | |
| HOA rules portal | Search + articles | Plain | Gray | Tier 0 | |
| LEED documentation index | Checklist | Small caps | Green discipline | Tier 0 | |
| Renters insurance explainer | FAQ | Short | Calm blue-gray | Tier 0 | |
| Building code reference (doc) | Sidebar + dense text | Mono section refs | Cool | Tier 0 | |
| Accessibility retrofit guide | Steps + figures | Large captions | High contrast | Tier 0 | |
| Property data schema doc | Tables + JSON | Mono | Neutral | Tier 0 | |
| Title search glossary | Definitions | Terms bold | Minimal | Tier 0 | |
| Short-term rental local rules | List | Clear | Neutral | Tier 0 | |
| Construction punch list spec | Table | Checkbox column | Gray | Tier 0 | |

### Automotive and mobility (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Owner manual web | TOC + sections | Diagrams | Cool | Tier 0 | |
| EV range disclaimer | Prose + table | Clear | Neutral | Tier 0 | |
| ADAS limitations doc | Warnings | Bold | Amber | Tier 0 | |
| Tire safety pamphlet | Icons + bullets | Simple | High contrast | Tier 0 | |
| Recall VIN lookup spec | Form UX only | Mono VIN | Gray | Tier 0 | No backend here |
| Car seat installation | Steps + figures | Large | Calm | Tier 0 | |
| Micromobility rules | Article | Dense OK | Official palette | Tier 0 | |
| Fleet telematics privacy | Longform | Legal | Low chroma | Tier 0 | |

### Music, rights, and media operations (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Royalty statement explainer | Tables | Tabular nums | Neutral | Tier 0 | |
| ISRC / UPC field guide | Mono blocks | Small captions | Cool | Tier 0 | |
| Sample clearance checklist | Steps | Bold | Gray | Tier 0 | |
| DMCA counter-notice help | Article | Formal | Low chroma | Tier 0 | |
| Sync licensing glossary | Definitions | Terms bold | Minimal | Tier 0 | |
| Livestream technical rider | Tables | Mono | Dark mode OK | Tier 0 | |
| Press kit asset spec | List + dimensions | Mono px | Neutral | Tier 0 | |
| Archival metadata doc | Dense table | Mono IDs | Paper | Tier 0 | |

### Sports and fitness (documentation) (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| League rulebook | Sections | Dense OK | Neutral | Tier 0 | |
| Anti-doping procedures | Formal article | Warnings | Amber | Tier 0 | |
| Injury prevention protocol | Steps + figures | Large | Calm | Tier 0 | |
| Gym equipment maintenance | Checklist | Icons | Cool | Tier 0 | |
| Race waiver readability | Short sentences | Legal | High contrast | Tier 0 | |
| Youth sports parent code | Bullets | Friendly | One accent | Tier 0 | |
| Wearables data export spec | Technical | Mono | Gray | Tier 0 | |
| Adaptive sports program guide | Accessible layout | Large targets | High contrast | Tier 0 | |

### Architecture, engineering, and construction (AEC) (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Drawing set index | Table + revision | Mono sheet nums | Cool | Tier 0 | |
| RFQ response template | Sections | Formal | Gray | Tier 0 | |
| Jobsite safety orientation | Alerts + lists | Bold | Amber | Tier 0 | |
| BIM coordination rules | Technical | Mono IDs | Neutral | Tier 0 | |
| Submittal log spec | Table | Status pills | Professional | Tier 0 | |
| Geotech report reader | Figures + captions | Small | Earth | Tier 0 | |
| MEP commissioning checklist | Checklist | Dense | Blue-gray | Tier 0 | |
| ADA route survey doc | Figures | Large labels | High contrast | Tier 0 | |
| Change order explainer | Timeline | Dates mono | Neutral | Tier 0 | |
| As-built documentation | List + refs | Mono | Print-like | Tier 0 | |

### Insurance and claims (documentation) (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Claims FNOL checklist | Steps | Bold | Calm | Tier 0 | |
| Coverage comparison (educational) | Table | Neutral language | Gray | Tier 0 | No selling |
| Exclusions encyclopedia | Articles | Legal leading | Low chroma | Tier 0 | |
| Adjuster field photo spec | Bullets | Technical | Cool | Tier 0 | |
| Catastrophe FAQ | Alert + Q&A | Short | Amber | Tier 0 | |
| Subrogation glossary | Definitions | Terms bold | Minimal | Tier 0 | |
| Premium factors explainer | Prose + diagram | Clear numbers | Neutral | Tier 0 | |
| Appeals process guide | Timeline | Dates mono | Professional | Tier 0 | |
| Fraud awareness (doc) | Article | Serious | Gray | Tier 0 | |
| Producer appointment checklist | Table | Dense | Neutral | Tier 0 | |

### Aerospace and public defense docs (6)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| NOTAM-style bulletin reader | Dense list | Mono times | High contrast | Tier 0 | |
| Drone operation limits | Map static + legend | Clear | Official palette | Tier 0 | |
| ITAR awareness primer | Article | Formal | Gray | Tier 0 | |
| Public flight safety data | Tables | Captions | Cool | Tier 0 | |
| Spaceport visitor rules | Steps | Simple | Neutral | Tier 0 | |
| Satellite imagery license summary | Longform | Legal | Low chroma | Tier 0 | |

### Maritime and fisheries (6)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| COLREGS study guide | Article + diagrams | Dense OK | Navy | Tier 0 | |
| Catch limit bulletin | Tables | Mono weights | Cool | Tier 0 | |
| Container lashing safety | Warnings | Icons | Amber | Tier 0 | |
| Ferry accessibility | List + figures | Large | High contrast | Tier 0 | |
| Port hazardous cargo | Alert + rules | Bold | Red discipline | Tier 0 | |
| Crew certification matrix | Table | Small | Gray | Tier 0 | |

### Pharmaceuticals and life sciences (regulatory doc) (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| IFU excerpt web | Sections | Dense | Neutral | Tier 0 | |
| Clinical trial participant sheet | Calm prose | Large | Soft | Tier 0 | |
| Cold chain validation summary | Tables | Mono temps | Blue-gray | Tier 0 | |
| Pharmacovigilance reporting | Steps | Warnings | Amber | Tier 0 | |
| Biosimilar education | Compare table | Neutral copy | Gray | Tier 0 | |
| Laboratory chemical SDS portal | Dense sections | Small | Warning icons | Tier 0 | |
| IRB consent readability guide | Bullets | Plain language | Calm | Tier 0 | |
| Serialization aggregation explainer | Diagram + mono | Technical | Cool | Tier 0 | |

### Cybersecurity and IAM (documentation) (10)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| SSO integration guide | Steps + code | Mono URLs | Cool | Tier 0 | Redact secrets |
| SCIM provisioning spec | Tables + JSON | Mono | Neutral | Tier 0 | |
| RBAC matrix template | Table | Dense | Gray | Tier 0 | |
| Secrets rotation runbook | Numbered | Warnings | Amber | Tier 0 | |
| Zero trust principles explainer | Longform | Diagrams | Blue-gray | Tier 0 | |
| Phishing simulation policy | Article | Formal | Low chroma | Tier 0 | |
| Bug bounty rules | Sections | Mono scopes | Neutral | Tier 0 | |
| SIEM alert taxonomy | Tables | Small labels | Cool | Tier 0 | |
| MFA rollout comms | Steps | Friendly | One accent | Tier 0 | |
| Vendor security questionnaire index | Tree | Dense | Professional | Tier 0 | |

### Human resources and people ops (8)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Compensation philosophy (public) | Article | Formal | Neutral | Tier 0 | |
| Leave policy hub | TOC + articles | Plain | Gray | Tier 0 | |
| Performance review calibration guide | Tables | Dense OK | Cool | Tier 0 | |
| Remote work ergonomics | Steps + figures | Friendly | One accent | Tier 0 | |
| DEI reporting definitions | Glossary | Terms bold | Minimal | Tier 0 | |
| Immigration sponsorship explainer | Steps | Clear | Calm | Tier 0 | |
| Workplace accommodations | Article | Accessible | High contrast | Tier 0 | |
| Offboarding checklist | Checklist | Dense | Neutral | Tier 0 | |

### Philanthropy and grants (6)

| Archetype | Layout | Type | Color | Motion | Note |
|-----------|--------|------|-------|--------|------|
| Grant eligibility wizard spec | Steps | Plain | Calm | Tier 0 | |
| Impact report reader | Longform + figures | Sincere | One accent | Tier 0 | |
| Donor advised fund glossary | Definitions | Small | Gray | Tier 0 | |
| Foundation bylaws summary | Article | Formal | Low chroma | Tier 0 | |
| Fellowship application rubric | Table | Dense | Neutral | Tier 0 | |
| Volunteer onboarding | Checklist | Friendly | Soft | Tier 0 | |

**Count:** **200+** rows across all sections (each table row is one product context). Pick the closest row and inherit defaults unless the user overrides.

---

## Components (Tailwind)

| Component | Rules |
|-----------|--------|
| **Skill card** | title, description, tag pills, subtle hover lift (`-translate-y-0.5`), View link, no glow |
| **Buttons** | `rounded-xl`, soft border/fill; **`cursor-pointer`**; **`hover:`** state (not `transition-all`); **`focus-visible:ring-2`**; **`disabled:opacity-50 disabled:cursor-not-allowed`** |
| **Inputs** | clean border or underline, `focus-visible:ring-2`, labels required |
| **Markdown** | remark-gfm, GitHub-like code blocks, section spacing, long-form readable |
| **Pagination** | numbered + prev/next, minimal, sync `?page=` in URL |
| **ThemeToggle** | light default; `localStorage` + `class="dark"` on `html` |

### Testimonials / trust quotes (doc UIs only)

Allowed when they read as **documentation trust** (short quotes, calm cards) - not a marketing page.

- **Avatar:** In **Next.js**, use `next/image` with fixed `width` / `height`. In **Vite/plain React**, use `<img>` with explicit `width`/`height` (or CSS aspect + `object-cover`) and the same **`alt`** rules. Shape: `rounded-full` or `rounded-xl`.
- **Quote:** bounded width, generous padding, body typography - no star-rating widgets or “As seen in” logo strips
- **Motion:** Tier 0 only unless a dedicated client quote component needs Tier 2

### Buttons and links (interaction)

- **`<button type="button">`** for on-page actions; **`next/link`** (Next) or **`react-router` `<Link>`** / **`<a href>`** for navigation - never a `div` with `onClick` for navigation
- **Cursor:** `cursor-pointer` on interactive elements; `cursor-not-allowed` when `disabled`
- **Hover:** visible state change (background, border, or lift per motion rules)
- **Focus:** `focus-visible` ring; never bare `outline-none` without a replacement

**Icons:** react-icons only (one library). Emoji Mart `set="apple"` only if user asks for picker.

**Footer:** `© {new Date().getFullYear()} {brand}` in root layout (`app/layout.tsx` on Next or root component on Vite) - never hardcode year.

---

## Skeleton loading (mandatory)

Before real content on every surface:

- home skill grid → `DocCardSkeleton` x6-8
- detail → `DetailSkeleton`
- sidebar / preview / lists → `LoadingBlock` rows
- soft neutral `animate-pulse`; `motion-reduce:animate-none`; optional subtle shimmer; `aria-busy="true"`

```tsx
<div className="animate-pulse rounded-lg bg-[var(--border)]/70 h-4 w-full motion-reduce:animate-none" aria-hidden="true" />
```

---

## Web interface guidelines (apply to all UI)

- icon buttons: `aria-label`
- semantic HTML (`button`, `a`, `label`, `nav`, `main`, `article`)
- `focus-visible` only; never `outline-none` without replacement
- forms: labels, types, autocomplete, inline errors, no paste block
- **Next.js:** `next/link`, `next/image` + width/height, lazy below fold. **Vite/React:** semantic `<a>` / router `<Link>`, `<img alt>` + dimensions or CSS constraints
- toasts: `aria-live="polite"`
- destructive actions: confirm
- URL reflects filters/pagination (nuqs or `useSearchParams`)

Optional deep audit: fetch `vercel-labs/web-interface-guidelines/main/command.md`.

---

## Pages (route shape - adapt to your router)

**Next.js:** `app/page.tsx`, `app/skills/[slug]/page.tsx`, etc. **Vite + react-router:** `/`, `/skills/:slug`, same UX.

### 1. Home `/`

Grid/list hybrid, search (client), tag filter (client), pagination, theme toggle, skeleton grid, sticky minimal nav.

### 2. Detail `/skills/[slug]`

Centered markdown reader; header with title, description, tags, version, **outcomes list**; right rail (desktop): Copy Skill, Use Skill (show install commands), metadata; DetailSkeleton while loading.

### 3. Create `/create` (UI only)

Split: left form (name, description, tags, instructions, output format) + right live markdown preview. Labels, validation, toast on copy/export. Client download .md only - no server save.

### 4. Guidelines `/guidelines`

Doc layout explaining design + web interface rules; same spacing/tokens.

---

## SkillCodex platform (two formats)

**GitHub (primary):** `skills/<name>/SKILL.md` - browse, fork, copy into skill hosts (Cursor, Claude Code, skills.sh, and similar).

**npm (developer):** `npm install @skillcodex/skills` then `import x from "@skillcodex/skills/<name>"`.

Write once as SKILL.md; share on GitHub; optional npm mirror. Every skill lists **outcomes** (expected results).

---

## Checklist

- [ ] STRICT UI only - no backend/API/DB/auth
- [ ] Mobile-first Tailwind; whitespace rhythm; **no** sales-led chrome, **no** heavy gradients, **no** glass
- [ ] Skeletons on all content surfaces (`<div className="animate-pulse">`); motion via **Tier 0** unless an isolated `*Motion.tsx` client file uses Tier 2
- [ ] Motion policy - **shell vs leaf** respected; no `motion` in Server files; no mixed motion API in one module
- [ ] Tier 1 only on `div` / native elements - never `transition-all`
- [ ] Shared `CARD_HOVER` (or equivalent) defined once if using CSS hover widely
- [ ] Outcomes visible on detail; skills.sh gaps addressed
- [ ] Buttons: `cursor-pointer`, hover, `focus-visible`, disabled cursor; real `<button>` / `Link`
- [ ] Testimonials (if any): `next/image` avatars with **alt**, doc-trust layout - not marketing carousel
- [ ] Closest layout table row chosen when user names an industry - defaults applied consistently
- [ ] Package manager matches user project lockfile
- [ ] `pnpm dev` runs
