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
