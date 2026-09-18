---
name: tdd-vitest
description: Red-green-refactor test strategy with Vitest and Testing Library for React and Next - methodology before mass test generation
---

# Instructions

Drive **red → green → refactor** for **React / Next.js** using **Vitest** and **Testing Library**. This skill is **methodology**; use **`testing-agent`** when the user wants bulk tests or Playwright scaffolding without TDD cadence.

## When to Use

- Use when the user wants TDD, “write the failing test first,” or disciplined unit/integration loops.
- Prefer **`testing-agent`** for generating suites, RTL patterns, or Playwright E2E without red-green ritual.
- Prefer **`pr-review-workflow`** when reviewing someone else's tests in a PR.

1. **Name the behavior** in one sentence (user-visible or API contract).
2. **Red:** write the smallest failing Vitest/RTL test; run it; confirm it fails for the right reason.
3. **Green:** implement the minimum production change to pass; no drive-by refactors.
4. **Refactor:** only after green; keep tests green; extract with intent.
5. **Boundaries:** mock network/DB at the edges you own; do not mock the unit under test into meaninglessness.
6. **Next specifics:** prefer testing pure modules and client components with RTL; for Server Components/Actions, test extracted logic or route handlers with clear seams - do not invent brittle RSC harnesses.
7. **E2E:** list Playwright cases as a backlog; do not expand every unit into browser E2E.

## Outcomes

- One red→green→refactor cycle documented with commands and file paths.
- Clear split: unit/integration done now vs E2E later.

## Output Rules

Show the failing test output reason when possible. Prefer `pnpm test` / project scripts; match existing Vitest config.

## Scope and boundaries

- **In scope:** TDD cadence, Vitest/RTL strategy, seams for Next.
- **Out of scope:** full Playwright authorship (hand off to `testing-agent`), mutation testing platforms, coverage vanity targets.

## Safety

- Do not commit secrets in fixtures; use factories with fake data.
- User runs test commands unless they explicitly ask the agent to run them.

## Troubleshooting

- **Failing for the wrong reason:** fix imports/config before asserting behavior.
- **Flaky timers:** use Vitest fake timers; avoid real network in unit tests.
- **RSC hard to test:** extract pure functions; do not fight the framework.

## Related skills

- [`testing-agent`](../testing-agent/SKILL.md) - broader Vitest/RTL/Playwright generation
- [`code-assistant`](../code-assistant/SKILL.md) - implement green with small diffs
- [`pr-review-workflow`](../pr-review-workflow/SKILL.md) - review test quality in PRs
- [`github-actions-ci`](../github-actions-ci/SKILL.md) - run the suite in CI

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/tdd-vitest/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
