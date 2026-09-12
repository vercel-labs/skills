---
name: science-manuscript
description: >-
  Prepare, audit, revise, or template Science-family journal manuscripts and submission packages using Science/AAAS author guidance. Use when Codex needs to work on Science, Science Advances, Science Immunology, Science Robotics, Science Signaling, or Science Translational Medicine submissions; manuscript title, abstract, one-sentence summary, main text, references, acknowledgments, figures, tables, supplementary materials, data/code/materials availability, cover letters, article-type fit, broad-audience framing, or Chinese-to-English submission preparation for Science-family journals.
---

# Science Manuscript Skill

Use this skill to turn research notes, drafts, reviews, or submission materials into a
Science-family manuscript package: journal fit, article-type contract, Science-style
section map, broad-audience writing, figure/supplement logic, and policy risk audit.

The operating model mirrors the Nature skills: define the submission contract first,
then revise the manuscript as an evidence package rather than as isolated prose.

## Source stance

Science author instructions and submission systems can change. Before giving final
submission-ready limits or format claims, load `references/source-basis.md` and verify
the current target-journal author page when possible.

Use sources in this order:

1. Current target-journal Science/AAAS author instructions and submission system.
2. Science/AAAS editorial policies and official author-facing guidance.
3. Target discipline reporting standards, repository rules, and ethics requirements.
4. Legacy template mirrors only as non-authoritative clues when official pages are blocked.

Do not invent word limits, figure limits, article categories, licenses, embargoes,
accession numbers, or policy exceptions. If an official page is unreachable, say so
and mark the item as requiring author-side verification.

## First move: Science submission contract

Before drafting, revising, or auditing, establish:

1. Target journal: `Science`, `Science Advances`, `Science Immunology`, `Science Robotics`,
   `Science Signaling`, `Science Translational Medicine`, or another Science-family venue.
2. Article type and current limits: research article/report/review/perspective/etc.,
   with current word, figure, reference, abstract, and supplement rules if verified.
3. Core claim: one sentence stating what the paper proves and why it matters beyond
   the immediate specialty.
4. Evidence chain: map every figure/table/supplement block to the claim and remove
   material that does not carry a unique burden of proof.
5. Submission package: main manuscript, figures/tables, supplementary materials,
   cover letter, data/materials/code availability, acknowledgments, funding,
   author contributions, competing interests, ethics/reporting files, and related papers.
6. Review risks: novelty, breadth, mechanism, statistics, reproducibility, source data,
   ethical approval, overclaiming, jargon, and possible journal mismatch.

If the target journal or article type is missing, infer conservatively from the user's
context, state the assumption, and keep any journal-specific limits provisional.

## Workflow

1. Classify the manuscript task:
   `template from scratch`, `draft rewrite`, `submission audit`, `cover letter`,
   `response/revision`, `supplement package`, or `journal-fit triage`.
2. Load the relevant references:
   - Template skeleton or section labels: `references/template-contract.md`.
   - Broad-audience prose and Science-style narrative: `references/style-and-structure.md`.
   - Final package check: `references/submission-checklist.md`.
   - Source verification or policy basis: `references/source-basis.md`.
3. Convert the research into a Science argument:
   significance first, evidence in order, methods only where needed for credibility,
   and discussion anchored to what the data support.
4. Rewrite or template sections using Science-style labels and concise, non-jargon
   explanatory logic. Keep exact journal limits provisional unless verified.
5. Audit the submission package before finalizing; lead with blockers, then provide
   ready-to-paste text or a clean skeleton.

## Chinese-user operating mode

When the user writes in Chinese or asks for Science submission help in Chinese:

- Accept Chinese notes naturally, but draft submission-ready manuscript text in English
  unless the user explicitly requests Chinese-only output.
- Translate the scientific intent, not literal phrasing. Replace local grant/report
  language with broad-audience significance, evidence, and limitation language.
- Keep a short Chinese explanation of missing fields or policy risks when it helps
  the author act.
- Flag common risks: overclaiming priority, vague "available on request" language,
  excessive acronym density, unverified target-journal limits, and supplements that
  contain essential results not represented in the main evidence chain.

## Default output formats

For a new manuscript skeleton, return:

```text
Science submission contract
[target, article type, verified/provisional limits, core claim, evidence chain]

Manuscript skeleton
[ready-to-fill section structure]

Package checklist
[files and unresolved fields]
```

For an audit, return:

```text
Blocking issues
[must-fix items]

Revision plan
[ordered edits]

Ready-to-paste replacement
[only when enough information is available]

Unverified Science/AAAS items
[current-author-page checks still needed]
```

## Related files

| File | Open when |
|---|---|
| `references/source-basis.md` | Need official URLs, source hierarchy, or to decide whether a Science rule is current versus provisional |
| `references/template-contract.md` | Need Science-style section labels, article-type intake, or a main/supplement package map |
| `references/style-and-structure.md` | Need to rewrite title, abstract, one-sentence summary, introduction, results, or discussion for a broad Science audience |
| `references/submission-checklist.md` | Before final delivery, upload package assembly, cover letter, data/code/materials audit, or policy risk review |
| `assets/science-manuscript-skeleton.md` | Need a clean fillable skeleton for a Science-style manuscript package |
