---
name: testing-agent
description: Write and improve React/Next.js tests with Vitest, Testing Library, and Playwright E2E
---

# Instructions

Improve test quality for **React / Next.js** projects using **Vitest** + **React Testing Library** (unit/component) and **Playwright** (E2E).
## When to Use

- Use to write/improve Vitest, Testing Library, and Playwright tests.
- Prefer `tdd-vitest` for red-green-refactor methodology.
- Prefer `pr-review-workflow` when reviewing test quality in a PR.


## Mode A - generate tests

1. Identify the target component or route and existing test patterns in the repo.
2. Add or extend tests under `__tests__/` or colocated `*.test.tsx` matching project convention.
3. Cover: render smoke, primary user interaction (RTL `user-event`), accessibility roles, error/empty states.
4. For E2E: one happy path per critical flow; use `data-testid` only when roles are insufficient.
5. Provide `pnpm test` (and `pnpm exec playwright test` if E2E added) commands.

## Mode B - audit coverage gaps

1. Map components/routes without tests.
2. List missing cases: loading, error boundary, keyboard, mobile viewport.
3. Output `file:line` or file path groups - no writes unless user asks to fix.

## Outcomes

- Tests that run with `pnpm test` without flakiness (no arbitrary `setTimeout`).
- Clear list of what is covered vs missing.

## Output Rules

State mode. List new/changed test files. Show one example assertion block per major behavior.

## Scope and boundaries

- **In scope:** Vitest, RTL, Playwright for Next/React frontends.
- **Out of scope:** changing production logic solely to make tests pass without user approval, snapshot-only tests with no behavior checks, testing third-party SaaS APIs live.

## Safety

- **tools_allowed:** repo-files - edit test files and test config only unless user expands scope.
- Do not commit secrets; mock `fetch` and env vars in tests.
- Match lockfile; prefer `pnpm` when `pnpm-lock.yaml` exists.

## Troubleshooting

- **`window is not defined`:** ensure jsdom environment in Vitest config or mark file as client component tests only.
- **Next.js router mocks:** use `next/navigation` mocks consistent with App Router version in the repo.
- **Playwright flakiness:** prefer `getByRole` and `expect` auto-waiting; avoid fixed sleeps.

## Related skills

- [`tdd-vitest`](../tdd-vitest/SKILL.md) - red-green-refactor strategy
- [`code-assistant`](../code-assistant/SKILL.md) - small diffs under test
- [`github-actions-ci`](../github-actions-ci/SKILL.md) - CI test jobs

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/testing-agent/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
