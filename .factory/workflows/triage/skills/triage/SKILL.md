---
name: triage
description: Identify focused, evidence-backed skills CLI bug fixes worth quuu's attention.
---

# Triage a new skills CLI pull request

## Read the actual change

Use `read_pull_request` with the triggering PR number. Record its head SHA, state, labels,
description, and every changed file patch. Stop if it is closed, the head differs from the
triggered SHA, or `triage:bug-fix` is already present. The separate `pr-labeling` workflow's
`bug` label is neither evidence of validity nor a reason to skip this assessment.

Stop without public effects when files are omitted (`filesTruncated`), a relevant patch is
missing or truncated, or the available context cannot establish the diagnosis. Do not infer
correctness from a `fix:` title, issue number, author, or reported test success alone.

## Require a valid bug fix

All of the following must be supported by the visible description and patch:

1. **Existing defect:** identify the previous incorrect behavior, affected command or supported
   agent, and expected behavior. Examples include false success or incorrect exit status,
   missing or stale lock entries, wrong install/update/remove paths, missing supporting files
   or executable permissions, unsafe deletion, source parsing errors, and privacy or security
   checks that do not honor the existing contract.
2. **Correct mechanism:** explain how the changed code addresses that defect. The change must
   preserve other supported agents, platforms, source types, project/global scopes, and install
   modes affected by the same code. A path fix for one agent must not redirect unrelated agents;
   a lock fix must cover the source types it promises to track.
3. **Focused scope:** prefer the smallest coherent correction. A new command, provider, agent,
   integration, default-selection policy, or expanded feature is an enhancement, not a bug fix.
   Refactors, dependency bumps, generated metadata, documentation-only changes, and speculative
   cleanup do not qualify by themselves. Mixed feature/fix PRs that require a product decision
   should remain quiet.
4. **Meaningful regression coverage:** identify a changed or added test that exercises the
   original failure and asserts the corrected behavior. It must fail for the old mechanism,
   rather than only mirror the new implementation or change a snapshot. Shared installer/path
   changes need coverage preserving unaffected agents or scopes. Claims of passing tests without
   visible regression coverage are insufficient.
5. **No visible blocker:** reject fixes that swallow errors, weaken assertions, bypass security
   or privacy boundaries, fabricate success, introduce obvious cross-agent regressions, or make
   generated dependency/license notices inconsistent with the actual changes. If the description
   says the same defect is already fixed or the PR is superseded, do not surface it. Do not claim
   to have searched the backlog: this workflow has no general PR-search action.

If any criterion is uncertain, finish quietly. Do not post a speculative finding or ask quuu
to perform the initial diagnosis. Existing maintainer labels such as `invalid`, `duplicate`, or
`wontfix` are reasons to stop, not labels to override.

## Describe verification honestly

When useful, use `list_workflow_runs` for `ci.yml`, then `list_run_jobs` or `read_job_log`.
Associate a run with this PR and the exact recorded head SHA; an old green run is not evidence
for the current patch. A current-head failure caused by the proposed change is a blocker.
Pending, approval-gated, absent, unrelated, or unexplained failed checks are limitations, never
passing checks. CI status alone does not establish validity.

This workflow cannot execute tests, inspect arbitrary repository files, read PR discussion,
verify commit signatures, or establish merge readiness. Do not claim reproduction, independent
verification, signed commits, complete review, or passing checks beyond the evidence returned
by the declared tools. A clear patch with a sound regression test may qualify while CI is
pending; disclose that status in the handoff.

## Label and hand off once

Before writing, reread the triggering PR. Stop if it closed, its head changed, a disqualifying
label appeared, or `triage:bug-fix` is now present.

Draft the comment before writing. Use exactly this Markdown structure, with a blank line
between the opening sentence and the three bullets. Replace the placeholders; do not include
code-fence or blockquote markers in the published comment:

```markdown
@quuu — bug-fix candidate.

- **Fix:** <user-visible failure corrected, one short sentence>.
- **Tests:** <regression behavior covered; name at most one test file>.
- **CI:** <observed current-head status or unavailable> (head `<8-character SHA>`).
```

The entire comment must be at most 500 characters and 75 words, including Markdown. Check
both limits and the blank line before publishing; shorten the draft if necessary. Use plain
language. Omit function names, code excerpts, full test names, full commit hashes, repeated
caveats, and explanations of the implementation mechanism. Keep detailed reasoning, the full
assessed SHA, and delivery results in the internal workflow output. The public comment is a
maintainer handoff; the opening calls it a candidate and does not imply merge approval.

Use `add_label` once to add `triage:bug-fix`. Only after confirmed label success, use `comment`
once to publish the checked draft on the same PR. Do not repeat the mention or add a second
comment in this run. The triage label suppresses later assessments; preserve every other
label. If label or comment delivery fails or is ambiguous, report the partial result in the
workflow output and do not blindly repeat a comment. The tools do not offer comment-history
reconciliation or an atomic label-and-comment operation, so do not claim exactly-once delivery.
