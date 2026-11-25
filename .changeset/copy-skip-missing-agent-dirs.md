---
'skills': patch
---

Copy installs from `add`, `update`, and the programmatic API skip project agents whose directory doesn't exist, the same as symlink installs, so `update` no longer writes copies like `agent/skills/` for agents the project doesn't use. Explicitly selected agents (`-a kiro-cli`) still get their directory, and so does a copy install whose only targets are missing.
