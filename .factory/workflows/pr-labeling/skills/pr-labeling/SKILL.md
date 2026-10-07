---
name: pr-labeling
description: Classify a skills CLI pull request from its description and patch, while respecting existing labels.
---

# Label a skills CLI pull request

1. Use `read_pull_request` with the number in the trigger message. Read the title, description,
   current labels, and changed file patches. If the head commit no longer matches the triggered
   commit, stop so a newer run can classify it.
2. If the pull request already has `bug`, `documentation`, or `enhancement`, stop. Keep labels
   chosen by maintainers or earlier runs.
3. Choose one label from the primary change supported by the patch:
   - `documentation`: changes only documentation, examples, or explanatory text, without changing
     CLI behavior.
   - `bug`: corrects existing CLI behavior, including installation, update checks, source parsing,
     agent detection, or security checks.
   - `enhancement`: adds or intentionally expands CLI behavior, commands, agent support, or
     integration support.
4. If the patch is truncated, mixed, or insufficient to classify confidently, stop without adding
   a label. Do not infer a label from the title alone.
5. Use `add_label` once, with the triggering pull request number and the chosen label.
