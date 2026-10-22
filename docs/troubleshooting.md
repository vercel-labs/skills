# Troubleshooting and configuration

[Back to the README](../README.md)

## Troubleshooting

### "No skills found"

Ensure the repository contains valid `SKILL.md` files with both `name` and `description` in the frontmatter.

### Skill not loading in agent

- Verify the skill was installed to the correct path
- Check the agent's documentation for skill loading requirements
- Ensure the `SKILL.md` frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Environment Variables

| Variable                  | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` or `true` to show and install skills marked as `internal: true` |
| `DISABLE_TELEMETRY`       | Set to disable anonymous usage telemetry                                   |
| `DO_NOT_TRACK`            | Alternative way to disable telemetry                                       |
| `GITHUB_TOKEN`            | Optional explicit token for authenticated GitHub API requests              |
| `GH_TOKEN`                | Fallback explicit token for authenticated GitHub API requests              |

```bash
# Install internal skills
INSTALL_INTERNAL_SKILLS=1 npx skills add vercel-labs/agent-skills --list
```

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

GitHub repository and skill identifiers are sent only for repositories that GitHub positively confirms are public. Other remote source types may include source and skill identifiers in install telemetry because their visibility cannot be checked through GitHub. Security-audit requests remain limited to confirmed-public GitHub repositories. Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` to disable both entirely.

## Error codes

Every error and warning the CLI prints starts with a stable code, such as `[SKILLS_G003]`, and links to its entry below.

### Command line

#### SKILLS_C001

An `--agent` value is not a known agent. The message lists the valid `--agent` names. See [supported agents](agents.md).

#### SKILLS_C002

An option was passed without its value, for example `--owner` with nothing after it.

#### SKILLS_C003

The command does not accept this option. Run the command with `--help` to list its options.

#### SKILLS_C004

The option's value has the wrong format, for example `--metadata` that is not valid JSON.

#### SKILLS_C005

The option can be given only once.

#### SKILLS_C006

`skills remove --all` cannot be combined with skill names. Use `--all` to remove every skill, or name the skills to remove.

#### SKILLS_C007

The command needed an interactive prompt, but stdin is not a terminal (CI, scripts, agents). Pass `--agent <name>` (or `--agent '*'`) and `-y`.

#### SKILLS_C008

A required argument is missing. The command prints its usage.

#### SKILLS_C009

`skills use` takes exactly one source.

#### SKILLS_C010

The command does not exist. Run `skills --help` for the list of commands.

### Sources and skill selection

#### SKILLS_S001

The source subpath contains `..` segments. Subpaths must stay inside the repository.

#### SKILLS_S002

The subpath resolves outside the repository directory. Remove `..` segments that escape the repository root.

#### SKILLS_S003

No skill in the source matches the requested name. The message lists the skills that are available. Use one of those names, or run `skills add <source> --list`.

#### SKILLS_S004

The source has no valid skills. Each skill needs a `SKILL.md` file with `name` and `description` in its frontmatter.

#### SKILLS_S005

`skills use` needs exactly one skill, but the source has several. Select one with `<source>@<skill>` or `--skill <skill>`.

#### SKILLS_S006

The skill selector matches more than one skill. Use the full skill name.

#### SKILLS_S007

The source (`<source>@<skill>`) and `--skill` select different skills. Use only one of them.

#### SKILLS_S008

The local path does not exist. Check the path, relative to the current directory.

#### SKILLS_S009

The URL points to a path on a host (for example `https://host/s/my-list`), but the host publishes no skills under that path. The CLI does not fall back to the host's root index, because that would install every skill the host publishes. Check the URL, or install from the root URL on purpose.

#### SKILLS_S010

The URL has no skills index. The server must publish `/.well-known/agent-skills/index.json` or `/.well-known/skills/index.json`.

#### SKILLS_S011

A `SKILL.md` was skipped because it could not be read or parsed. Its frontmatter must be valid YAML with string `name` and `description` fields.

### Git

#### SKILLS_G001

The `ext::` Git transport can run commands, so it is blocked. Use an `https`, `ssh`, `git`, or `file` URL.

#### SKILLS_G002

The clone took longer than the timeout (5 minutes by default). For large repositories, set `SKILLS_CLONE_TIMEOUT_MS`, for example `SKILLS_CLONE_TIMEOUT_MS=600000`. You can also clone the repository yourself and pass the local path to `skills add`.

#### SKILLS_G003

Git could not authenticate. For a private repository, make sure you have access. Check SSH keys with `ssh -T git@github.com`, or HTTPS credentials with `gh auth status`. For GitHub repositories, the CLI already tried the GitHub CLI and SSH.

#### SKILLS_G004

The GitHub organization enforces SAML SSO, and your credentials are not authorized for it. Re-authorize your token or app for the organization, or install with the SSH URL shown in the message.

#### SKILLS_G005

`git clone` failed. The message includes the output from Git.

### Downloads

#### SKILLS_D001

The server returned an HTTP error for the download URL.

#### SKILLS_D002

The download is larger than the limit (10 MiB by default). Set `SKILLS_DOWNLOAD_MAX_BYTES` to raise it.

#### SKILLS_D003

The server returned an empty response body.

#### SKILLS_D004

The downloaded file is empty.

#### SKILLS_D005

The URL is not a `SKILL.md` file (with `name` and `description` frontmatter) or a zip or tar archive that contains skills.

### Archives

#### SKILLS_A001

The archive is corrupt or truncated. Create the archive again, or download it again.

#### SKILLS_A002

Multi-disk (split) zip archives are not supported. Create the archive as a single file.

#### SKILLS_A003

An archive entry has an absolute path or a `..` segment that would write outside the extraction folder. The archive is rejected.

#### SKILLS_A004

Encrypted zip entries are not supported.

#### SKILLS_A005

The archive contains symbolic or hard links. Replace them with regular files.

#### SKILLS_A006

The archive has more files than the limit (1000 by default). For downloads, set `SKILLS_EXTRACT_MAX_FILES` to raise it.

#### SKILLS_A007

The archive extracts to more than the size limit (25 MiB by default). For downloads, set `SKILLS_EXTRACT_MAX_BYTES` to raise it.

#### SKILLS_A008

The zip uses a compression method other than deflate or store. Create the archive again with standard zip compression.

#### SKILLS_A009

A well-known skill artifact is neither a zip nor a `.tar.gz` archive.

#### SKILLS_A010

A well-known skill archive has no `SKILL.md` at its root.

### Installation

#### SKILLS_I001

The skill name would resolve outside the skills directory. Skill names must not contain path separators or `..`.

#### SKILLS_I002

The CLI refused to delete a directory outside the system temp directory. This is a safety check. Please report it.

#### SKILLS_I003

A file in the skill is a symbolic link to a path that does not exist, so it was not copied. Replace the link with the real file, or remove it from the skill.

#### SKILLS_I004

`skills-lock.json` has an entry from a generic Git source, but no `sourceUrl`. Install the skill again with `skills add <git-url>` to record its source.

### package.json `skills` field

#### SKILLS_P001

The `skills` field in `package.json` must be an array.

#### SKILLS_P002

An entry in the `skills` field has the wrong shape. Each entry is a source string or `{ "source": string, "skills"?: string[], "ref"?: string }`.

#### SKILLS_P003

The `skills` field accepts only git-hosted sources (GitHub, GitLab, Git URLs) and `npm:` packages. It does not accept local paths or plain URLs.

#### SKILLS_P004

The source already includes a ref (for example `owner/repo#v1`), so it cannot also have a `ref` key. Remove one of them.

#### SKILLS_P005

`npm:` entries use the version installed in `node_modules`, so `ref` does not apply. Remove `ref`.

#### SKILLS_P006

An `npm:` entry names a package that is not installed. Add the package to your dependencies and install it.

### Notion

#### SKILLS_N001

Notion sources need the Notion CLI. Install it from <https://developers.notion.com/cli/get-started/overview>, then run `ntn login`.

#### SKILLS_N002

An `ntn api` call failed, timed out, or returned too much output. Make sure `ntn login` succeeded, then try again. Set `SKILLS_DEBUG=1` to log each `ntn` command.

#### SKILLS_N003

The Notion API response had an unexpected shape. Update `ntn` and `skills`, then try again.

#### SKILLS_N004

The workspace that `ntn` is logged in to has no Agent Plugins packs.

#### SKILLS_N005

No Notion pack matches the requested name. Run `skills add notion --list` to see the available packs.

#### SKILLS_N006

The Notion pack changed while the CLI was installing it. Try again.

#### SKILLS_N007

A selected Notion pack could not be prepared. The message includes the reason.

### `skills use`

#### SKILLS_U001

`skills use --agent` cannot start this agent yet. The message lists the agents it can start. Without `--agent`, `skills use` prints a prompt that you can pipe to any agent.

#### SKILLS_U002

The agent's command is not on your `PATH`. Install the agent, or pipe `skills use` output to it.

#### SKILLS_U003

`skills use --agent` starts one agent, so `'*'` is not allowed.

#### SKILLS_U004

`skills use --agent` accepts exactly one agent.

### Internal

#### SKILLS_E001

Two providers were registered with the same ID. This is a bug in the CLI. Please report it.
