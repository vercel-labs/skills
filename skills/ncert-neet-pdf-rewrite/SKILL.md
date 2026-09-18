---
name: ncert-neet-pdf-rewrite
description: Convert an NCERT Biology (or similar NCERT) chapter into a rewritten, exam-focused ("NEET-style") print-ready PDF plus the Python/ReportLab script that generates it. Use when the user attaches/uploads an NCERT chapter (PDF or docx) and asks to turn it into a NEET rewrite, revision PDF, or references "the NCERT to NEET PDF workflow" / "the master prompt". This is a file-asset deliverable (deliver via presentAsset), not a web/mobile artifact — do not create a Replit artifact for this.
---

# NCERT → NEET PDF Rewrite

Produces a complete, reorganized, zero-information-loss rewrite of one NCERT chapter as a styled
A4 PDF (built directly with Python + ReportLab), delivered together with the exact script that
generated it. This is a document-generation task, not an app-build task: no Replit artifact should
be created — deliver both files with `presentAsset`.

The full, authoritative content/style/process specification lives in
`references/master-prompt.md` — **read it in full before starting any chapter.** It is long and
detailed on purpose; do not paraphrase from memory or skip sections. What follows here is the
condensed operational checklist plus lessons from running this workflow that aren't in the prompt
itself (environment setup gotchas, what the verification pass actually catches, and a known false
positive).

## When to use this

- The user attaches an NCERT chapter (PDF/docx) and asks for a NEET-style rewrite, revision notes,
  or exam-focused PDF version of it.
- The user references this workflow by name ("the NCERT to NEET pipeline", "the master prompt
  PDF thing") for a new chapter.
- Always re-read `references/master-prompt.md` per chapter/session — do not assume the rules are
  memorized correctly; the prompt is the single source of truth for content and style rules.

## Operational sequence

### 1. Environment setup (every session — the sandbox resets)
Install Python 3.11 if not present, then:
```bash
pip install --break-system-packages reportlab pdfplumber pymupdf
```
`reportlab` generates the PDF. `pdfplumber` and `pymupdf` (`fitz`) are only needed for the
verification pass (text extraction and page-image rendering respectively) — not for generation
itself. Confirm all three import cleanly before proceeding; don't write around a failed import.

### 2. Read everything fully, twice
Read the entire source chapter (including the summary and exercises — treat the summary as a
second source document per the master prompt's Rule 3, not a recap to skim) and the full master
prompt before writing anything. Do the pre-writing inventory pass described in the master prompt's
§6 — this is where nearly all the rigor belongs; a rushed inventory here is the single biggest
cause of a failed final check, not the writing or the verification step.

### 3. Handle genuine source gaps honestly (Rule 5 — anti-hallucination)
If the chapter summary or exercises reference something the chapter body never actually explains,
do not invent the missing explanation from general biology knowledge. Either:
- close it properly if it's a real exercise-gap (master prompt Rule 2 — add a correct, sourced
  explanation inline or in a "Terms used in the exercises" appendix), or
- if it's a genuine unrecoverable gap in the source itself (e.g. summary names something the body
  never covers), flag it explicitly as a NOTE box rather than silently fabricating facts to fill it.

Exercise questions explicitly framed as open discussion ("discuss with your teacher") are not
factual gaps — don't fabricate answers for these.

### 4. Write the script directly from the frozen inventory
Follow the master prompt's §3–§5 structure, style spec, and content order exactly (canonical
`STYLES` dict, table styling constants, box types, heading banners, inline `<sub>`/`<super>` tags
instead of Unicode, `# ---- N.N ----` section-number comments above each block, one linear
`story.append(...)` sequence). Name the two output files identically apart from extension, e.g.
`Ch07_HumanHealthAndDisease.pdf` / `.py`.

### 5. Verification pass (single thorough pass, not a repair loop)
Run in this order — visual check before text extraction, since layout bugs (overflow, clipping,
an orphaned heading, wrong banner color) don't show up in extracted text at all:

1. **Render every page to an image** with `fitz` at ~1.6x scale and look at each one directly —
   don't skip pages that "should be fine."
2. **Extract text** with `pdfplumber` to sanity-check content integrity and confirm specific
   phrases after any edit.
3. **Dispatch parallel `explore` subagents**, one per contiguous group of sections (e.g.
   intro+7.1, 7.2, 7.3+7.4, 7.5+summary), each given the source file path and the script path and
   told to read fully — not grep — and classify every finding as MISSING / FABRICATED / DRIFTED,
   with explicit attention to qualifier words (*usually, generally, mostly, only, always, never,
   may, unlike, majority, most, some, all*) — these are the fact class most likely to silently
   drift during rewriting and the ones that cost marks on T/F and assertion-reason questions.
4. **Confirm every flag by reading the actual source/script passage yourself** — never accept or
   dismiss a flag on a grep/search result alone. A search miss doesn't mean a fact is absent (it
   may be paraphrased or reflowed by a table), and a hit doesn't mean it's stated correctly.
5. **Fix only confirmed issues** directly in the block found via its `# ---- N.N ----` comment,
   tag the change `# [VERIFICATION FIX]`, regenerate, and re-check only the changed page(s)/text —
   not a full re-run, since the rest was already verified.

**Known false positive to expect:** verification subagents sometimes flag "the Exercises section
is completely missing from the script" as a gap. This is usually not real — the master prompt only
requires closing factual gaps that exercise questions assume but the body never explains (Rule 2),
not reproducing the exercise questions themselves. Check the master prompt's exact wording (§2
Rule 2, §5 item 9) before acting on this class of flag.

If a verification pass surfaces more than a handful of scattered issues, that's a signal the
pre-writing inventory (step 2) was rushed — go back and redo that, rather than patching the script
piecemeal against a shaky checklist.

### 6. Deliver
Always both files, actually saved (never the script only pasted inline in chat):
- `presentAsset` the PDF.
- `presentAsset` the `.py` script.

Include a short coverage note: what was compressed/merged and why it's safe, confirmation every
exercise-assumed term is covered, any drift caught and fixed during verification, and any part of
the source flagged as garbled, unrecoverable, or an intentional NOTE-boxed gap.

If the user later comes back with a new error/audit list for the same chapter, the expected
response is to open that same `.py` file, edit only the flagged block, rerun it, and hand back the
regenerated PDF + updated script — not a rewrite from scratch.

## Full specification
See `references/master-prompt.md` for the complete, authoritative rules: content rules (zero
information loss, exercise-gap closing, what's allowed to cut, exact-term/qualifier preservation,
anti-hallucination), the full PDF design spec (colors, canonical ReportLab `STYLES` block, table
rules, box types, ReportLab technical constraints), content ordering, and the detailed pre-writing
and verification procedures. Read it in full each time — do not rely on this summary alone when
writing the script.
