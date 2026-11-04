# Programmatic API

`skills` can be used as a library, so other tools (framework CLIs, editors,
scaffolders) can install and manage skills without spawning the CLI or
sharing the terminal with it.

```bash
npm install skills
```

```ts
import { detectAgents, installSkills, resolveSource } from 'skills';

const { agents } = await detectAgents({ cwd });

// Preview a source, ask the user, then install without fetching again
const source = await resolveSource('vercel-labs/agent-skills', { cwd });
try {
  console.log(source.skills.map((skill) => skill.name));
  const result = await installSkills(source, {
    cwd,
    skills: ['nuxthub'],
    agents: ['claude-code', 'cursor'],
  });
  for (const failure of result.failed) console.warn(failure.message);
} finally {
  await source.dispose();
}
```

The package is ESM only and requires Node.js 22.20 or later.

## Functions

| Function                        | Description                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `getAgents()`                   | Every supported agent: id, name, project and global skills directories.          |
| `detectAgents(options?)`        | Agents installed on this machine or in `cwd`, limited by `config.agents`.        |
| `resolveSource(source, opts?)`  | Fetch a source and list its skills without installing. Returns a `SkillSource`.  |
| `installSkills(source, opts?)`  | Install skills from a source string or a `SkillSource`.                          |
| `listSkills(options?)`          | Skills installed in the project, globally, or both, with their lock-file source. |
| `removeSkills(names, options?)` | Remove skills by name (or lock source; `*` for all) from the allowed agents.     |
| `version`                       | The installed package version.                                                   |

Sources take the same forms as `skills add`: GitHub shorthand (`owner/repo`,
`owner/repo@skill`), git and HTTPS URLs, well-known endpoints, and local paths
(resolved against `cwd`).

A `SkillSource` owns a temporary clone or download. Dispose it when you are
done; `installSkills` never disposes a source it was given, so one fetch can
serve several installs. When `installSkills` receives a string, it fetches
and cleans up by itself.

## Behavior

- **No terminal side effects.** API calls never prompt, print, show spinners,
  or exit the process. Progress is reported through `onProgress`.
- **Two kinds of failure.** When nothing can be attempted (an invalid source,
  an unknown agent or skill name, an unreadable lock file), the call throws a
  `SkillsError` with a `code`. When individual skills or agents fail, the call
  still completes and lists them in `result.failed`.
- **Defaults match `skills add -y`.** Without `agents`, skills go to the agents
  `add -y` would pick (the agent you run inside, else the detected ones).
  Without `mode`, skills are symlinked from one shared copy when targets use
  different directories, and copied otherwise.
- **Lock files.** Installs and removals update `skills-lock.json` (project) or
  the global lock unless `lockfile: false`, so `skills update` and
  `skills experimental_install` keep working.
- **Cancellation.** `signal` is checked between steps; a running clone is not
  interrupted.

## Configuration

Every function accepts `config`, a `SkillsConfig` object of shared settings.
Options passed to a call take precedence over `config`, which takes
precedence over the defaults.

```ts
import type { SkillsConfig } from 'skills';

const config: SkillsConfig = {
  scope: 'project', // 'project' | 'global'
  mode: 'auto', // 'auto' | 'symlink' | 'copy'
  lockfile: true,
  fullDepth: false,
  includeInternal: false,
  telemetry: true,
  agents: {
    include: ['claude-code', 'cursor'], // only these may be targeted
    exclude: [], // never targeted
    default: ['claude-code'], // targets when a call names none
  },
};

await installSkills('vercel-labs/agent-skills', { cwd, config, mode: 'copy' });
```

`config.agents` limits targets; a call can narrow it but never widen it.
Install calls report a named agent the config does not allow as an
`AGENT_NOT_ALLOWED` failure and install into the rest; they throw
`NO_TARGET_AGENTS` when no allowed agent is left. `detectAgents` returns only
allowed agents, and `removeSkills` only touches allowed agents (naming a
disallowed one throws `AGENT_NOT_ALLOWED`). `listSkills` reports everything on
disk.

`SkillsConfig` is JSON-serializable on purpose: it is the shape a future
`skills.config.json` / `skills.config.ts` file will have. The library will
never read such files implicitly; callers will load and pass them.

## Telemetry

Install and remove calls send the same anonymous telemetry as the CLI (only
for public repositories). Turn it off per call or in config with
`telemetry: false`; `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1` always turn it
off. See [what is collected](troubleshooting.md#telemetry).

## Error codes

`SkillsError.code` and the `code` of each failure is one of:

| Code                   | Meaning                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `INVALID_OPTIONS`      | An option has the wrong type or value.                            |
| `INVALID_SOURCE`       | The source string could not be parsed.                            |
| `SOURCE_NOT_FOUND`     | A local source path does not exist.                               |
| `SOURCE_FETCH_FAILED`  | Cloning or downloading the source failed.                         |
| `SOURCE_DISPOSED`      | A `SkillSource` was used after `dispose()`.                       |
| `NO_SKILLS_FOUND`      | The source contains no skills.                                    |
| `SKILL_NOT_FOUND`      | A requested skill name is not in the source.                      |
| `UNKNOWN_AGENT`        | An agent id is not supported (see `getAgents()`).                 |
| `AGENT_NOT_ALLOWED`    | `config.agents` does not allow the agent.                         |
| `NO_TARGET_AGENTS`     | No allowed agent is left to install into or remove from.          |
| `GLOBAL_NOT_SUPPORTED` | The agent has no global skills directory.                         |
| `GLOBALLY_TRACKED`     | A project remove would delete a skill tracked by the global lock. |
| `INVALID_LOCKFILE`     | The lock file is unreadable or could not be updated.              |
| `INSTALL_FAILED`       | Writing a skill into an agent's directory failed.                 |
| `REMOVE_FAILED`        | Removing a skill failed.                                          |
| `ABORTED`              | `signal` was aborted.                                             |

New codes may be added in minor releases; handle unknown codes generically.

## Stability

The API follows semver. Its full surface is recorded in
[`__snapshots__/tsnapi`](../__snapshots__/tsnapi) and checked on every build
by [tsnapi](https://github.com/antfu/tsnapi), so any change to it is reviewed
explicitly.

Rules the API follows, so it can grow without breaking callers:

- One entry point (`skills`). Every export is listed by name in
  `src/index.ts`; internal modules and types are never exported.
- Public types are written by hand in `src/api/types.ts` and never alias
  internal types.
- Functions take required inputs positionally and everything else in one
  options object. New behavior arrives as new optional options.
- Async results are objects, never bare arrays, so fields can be added.
  Returned objects are frozen.
- Agent ids are plain strings validated at runtime, so adding an agent never
  changes the type surface.
- Inputs may later widen (for example `agents` accepting objects for Eve
  subagents); outputs only gain fields or union members.

### Changing the API

```bash
pnpm build                 # fails with a diff when the API changed
pnpm api:update            # accept an additive change
pnpm api:update:breaking   # accept a breaking change (needs a major release)
```

Commit the updated snapshot files together with the change.
