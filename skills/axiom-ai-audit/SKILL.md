---
name: axiom-ai-audit
description: >-
  Works out how AI and LLMs change the fundamentals of a field, role, org, product, or way of
  working. Reduces the space to its load-bearing axioms, then sorts each into INVALID (AI killed it),
  STILL HOLDS (survives), or NEW (AI created this problem). Use whenever someone asks how AI/LLMs
  affect, change, disrupt, or reshape anything — a job, an industry, a team's structure, a market, a
  process — or asks what AI makes obsolete vs. what stays true. Triggers: "how does AI change X",
  "what does AI mean for X", "will AI replace X", "how do LLMs affect X", "what's still true in a
  world of AI", "AI-proof", "reimagine X with AI", "what breaks when AI can do X" — even when the
  word "axiom" is never used.
---

# Axiom AI Audit

Every field runs on a handful of unspoken axioms — beliefs so load-bearing nobody states them. Most of them secretly rest on something being **scarce** or **abundant**: expertise is scarce, drafting is slow, synthesis is expensive, review is cheap relative to writing. LLMs **flip** a specific set of those scarcities. This skill finds the axioms, works out which scarcities AI flipped, and sorts each axiom into what died, what survives, and what's newly a problem.

The whole method is one move applied repeatedly: **for each axiom, ask what it assumed was scarce or abundant, then check whether AI flipped it.**

## The capability lens

This is the engine. Run every axiom through it. The lens is stable; the *specifics* of what a model can do are not — so calibrate to reality (see "Calibrate", below) rather than to any frozen snapshot.

**What LLMs flip to abundant** — near-zero marginal cost, fast, and scalable:

- Synthesizing large volumes of information into something usable.
- Generating plausible first-drafts — text, code, images, plans, analysis.
- Translating between formats, languages, styles, and levels of expertise.
- Pattern-matching against everything ever written down.
- Explanation and tutoring on demand, at any level.
- Breadth: competent-generalist coverage across almost every domain at once.

**What stays scarce** — LLMs are weak here, or absent entirely:

- Ground-truth verification — being *reliably* correct, not just confidently plausible.
- Accountability — someone answerable when it's wrong. A model can't be liable.
- Action in the physical and transactional world — anything that isn't producing tokens.
- Judgment under novel, high-stakes ambiguity where there's no pattern to match.
- Genuine relationships, trust, and the standing to make commitments.
- Taste and goal-setting — deciding *what* is worth doing, not just doing it.

**The economics that come with the flip:** cost collapses toward zero, latency drops, and volume becomes effectively unbounded — but output is *probabilistic*, not guaranteed. Confidently wrong is the default failure mode, so anything that was safe *because* cognitive work was expensive and slow is now exposed.

### Calibrate

Instantiate this lens against what's *actually* true for the model running you now, plus the credible near-term trajectory — cheaper, more agentic, longer context, better tool use, more reliable, able to take real actions through tools. Reason from current capability *and* where it's clearly heading; don't anchor to a snapshot that's already stale, and don't assume a limitation is permanent just because it holds today. When a call hinges on a capability that's moving fast, say so.

## The method

Work inline as you go. The four steps are ordered; each ends when its criterion is met.

### Step 1 — Reduce the space to its axioms

Dump the beliefs the field rests on — how it *actually* works, how decisions really get made, what people defend without thinking. Then push each down with "why is that true?" until it can't be reduced further, and collapse any belief that derives from another into its parent. Most first-pass beliefs are tactics in disguise: "consultants write long reports" isn't an axiom, it's a consequence of "synthesizing scattered information into judgment is scarce and expensive."

For each surviving axiom, name the scarcity or abundance it rests on. That's what makes the next step mechanical.

*Done when:* no axiom on the list can be derived from another, and each one names what it assumes is scarce or abundant.

### Step 2 — Name the AI shift for this space

Run the capability lens over the field and state the specific flip: which scarce thing does AI make abundant *here*? Make it a concrete, falsifiable change in what's scarce or abundant — "diagnosis-quality synthesis of a patient's full history goes from scarce specialist time to abundant" — not a vague "AI will help doctors."

*Done when:* the shift is stated as a structural change in what's abundant vs. scarce, tied to a specific capability from the lens.

### Step 3 — Sort every axiom into three buckets

For each axiom from Step 1, ask: did the shift flip the scarcity it rested on?

- **INVALID** — it rested on something AI just made abundant. The belief was true; the flip falsified it. Flag the habit-trap: "we still staff / spend / price / sequence as if this were scarce."
- **STILL HOLDS** — it rests on something still scarce: verification, accountability, physical action, trust, judgment on novel stakes. Name these honestly. The instinct in any AI conversation is to declare everything obsolete; naming what survives is half the value, and over-rotation is the more common error.
- **NEW** — a problem created *by* the new abundance, speed, or scale, that didn't exist before. Phrase as an open problem ("we must solve for X"), not a settled truth.

*Done when:* every axiom sits in exactly one bucket, and each INVALID entry names its habit-trap.

### Step 4 — Where it breaks

Name the one or two places where an INVALID axiom and a NEW axiom directly collide and the field hasn't noticed yet — the contradiction between a habit built on old scarcity and a problem created by new abundance. State it flat, no build-up. Stop at naming the tension; this skill maps what changed, it doesn't prescribe the fix.

*Done when:* at least one concrete collision is named, or you've honestly concluded none exists yet.

## Output

Think inline, and **always** write the analysis to a file so the structure is identical every run. Save `<topic>-ai-axioms.md` using exactly this template. The H1 is the user's question phrased as a question — reuse their wording ("What changes for the web tech stack with AI?"), not a restated title:

```markdown
# <the user's question, e.g. "What changes for X with AI?">

## The shift
<one or two sentences: which scarce thing AI makes abundant here, tied to a specific capability>

## The axioms
<the load-bearing beliefs from Step 1, each naming the scarcity/abundance it rests on>

## Now INVALID
1. **<belief>.** <the scarcity AI flipped; the habit-trap it leaves behind>

## STILL HOLDS
1. **<belief>.** <the still-scarce thing it rests on>

## NEW — to solve for
1. **<belief, as an open problem>.** <what the new abundance/speed/scale forces>

## Where it breaks
<one or two collisions between an INVALID axiom and a NEW one>
```

Keep the real output grounded in the user's specific topic. Match the template's structure exactly; match the *depth* to the topic, not the length of the examples below.

## Voice — sound like a sharp person, not a chatbot

- **No fundamentals theater.** Cut "at its core," "the real question is," "the deepest truth," "the whole point." State the axiom; don't narrate that you're finding bedrock or editorialize that it matters.
- **No AI hype tone.** Skip "revolutionize," "game-changer," "paradigm shift." The analysis is interesting because it's specific, not because you said it's big.
- **Plain verbs.** Say what happens without dramatizing it.
- **No connective narration.** Cut sentences whose only job is to announce structure. Present the buckets; the reader sees the structure.
- **Forced triplets.** If two items are real and the third is padding, cut it.
- **"Not just X, it's Y."** Write the positive claim instead.
- **Em-dash spray.** A couple per answer, not one per sentence.
- **Honesty over excitement.** The STILL HOLDS bucket is where credibility is won. Resist the pull to move things into INVALID because it reads as bolder.

## Worked examples

Keep these as calibration for depth and shape — don't copy their content.

**"How do LLMs change the knowledge worker's role?"**
- *The shift:* synthesizing scattered information into a usable answer goes from scarce (a trained person's hours) to abundant (seconds, near-free).
- *Now invalid:* "the person who can gather and synthesize information is the valuable one." That skill was the moat; it's now a commodity. The habit-trap: orgs still hire, promote, and bill for synthesis hours as if they were the scarce good.
- *Still holds:* "someone must be accountable for the decision and own the outcome." Accountability didn't get cheaper — a model can't be answerable. Knowing which question to ask and whether the answer is right stays scarce.
- *New, to solve for:* "when a good-enough answer is free and instant, the bottleneck is judging quality and deciding what's worth doing." The scarce act moves from producing the analysis to framing the problem and verifying the output at volume.
- *Where it breaks:* "we pay for synthesis" (invalid) collides with "the value is now judgment and accountability" (new) — orgs whose ladder rewards output volume are promoting the wrong thing.

**"How does AI change the balance of power inside an org?"**
- *The shift:* the cost of turning intent into a delivered artifact — a doc, a prototype, a campaign, a working feature — collapses, so delivery speed stops being gated by headcount in the executing function.
- *Now invalid:* "the function that controls execution capacity controls the roadmap." Leverage came from owning the scarce hands that build; when building is cheap, that leverage thins. Habit-trap: teams still negotiate priority as if execution slots were the scarce currency.
- *Still holds:* "someone must own whether the thing is correct, safe, and worth shipping." Cheaper production doesn't make correctness or accountability cheaper.
- *New, to solve for:* "when anyone can produce a plausible artifact, the scarce thing is deciding which to trust and ship." Coordination and verification, not production capacity, become the constraint.
- *Where it breaks:* "priority is set by who can build it" (invalid) collides with "the constraint is now trust and verification" (new) — orgs still resourcing by build-capacity are widening a review-and-trust gap nobody owns.

**"What does AI change about frontline medicine?"**
- *The shift:* expert-level synthesis of a patient's full record and the literature goes from scarce specialist time to abundant and instant.
- *Now invalid:* "access to synthesized medical knowledge is gated by scarce expert time." The information asymmetry that structured referrals and second opinions thins.
- *Still holds:* "a licensed, accountable human must own the diagnosis and the physical act of treatment." Liability, the physical exam, the procedure, and the patient's trust stay scarce and human. Being confidently wrong is more dangerous here than almost anywhere.
- *New, to solve for:* "when plausible diagnoses are free and abundant, the scarce act is verifying them against ground truth and owning the risk of acting." Verification at volume, and clear accountability for AI-assisted calls, become the problem.
- *Where it breaks:* "the expert's knowledge is the bottleneck" (invalid) collides with "verification and liability are the bottleneck" (new) — systems rushing to deploy AI synthesis without redesigning who verifies and who's accountable are moving the risk, not removing it.
