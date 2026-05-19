---
name: forms-and-validation
description: Accessible forms in React and Next.js with zod validation - server actions or client submit patterns
---

# Instructions

Build or audit **forms** with **zod** and accessible markup.

1. Choose pattern: **Server Action** with **`useActionState`** (React 19) or legacy `useFormState` naming in older docs - progressive enhancement vs controlled client form; match repo and installed `react` types.
2. Single zod schema (or layered: base + refine); map `flatten().fieldErrors` to fields.
3. Labels, `htmlFor`, `aria-invalid`, `aria-describedby` for errors; no placeholder-only labels.
4. Disable double-submit; optimistic UI only when user asks.
5. File uploads: size limits and accept list in copy, not insecure defaults.

## Outcomes

- Schema snippet + error wiring plan + a11y checklist.

## Output Rules

Show field error mapping table (field → zod path).

## Scope and boundaries

- **In scope:** one multi-field form or wizard step.
- **Out of scope:** payment PCI scope, captcha vendor selection unless user names one.

## Safety

- repo-files: edit form components only; no `.env` values.

## Troubleshooting

- **Next 15 form types:** align with current `react` types from repo lockfile.
- **Hydration on date pickers:** prefer server default string + client parse in island.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/forms-and-validation/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
