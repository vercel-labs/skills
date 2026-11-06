# skills

The CLI for the open agent skills ecosystem.

Agent skills are reusable instructions that teach coding agents how to perform tasks,
from reviewing code to working with a library. Discover skills at [skills.sh](https://skills.sh).

<!-- agent-list:start -->
Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [75 more](docs/agents.md).
<!-- agent-list:end -->

<p>
  <a href="https://vercel.com/labs#labs-products"><img alt="Vercel Labs Product" src="https://img.shields.io/badge/LABS-PRODUCT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/skills"><img alt="npm version: skills" src="https://img.shields.io/npm/v/skills.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/skills/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/vercel-labs/skills.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/skills"><img alt="npm downloads per month: skills" src="https://img.shields.io/npm/dm/skills.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
  <a href="https://skills.sh/vercel-labs/skills"><img alt="skills.sh" src="https://skills.sh/b/vercel-labs/skills?style=for-the-badge" height="28"></a>
</p>

## Install a Skill

Requires Node.js 22.20 or later. Run this from your project:

```bash
npx skills add vercel-labs/agent-skills
```

Choose the skills and coding agents to install to. Skills are installed to the current
project by default; add `-g` to make them available across projects.

```bash
# Choose one skill and agent
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code

# Browse available skills
npx skills find
```

See the [installation reference](docs/commands.md#skills-add) for source formats,
private repositories, and all options.

## Other Commands

| Command                           | Description                      |
| --------------------------------- | -------------------------------- |
| `npx skills find [query]`         | Search for skills                |
| `npx skills list`                 | List installed skills            |
| `npx skills use <source>@<skill>` | Use one skill without installing |
| `npx skills check`                | Check for available updates      |
| `npx skills update [skills...]`   | Update installed skills          |
| `npx skills remove [skills...]`   | Remove installed skills          |
| `npx skills init [name]`          | Create a skill template          |

Read the [CLI reference](docs/commands.md) or run `npx skills --help` for examples and options. Experimental commands are listed [below](#experimental-features).

## Use a Skill Without Installing

Generate a prompt for a skill, or launch a supported coding agent with it:

```bash
npx skills use vercel-labs/agent-skills@web-design-guidelines --agent claude-code
```

Omit `--agent` to print the prompt instead. See [`skills use`](docs/commands.md#skills-use).

## Experimental Features

<details>
<summary>Commands prefixed with <code>experimental_</code> are previews. Their names, options, and behavior may change or be removed in any release without notice.</summary>

| Command                           | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `npx skills experimental_sync`    | Sync skills shipped by npm dependencies into your project |
| `npx skills experimental_install` | Restore project skills recorded in `skills-lock.json`     |

Some npm packages bundle instructions for your agent alongside their code. Sync links them into your project so they update with the dependency, and also installs skill packs declared in `package.json`:

```bash
npm install -D skills agent-browser
npx skills experimental_sync -y
```

See the [experimental commands reference](docs/commands.md#experimental-commands) for options, the `skills` field, and the [RFC](https://github.com/vercel-labs/skills/issues/2323) behind it.

</details>

## Lock File Content Hash

`skills-lock.json` (version 2) records a `computedHash` for each project skill. The hash covers the files the CLI installs into `.agents/skills/<name>`, so `list`, `check`, and `install --frozen-lockfile` can compare it with what is on disk. Tools that check skills themselves can compute the same value:

1. Collect every file in the skill folder. Leave out `metadata.json` files and the `.git`, `__pycache__`, and `__pypackages__` folders, because the installer does not copy them. A symlink counts as the file or folder it points to. Leave out a symlink that is broken, loops, or points outside the skill folder.
2. Give each file a path relative to the skill folder, with `/` as the separator.
3. For a text file (a file that contains no NUL byte), replace each CRLF with LF. Do not change binary files.
4. Sort the files by the UTF-8 bytes of their paths. Do not use a locale-aware sort.
5. For each file in that order, feed `path`, a NUL byte, the content length in bytes as decimal ASCII, a NUL byte, and the content into one SHA-256. The content length is counted after step 3.
6. The hash is the lowercase hex digest.

Test vectors:

| Files                                        | `computedHash`                                                     |
| -------------------------------------------- | ------------------------------------------------------------------ |
| none                                         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `SKILL.md` = `# hi\n`                         | `93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55` |
| `SKILL.md` = `a\n`, `docs/b.md` = `b\n`        | `b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24` |

The last vector equals `printf 'SKILL.md\0002\000a\ndocs/b.md\0002\000b\n' | sha256sum`.

A version 1 lock is upgraded when it is read, without network access. An installed skill whose files still match its version 1 hash gets a new hash computed from those files. Any other entry gets an empty hash, because there is nothing trusted to check it against. `skills install` fetches those skills again and records new hashes, and `--frozen-lockfile` fails until that is done.

## Supported Agents

The CLI detects installed agents and lets you choose where skills are installed.
See [all supported agents, installation paths, and compatibility](docs/agents.md).

## Creating Skills

```bash
npx skills init my-skill
```

Edit the generated `SKILL.md` with instructions for your agent.
See [creating and sharing skills](docs/creating-skills.md) for the format and discovery rules.

## Documentation

- [CLI reference](docs/commands.md): installation, command examples, and experimental features
- [Supported agents](docs/agents.md): agent names, skill directories, and compatibility
- [Creating skills](docs/creating-skills.md): frontmatter, repository layouts, and plugins
- [Troubleshooting and configuration](docs/troubleshooting.md): common problems, environment variables, and telemetry
- [Programmatic API](docs/api.md): install and manage skills from your own tools with `import { installSkills } from 'skills'`

## Telemetry

The CLI collects anonymous usage data. Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`
to disable telemetry and security-audit requests.
See [what is collected](docs/troubleshooting.md#telemetry).

## Related Links

- [Skills Directory](https://skills.sh)
- [Agent Skills Specification](https://agentskills.io)
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)

## License

This project is licensed under the [MIT License](LICENSE).
