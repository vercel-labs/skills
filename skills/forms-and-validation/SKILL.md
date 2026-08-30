---
name: forms-and-validation
description: Accessible forms in React and Next.js with zod validation - server actions or client submit patterns
---

# Instructions

## When to Use

- Use for accessible forms with zod + Server Actions or client submit.
- Prefer `api-handbook` for pure JSON APIs without forms.
- Prefer `accessibility-audit` for a full WCAG pass after the form ships.

Build or audit **forms** with **zod** and accessible markup.

### Decision: Server Action vs client submit vs API

| Situation | Prefer |
|-----------|--------|
| Same-origin App Router mutation | Server Action + `useActionState` |
| SPA talking to JSON API | Client form → `api-handbook` Route Handler |
| Progressive enhancement required | Server Action with native form `action` |
| Multi-step wizard with heavy client UX | Controlled client + shared zod schema |

1. Choose pattern: **Server Action** with **`useActionState`** (React 19) or legacy `useFormState` naming in older docs - match repo and installed `react` types.
2. Single zod schema (or layered: base + refine); map `flatten().fieldErrors` to fields by name.
3. Labels, `htmlFor`, `aria-invalid`, `aria-describedby` for errors; no placeholder-only labels.
4. Disable double-submit; optimistic UI only when the user asks; show pending state.
5. File uploads: size limits and `accept` list in UI copy; validate again on the server.
6. **Auth:** Server Actions that mutate must re-check session/RBAC (`auth-handbook`); never trust hidden role fields.
7. **CSRF / cookies:** same-site cookies + Server Actions are the default story; document exceptions.

## Outcomes

- Schema snippet + error wiring plan + a11y checklist + pattern choice.

## Output Rules

Show field error mapping table (field → zod path). Prefer small diffs.

## Scope and boundaries

- **In scope:** one multi-field form or wizard step.
- **Out of scope:** payment PCI scope (`payments-handbook`), captcha vendor selection unless the user names one.

## Safety

- repo-files: edit form components only; no `.env` values.

## Troubleshooting

- **Next 15 form types:** align with current `react` types from the lockfile.
- **Hydration on date pickers:** prefer server default string + client parse in an island.
- **Empty fieldErrors:** ensure zod path names match `name=` attributes.
- **Action succeeds but UI stale:** add `revalidatePath` / tags (`server-caching-handbook`).

## Related skills

- [`api-handbook`](../api-handbook/SKILL.md) - Route Handler APIs behind forms
- [`client-data-fetching`](../client-data-fetching/SKILL.md) - client mutation patterns
- [`accessibility-audit`](../accessibility-audit/SKILL.md) - accessible error messaging
- [`auth-handbook`](../auth-handbook/SKILL.md) - authorize mutations

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/forms-and-validation/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
