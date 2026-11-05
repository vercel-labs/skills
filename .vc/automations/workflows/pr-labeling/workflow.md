---
description: Label new and updated skills CLI pull requests by change type
on:
  events:
    - pull_request.opened
    - pull_request.synchronize
actions:
  github.read_pull_request: true
  github.add_label:
    labels:
      - bug
      - documentation
      - enhancement
---

Read the pull request that triggered this run, then load the `pr-labeling` skill. Add one
change-type label only when the pull request clearly qualifies. Leave existing labels and
ambiguous pull requests alone. Work only on the triggering pull request.
