# Fix global installation symlink for Antigravity

Currently, the `skills` CLI assumes that all "universal agents" (agents that use `.agents/skills` locally) also read from the canonical global directory `~/.agents/skills` when installed globally. Thus, it deliberately skips creating agent-specific global symlinks for these agents to avoid duplicates.

However, Antigravity is a universal agent locally but it exclusively reads from its own global skills directory (`~/.gemini/antigravity/skills`). Because of the existing logic, global installations of skills for Antigravity do not get symlinked, making them unavailable in Antigravity.

## Proposed Changes

We will introduce a `requiresGlobalSymlink` flag to the `AgentConfig` type to explicitly opt-out of the symlink-skipping behavior for specific universal agents that still need their own global symlinks.

### `src/types.ts`
- Add an optional boolean property `requiresGlobalSymlink` to the `AgentConfig` interface.

### `src/agents.ts`
- Update the `antigravity` configuration to include `requiresGlobalSymlink: true`.

### `src/installer.ts`
- Modify `installSkillForAgent`, `installRemoteSkillForAgent`, `installWellKnownSkillForAgent`, and `installBlobSkillForAgent` so they do not skip the global symlink if the agent's config specifies `requiresGlobalSymlink: true`.
- Change the `if (isGlobal && isUniversalAgent(agentType))` condition to:
  `if (isGlobal && isUniversalAgent(agentType) && !agents[agentType].requiresGlobalSymlink)`

## User Review Required
Does this correctly address the problem for Antigravity while keeping the expected behavior for other agents?

## Verification Plan
1. Ensure the project builds successfully (`npm run build`).
2. Run the test suite (`npm test`) to ensure no regressions.
3. Validate that for `antigravity`, the symlink is created by writing a quick integration test if necessary, or by relying on existing testing patterns.
