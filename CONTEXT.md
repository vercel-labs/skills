# Skills

The domain language for discovering, installing, and removing agent skills from external sources.

## Language

**Skill Source**:
The exact origin identifier associated with an installed skill. Different identifiers remain distinct even when they refer to the same repository.
_Avoid_: Repository identity, normalized source

**Unattributed Skill**:
An installed skill whose source is unknown. It remains independently removable without being attributed to a known Skill Source.
_Avoid_: Orphaned skill, stale skill
