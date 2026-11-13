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
| `getSupportedAgents()`          | Every supported agent (including `universal`): id, name, skills directories.     |
| `detectAgents(options?)`        | Agents installed on this machine or in `cwd`, limited by `config.agents`.        |
| `resolveSource(source, opts?)`  | Fetch a source and list its skills without installing. Returns a `SkillSource`.  |
| `installSkills(source, opts?)`  | Install skills from a source string or a `SkillSource`.                          |
| `listSkills(options?)`          | Skills installed in the project, globally, or both, with their lock-file source. |
| `removeSkills(names, options?)` | Remove skills by name (or lock source; `*` for all lock-tracked skills).         |
| `version`                       | The installed package version.                                                   |

Sources take the same forms as `skills add`: GitHub shorthand (`owner/repo`,
`owner/repo@skill`), git and HTTPS URLs, well-known endpoints, and local paths
(resolved against `cwd`).

Pass `ref` (a branch, tag, or full commit SHA) to pin a git source instead of
appending `#ref` to the string. For cloned git sources, `source.commit` is the
commit that was checked out, so a pin can be verified without running git.
GitHub repositories fetched without a `ref` may use a faster snapshot path
that has no commit; pass a `ref` when you need one.

Each `SkillInfo` has a `path` relative to the source root. When several
folders declare the same skill name, the first one found wins (as with
`skills add`) and the others are listed in `duplicates`. Symlinked folders
are not discovered, so they never count as duplicates.

A `SkillSource` owns a temporary clone or download. Dispose it when you are
done; `installSkills` never disposes a source it was given, so one fetch can
serve several installs. When `installSkills` receives a string, it fetches
and cleans up by itself.

### Installing into a plain directory

`universal` is a neutral target: `<cwd>/.agents/skills/<name>` (or its global
equivalent), which every universal agent reads. Combined with `mode: 'copy'`
it copies skills into a directory with no agent-specific links:

```ts
await installSkills(source, {
  cwd: stagingDir,
  skills: ['nuxthub'],
  agents: ['universal'],
  mode: 'copy',
  lockfile: false,
  telemetry: false,
  duplicates: 'error', // refuse names declared by several folders
  symlinks: 'reject', // refuse skills that contain symlinks
});
```

### Installing under another name

`rename` installs skills under new names, keyed by the name the source uses.
The new name is used for the folder, the lock entry and the SKILL.md `name`.
The lock remembers the original name, so `skills update` and restores keep the
new name, and `listSkills` reports it as `renamedFrom`. Skills not in the map
install as-is:

```ts
await installSkills('shadcn/ui', { skills: ['shadcn'], rename: { shadcn: 'shadcn-ui' } });

await installSkills(source, {
  rename: { 'frontend-design': 'acme-frontend', 'skill-creator': 'acme-skill-creator' },
});
```

The call throws before writing anything when a key matches no skill being
installed (`SKILLS_NO_MATCHING_SKILLS`) or several (`SKILLS_AMBIGUOUS_SKILL_SELECTOR`),
when a new name is not a safe folder name (lowercase letters, digits, `.`, `_`
and `-`), or when two skills would end up with the same name
(`SKILLS_INVALID_OPTION_VALUE`).

## Behavior

- **No terminal side effects.** API calls never prompt, print, show spinners,
  or exit the process. Progress is reported through `onProgress`, and
  non-fatal problems (a skipped invalid `SKILL.md`, a skipped unsafe symlink)
  through `onWarning`; without a handler they are dropped.
- **Two kinds of failure.** When nothing can be attempted (an invalid source,
  an unknown agent or skill name, an unreadable lock file), the call throws a
  diagnostic (see [Errors](#errors)). When individual skills or agents fail,
  the call still completes and lists them in `result.failed`.
- **Defaults match `skills add -y`.** Without `agents`, skills go to the agents
  `add -y` would pick (the agent you run inside, else the detected ones).
  Without `mode`, skills are symlinked from one shared copy when targets use
  different directories, and copied otherwise.
- **Lock files.** Installs and removals update `skills-lock.json` (project) or
  the global lock unless `lockfile: false`, so `skills update` and
  `skills experimental_install` keep working.
- **Strict installs.** `duplicates: 'error'` refuses selected skills whose
  name several folders declare, and `symlinks: 'reject'` refuses selected
  skills that contain symlinks. Both throw before anything is written. A
  requested name that matches several different skills (for example
  `foo-bar` matching `Foo Bar` and `foo_bar`) always throws
  `SKILLS_AMBIGUOUS_SKILL_SELECTOR`.
- **Cancellation.** `signal` is checked between steps (a running clone is not
  interrupted); an aborted call rejects with `signal.reason`, usually an
  `AbortError`.

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
  duplicates: 'first', // 'first' | 'error'
  symlinks: 'follow', // 'follow' | 'reject'
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

## Errors

Errors and warnings are [nostics](https://github.com/antfu/nostics)
diagnostics from the same catalog the CLI uses, exported as `diagnostics`.
Each has a permanent `code` (`SKILLS_*`), a `message`, and often a `fix`.
Check them with `isDiagnostic`:

```ts
import { installSkills, isDiagnostic } from 'skills';

try {
  await installSkills(source, options);
} catch (error) {
  if (isDiagnostic(error, 'SKILLS_GIT_CLONE_TIMEOUT')) return retry();
  if (isDiagnostic(error, 'SKILLS_GIT_AUTH_FAILED', 'SKILLS_GIT_SAML_SSO_BLOCKED')) {
    return askForCredentials();
  }
  throw error;
}
```

Per-skill failures in `result.failed` carry the same `code` and `message`.
Fetch failures are the original diagnostic from git, the download, or the
archive, not a wrapper. Git hosts report a private repository you cannot
access as "not found", so `SKILLS_GIT_AUTH_FAILED` also covers repositories
that do not exist; a missing branch, tag, or commit is `SKILLS_GIT_CLONE_FAILED`.

Codes most API callers handle:

| Code                                                    | Meaning                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `SKILLS_INVALID_OPTION_VALUE`                           | An option or argument has the wrong type or value.                   |
| `SKILLS_INVALID_AGENTS`                                 | An agent id is not supported (see `getSupportedAgents()`).           |
| `SKILLS_LOCAL_PATH_NOT_FOUND`                           | A local source path does not exist.                                  |
| `SKILLS_GIT_CLONE_TIMEOUT`                              | The clone timed out; retrying may succeed.                           |
| `SKILLS_GIT_AUTH_FAILED`, `SKILLS_GIT_SAML_SSO_BLOCKED` | Access was denied, or the repository does not exist.                 |
| `SKILLS_GIT_CLONE_FAILED`                               | Cloning failed otherwise (including a missing ref).                  |
| `SKILLS_SOURCE_FETCH_FAILED`                            | Fetching failed with an error that has no specific code.             |
| `SKILLS_SOURCE_DISPOSED`                                | A `SkillSource` was used after `dispose()`.                          |
| `SKILLS_NO_VALID_SKILLS`                                | The source contains no skills.                                       |
| `SKILLS_NO_MATCHING_SKILLS`                             | A requested skill name is not in the source.                         |
| `SKILLS_AMBIGUOUS_SKILL_SELECTOR`                       | A requested name matches several different skills.                   |
| `SKILLS_DUPLICATE_SKILL_NAME`                           | With `duplicates: 'error'`, several folders declare a selected name. |
| `SKILLS_SKILL_CONTAINS_SYMLINKS`                        | With `symlinks: 'reject'`, a selected skill contains a symlink.      |
| `SKILLS_AGENT_NOT_ALLOWED`                              | `config.agents` does not allow the agent.                            |
| `SKILLS_NO_TARGET_AGENTS`                               | No allowed agent is left to install into or remove from.             |
| `SKILLS_GLOBAL_INSTALL_UNSUPPORTED`                     | The agent has no global skills directory.                            |
| `SKILLS_REMOVE_GLOBALLY_TRACKED`                        | A project remove would delete a skill tracked by the global lock.    |
| `SKILLS_REMOVE_UNTRACKED_SKIPPED`                       | Warning: `*` skipped skill folders the lock does not track.          |
| `SKILLS_INVALID_LOCAL_LOCK`                             | `skills-lock.json` is unreadable; nothing was written.               |
| `SKILLS_LOCK_WRITE_FAILED`                              | Skills were installed but the lock file could not be updated.        |
| `SKILLS_INSTALL_FAILED`, `SKILLS_REMOVE_FAILED`         | Writing or removing one skill failed.                                |

Codes are never renamed or reused. New codes may be added in minor releases,
so handle unknown codes generically.

`onWarning` receives diagnostics too: `SKILLS_SKILL_SKIPPED` (an invalid
`SKILL.md` was not discovered) and `SKILLS_BROKEN_SYMLINK`,
`SKILLS_SYMLINK_OUTSIDE_SKILL`, `SKILLS_SYMLINK_CYCLE` (an unsafe symlink
inside a skill was not copied). Their `data.path` is the file concerned, which
may be inside a temporary clone.

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
