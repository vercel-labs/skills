---
name: react-email-templates
description: Transactional email with React components - layout tables text version and test sends
---

# Instructions

Build **transactional email** templates as **React** components (e.g. react-email style) with **plain-text** counterparts.

## When to Use

- Use for receipts, password resets, invite links, and product notifications.
- Prefer **`content-creator`** for social/marketing copy, not cold outreach from this skill.
- Prefer **`webhook-receivers`** / **`payments-handbook`** when the email is triggered by payment events.

1. Layout: table-based width constraints; max width ~600px; system fonts or a web-safe stack.
2. **Images:** absolute URLs only; alt text; never put critical info only in images.
3. **CTA:** bulletproof button pattern (nested table) when Outlook support is required.
4. **Text version:** mirror links and key numbers; do not leave empty `text/plain`.
5. **Testing:** local preview command pattern; no live sends without user consent.
6. **Dark mode:** test contrast; do not assume pure black on pure white.
7. **PII:** placeholders only in samples; never paste real customer emails or addresses.

## Outcomes

- One template file tree + style rules + text body outline + preview command.

## Output Rules

No marketing growth hacks; transactional tone only.

## Scope and boundaries

- **In scope:** receipts, resets, notifications.
- **Out of scope:** cold outreach campaigns, purchased lists.

## Safety

- No real user PII in examples; placeholders only.

## Troubleshooting

- **Broken layout in Outlook:** revert to nested tables; avoid flex/grid.
- **Links rewrite by ESP:** use absolute https URLs; test click tracking carefully.
- **Dark mode email clients:** verify contrast on both themes.

## Related skills

- [`payments-handbook`](../payments-handbook/SKILL.md) - receipt triggers
- [`content-creator`](../content-creator/SKILL.md) - social copy (not transactional)

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/react-email-templates/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
