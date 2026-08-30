---
name: pr-review-workflow
description: Structured pull request review for React and Next.js - checklist, risk notes, and actionable comments without rewriting the PR
---

# Instructions

Run a **structured PR review** for **React / Next.js / TypeScript** changes. Prefer **actionable comments** over rewriting the author's PR.

## When to Use

- Use when reviewing a pull request, diff, or “look at this PR” request.
- Prefer **`code-assistant`** for implementing a small fix yourself.
- Prefer **`tdd-vitest`** / **`testing-agent`** when the gap is missing tests, not review tone.
- Prefer **`secure-dependencies`** when the PR is mostly lockfile/audit policy.

1. **Scope the diff:** list touched areas (UI, API, schema, CI, deps). Note what is *not* in the PR.
2. **Checklist (in order):** correctness → security/secrets → data loss → a11y/UX regressions → performance → tests/CI → style only if it blocks maintainability.
3. **React/Next specifics:** Server vs Client Components, secrets in client bundles, Server Actions auth, cache invalidation, `error`/`loading` coverage for new routes.
4. **Comments:** file:line when possible; one issue per comment; suggest a fix shape, do not dump a full alternate PR unless asked.
5. **Defer:** for deep React composition/perf rules, point readers at [vercel-labs/agent-skills react-best-practices](https://github.com/vercel-labs/agent-skills) rather than reinventing that catalog here.
6. **Verdict:** Approve / Approve with nits / Request changes - with the **top 3** blockers only in the summary.

## Outcomes

- Ordered findings + risk summary + merge recommendation.
- Explicit “out of scope for this review” notes when the diff is partial.

## Output Rules

Read-only by default. No force-push advice. No “LGTM” without the checklist.

## Scope and boundaries

- **In scope:** PR review workflow, Next/React risk checklist, comment quality.
- **Out of scope:** rewriting the entire feature, legal/compliance sign-off, rubber-stamp merges.

## Safety

- Do not paste secrets found in the diff into chat; flag and redact.
- Do not approve known secret commits; require rotation notes.

## Troubleshooting

- **Huge PR:** ask for a summary of intent; review by directory; flag “needs split” as a finding.
- **Generated lockfile noise:** focus on intentional dep changes and audit impact.
- **Missing tests:** request cases, do not invent flaky E2E without user ask.

## Related skills

- [`code-assistant`](../code-assistant/SKILL.md) - implement the fix after review
- [`testing-agent`](../testing-agent/SKILL.md) - add missing tests
- [`tdd-vitest`](../tdd-vitest/SKILL.md) - red-green-refactor for new behavior
- [`secure-dependencies`](../secure-dependencies/SKILL.md) - supply-chain in the diff
- [`github-actions-ci`](../github-actions-ci/SKILL.md) - CI gaps

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/pr-review-workflow/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
