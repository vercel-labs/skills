# skills

开放智能体技能生态系统的 CLI 工具。

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

<!-- agent-list:start -->

支持 **OpenCode**、**Claude Code**、**Codex**、**Cursor** 以及[其他 41 个智能体](#支持的智能体)。

<!-- agent-list:end -->

## 安装技能

```bash
npx skills add vercel-labs/agent-skills
```

### 来源格式

```bash
# GitHub 简写（所有者/仓库）
npx skills add vercel-labs/agent-skills

# 完整 GitHub URL
npx skills add https://github.com/vercel-labs/agent-skills

# 仓库中某个技能的直接路径
npx skills add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx skills add https://gitlab.com/org/repo

# 任意 git URL
npx skills add git@github.com:vercel-labs/agent-skills.git

# 本地路径
npx skills add ./my-local-skills
```

### 选项

| 选项                      | 描述                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | 安装到用户目录而非项目目录                                                                                                                   |
| `-a, --agent <agents...>` | <!-- agent-names:start -->指定特定智能体（如 `claude-code`、`codex`）。参见[支持的智能体](#支持的智能体)<!-- agent-names:end -->             |
| `-s, --skill <skills...>` | 按名称安装特定技能（使用 `'*'` 表示所有技能）                                                                                                |
| `-l, --list`              | 列出可用技能而不安装                                                                                                                         |
| `--copy`                  | 复制文件而非创建符号链接到智能体目录                                                                                                         |
| `-y, --yes`               | 跳过所有确认提示                                                                                                                             |
| `--all`                   | 无需提示即可将所有技能安装到所有智能体                                                                                                       |

### 示例

```bash
# 列出仓库中的技能
npx skills add vercel-labs/agent-skills --list

# 安装特定技能
npx skills add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# 安装名称中包含空格的技能（必须用引号括起来）
npx skills add owner/repo --skill "Convex Best Practices"

# 安装到特定智能体
npx skills add vercel-labs/agent-skills -a claude-code -a opencode

# 非交互式安装（适合 CI/CD）
npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# 将仓库中的所有技能安装到所有智能体
npx skills add vercel-labs/agent-skills --all

# 将所有技能安装到特定智能体
npx skills add vercel-labs/agent-skills --skill '*' -a claude-code

# 将特定技能安装到所有智能体
npx skills add vercel-labs/agent-skills --agent '*' --skill frontend-design
```

### 安装范围

| 范围        | 选项      | 位置                 | 使用场景                                     |
| ----------- | --------- | -------------------- | -------------------------------------------- |
| **项目级**  | （默认）  | `./<agent>/skills/`  | 随项目提交，与团队共享                       |
| **全局级**  | `-g`      | `~/<agent>/skills/`  | 在所有项目中可用                             |

### 安装方式

交互式安装时，你可以选择：

| 方式                      | 描述                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| **符号链接**（推荐）      | 为每个智能体创建指向权威副本的符号链接。单一数据源，易于更新。      |
| **复制**                  | 为每个智能体创建独立副本。在不支持符号链接时使用。                  |

## 其他命令

| 命令                         | 描述                                          |
| ---------------------------- | --------------------------------------------- |
| `npx skills list`            | 列出已安装的技能（别名：`ls`）                |
| `npx skills find [query]`    | 交互式搜索或按关键词搜索技能                  |
| `npx skills remove [skills]` | 从智能体中移除已安装的技能                    |
| `npx skills update [skills]` | 将已安装的技能更新到最新版本                  |
| `npx skills init [name]`     | 创建新的 SKILL.md 模板                        |

### `skills list`

列出所有已安装的技能。类似于 `npm ls`。

```bash
# 列出所有已安装的技能（项目和全局）
npx skills list

# 仅列出全局技能
npx skills ls -g

# 按特定智能体筛选
npx skills ls -a claude-code -a cursor
```

### `skills find`

交互式搜索或按关键词搜索技能。

```bash
# 交互式搜索（类似 fzf 风格）
npx skills find

# 按关键词搜索
npx skills find typescript
```

### `skills update`

```bash
# 更新所有技能（交互式范围提示）
npx skills update

# 按名称更新单个技能
npx skills update my-skill

# 更新多个特定技能
npx skills update frontend-design web-design-guidelines

# 仅更新全局或项目技能
npx skills update -g
npx skills update -p

# 非交互式（自动检测范围：如果在项目目录中则为项目级，否则为全局级）
npx skills update -y
```

| 选项            | 描述                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `-g, --global`  | 仅更新全局技能                                                                |
| `-p, --project` | 仅更新项目技能                                                                |
| `-y, --yes`     | 跳过范围提示（自动检测：如果在项目目录中则为项目级，否则为全局级）            |
| `[skills...]`   | 按名称更新特定技能而非全部                                                    |

### `skills init`

```bash
# 在当前目录创建 SKILL.md
npx skills init

# 在子目录中创建新技能
npx skills init my-skill
```

### `skills remove`

从智能体中移除已安装的技能。

```bash
# 交互式移除（从已安装技能中选择）
npx skills remove

# 按名称移除特定技能
npx skills remove web-design-guidelines

# 移除多个技能
npx skills remove frontend-design web-design-guidelines

# 从全局范围移除
npx skills remove --global web-design-guidelines

# 仅从特定智能体中移除
npx skills remove --agent claude-code cursor my-skill

# 无需确认即可移除所有已安装技能
npx skills remove --all

# 从特定智能体中移除所有技能
npx skills remove --skill '*' -a cursor

# 从所有智能体中移除特定技能
npx skills remove my-skill --agent '*'

# 使用 'rm' 别名
npx skills rm my-skill
```

| 选项           | 描述                                              |
| -------------- | ------------------------------------------------- |
| `-g, --global` | 从全局范围（~/）移除而非项目                      |
| `-a, --agent`  | 从特定智能体中移除（使用 `'*'` 表示所有）         |
| `-s, --skill`  | 指定要移除的技能（使用 `'*'` 表示所有）           |
| `-y, --yes`    | 跳过确认提示                                      |
| `--all`        | `--skill '*' --agent '*' -y` 的简写               |

## 什么是智能体技能？

智能体技能是可复用的指令集，用于扩展你的编程智能体的能力。它们在包含 `name` 和 `description` 的 YAML 前置元数据的 `SKILL.md` 文件中定义。

技能让智能体能够执行专门的任务，例如：

- 从 git 历史生成发布说明
- 按照团队规范创建 PR
- 与外部工具集成（Linear、Notion 等）

在 **[skills.sh](https://skills.sh)** 发现更多技能

## 支持的智能体

技能可以安装到以下任意智能体：

<!-- supported-agents:start -->

| 智能体                                | `--agent` 参数                           | 项目路径               | 全局路径                        |
| ------------------------------------- | ---------------------------------------- | ---------------------- | ------------------------------- |
| Amp, Kimi Code CLI, Replit, Universal | `amp`, `kimi-cli`, `replit`, `universal` | `.agents/skills/`      | `~/.config/agents/skills/`      |
| Antigravity                           | `antigravity`                            | `.agents/skills/`      | `~/.gemini/antigravity/skills/` |
| Augment                               | `augment`                                | `.augment/skills/`     | `~/.augment/skills/`            |
| IBM Bob                               | `bob`                                    | `.bob/skills/`         | `~/.bob/skills/`                |
| Claude Code                           | `claude-code`                            | `.claude/skills/`      | `~/.claude/skills/`             |
| OpenClaw                              | `openclaw`                               | `skills/`              | `~/.openclaw/skills/`           |
| Cline, Warp                           | `cline`, `warp`                          | `.agents/skills/`      | `~/.agents/skills/`             |
| CodeBuddy                             | `codebuddy`                              | `.codebuddy/skills/`   | `~/.codebuddy/skills/`          |
| Codex                                 | `codex`                                  | `.agents/skills/`      | `~/.codex/skills/`              |
| Command Code                          | `command-code`                           | `.commandcode/skills/` | `~/.commandcode/skills/`        |
| Continue                              | `continue`                               | `.continue/skills/`    | `~/.continue/skills/`           |
| Cortex Code                           | `cortex`                                 | `.cortex/skills/`      | `~/.snowflake/cortex/skills/`   |
| Crush                                 | `crush`                                  | `.crush/skills/`       | `~/.config/crush/skills/`       |
| Cursor                                | `cursor`                                 | `.agents/skills/`      | `~/.cursor/skills/`             |
| Deep Agents                           | `deepagents`                             | `.agents/skills/`      | `~/.deepagents/agent/skills/`   |
| Droid                                 | `droid`                                  | `.factory/skills/`     | `~/.factory/skills/`            |
| Firebender                            | `firebender`                             | `.agents/skills/`      | `~/.firebender/skills/`         |
| Gemini CLI                            | `gemini-cli`                             | `.agents/skills/`      | `~/.gemini/skills/`             |
| GitHub Copilot                        | `github-copilot`                         | `.agents/skills/`      | `~/.copilot/skills/`            |
| Goose                                 | `goose`                                  | `.goose/skills/`       | `~/.config/goose/skills/`       |
| Junie                                 | `junie`                                  | `.junie/skills/`       | `~/.junie/skills/`              |
| iFlow CLI                             | `iflow-cli`                              | `.iflow/skills/`       | `~/.iflow/skills/`              |
| Kilo Code                             | `kilo`                                   | `.kilocode/skills/`    | `~/.kilocode/skills/`           |
| Kiro CLI                              | `kiro-cli`                               | `.kiro/skills/`        | `~/.kiro/skills/`               |
| Kode                                  | `kode`                                   | `.kode/skills/`        | `~/.kode/skills/`               |
| MCPJam                                | `mcpjam`                                 | `.mcpjam/skills/`      | `~/.mcpjam/skills/`             |
| Mistral Vibe                          | `mistral-vibe`                           | `.vibe/skills/`        | `~/.vibe/skills/`               |
| Mux                                   | `mux`                                    | `.mux/skills/`         | `~/.mux/skills/`                |
| OpenCode                              | `opencode`                               | `.agents/skills/`      | `~/.config/opencode/skills/`    |
| OpenHands                             | `openhands`                              | `.openhands/skills/`   | `~/.openhands/skills/`          |
| Pi                                    | `pi`                                     | `.pi/skills/`          | `~/.pi/agent/skills/`           |
| Qoder                                 | `qoder`                                  | `.qoder/skills/`       | `~/.qoder/skills/`              |
| Qwen Code                             | `qwen-code`                              | `.qwen/skills/`        | `~/.qwen/skills/`               |
| Roo Code                              | `roo`                                    | `.roo/skills/`         | `~/.roo/skills/`                |
| Trae                                  | `trae`                                   | `.trae/skills/`        | `~/.trae/skills/`               |
| Trae CN                               | `trae-cn`                                | `.trae/skills/`        | `~/.trae-cn/skills/`            |
| Windsurf                              | `windsurf`                               | `.windsurf/skills/`    | `~/.codeium/windsurf/skills/`   |
| Zencoder                              | `zencoder`                               | `.zencoder/skills/`    | `~/.zencoder/skills/`           |
| Neovate                               | `neovate`                                | `.neovate/skills/`     | `~/.neovate/skills/`            |
| Pochi                                 | `pochi`                                  | `.pochi/skills/`       | `~/.pochi/skills/`              |
| AdaL                                  | `adal`                                   | `.adal/skills/`        | `~/.adal/skills/`               |

<!-- supported-agents:end -->

> [!NOTE]
> **Kiro CLI 用户：** 安装技能后，请手动将它们添加到自定义智能体的 `resources` 中，位于 `.kiro/agents/<agent>.json`：
>
> ```json
> {
>   "resources": ["skill://.kiro/skills/**/SKILL.md"]
> }
> ```

CLI 会自动检测你已安装哪些编程智能体。如果未检测到任何智能体，系统会提示你选择要安装到的智能体。

## 创建技能

技能是包含带有 YAML 前置元数据的 `SKILL.md` 文件的目录：

```markdown
---
name: my-skill
description: 这个技能的作用以及何时使用它
---

# My Skill

智能体激活此技能时要遵循的指令。

## 何时使用

描述应使用此技能的场景。

## 步骤

1. 首先，执行此操作
2. 然后，执行那个操作
```

### 必填字段

- `name`：唯一标识符（小写，允许使用连字符）
- `description`：技能的简要说明

### 可选字段

- `metadata.internal`：设置为 `true` 可在正常发现中隐藏该技能。内部技能仅在设置了 `INSTALL_INTERNAL_SKILLS=1` 时才可见且可安装。适用于正在开发中的技能或仅用于内部工具的技能。

```markdown
---
name: my-internal-skill
description: 默认不显示的内部技能
metadata:
  internal: true
---
```

### 技能发现

CLI 在仓库的以下位置搜索技能：

<!-- skill-discovery:start -->

- 根目录（如果包含 `SKILL.md`）
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.agents/skills/`
- `.augment/skills/`
- `.bob/skills/`
- `.claude/skills/`
- `./skills/`
- `.codebuddy/skills/`
- `.commandcode/skills/`
- `.continue/skills/`
- `.cortex/skills/`
- `.crush/skills/`
- `.factory/skills/`
- `.goose/skills/`
- `.junie/skills/`
- `.iflow/skills/`
- `.kilocode/skills/`
- `.kiro/skills/`
- `.kode/skills/`
- `.mcpjam/skills/`
- `.vibe/skills/`
- `.mux/skills/`
- `.openhands/skills/`
- `.pi/skills/`
- `.qoder/skills/`
- `.qwen/skills/`
- `.roo/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zencoder/skills/`
- `.neovate/skills/`
- `.pochi/skills/`
- `.adal/skills/`

<!-- skill-discovery:end -->

### 插件清单发现

如果存在 `.claude-plugin/marketplace.json` 或 `.claude-plugin/plugin.json`，这些文件中声明的技能也会被发现：

```json
// .claude-plugin/marketplace.json
{
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "my-plugin",
      "skills": ["./skills/review", "./skills/test"]
    }
  ]
}
```

这实现了与 [Claude Code 插件市场](https://code.claude.com/docs/en/plugin-marketplaces)生态系统的兼容性。

如果在标准位置找不到任何技能，将执行递归搜索。

## 兼容性

技能通常在不同智能体之间兼容，因为它们遵循共享的[智能体技能规范](https://agentskills.io)。但是，某些功能可能是特定于智能体的：

| 功能            | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | OpenClaw | Neovate | Pi  | Qoder | Zencoder |
| --------------- | -------- | --------- | ----------- | ----- | --------- | ----- | ------------ | -------- | ------ | ----------- | -------- | -------------- | --- | -------- | ------- | --- | ----- | -------- |
| 基础技能        | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | Yes      | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | Yes      |
| `allowed-tools` | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | No       | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | No       |
| `context: fork` | No       | No        | Yes         | No    | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |
| Hooks           | No       | No        | Yes         | Yes   | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |

## 故障排除

### "未找到技能"

确保仓库在前置元数据中包含具有 `name` 和 `description` 的有效 `SKILL.md` 文件。

### 技能未在智能体中加载

- 验证技能是否已安装到正确的路径
- 查看智能体的文档了解技能加载要求
- 确保 `SKILL.md` 前置元数据是有效的 YAML

### 权限错误

确保你对目标目录具有写访问权限。

## 环境变量

| 变量                      | 描述                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `INSTALL_INTERNAL_SKILLS` | 设置为 `1` 或 `true` 以显示并安装标记为 `internal: true` 的技能            |
| `DISABLE_TELEMETRY`       | 设置为禁用匿名使用遥测                                                     |
| `DO_NOT_TRACK`            | 禁用遥测的替代方式                                                         |

```bash
# 安装内部技能
INSTALL_INTERNAL_SKILLS=1 npx skills add vercel-labs/agent-skills --list
```

## 遥测

此 CLI 收集匿名使用数据以帮助改进工具。不收集任何个人信息。

在 CI 环境中会自动禁用遥测。

## 相关链接

- [智能体技能规范](https://agentskills.io)
- [技能目录](https://skills.sh)
- [Amp 技能文档](https://ampcode.com/manual#agent-skills)
- [Antigravity 技能文档](https://antigravity.google/docs/skills)
- [Factory AI / Droid 技能文档](https://docs.factory.ai/cli/configuration/skills)
- [Claude Code 技能文档](https://code.claude.com/docs/en/skills)
- [OpenClaw 技能文档](https://docs.openclaw.ai/tools/skills)
- [Cline 技能文档](https://docs.cline.bot/features/skills)
- [CodeBuddy 技能文档](https://www.codebuddy.ai/docs/ide/Features/Skills)
- [Codex 技能文档](https://developers.openai.com/codex/skills)
- [Command Code 技能文档](https://commandcode.ai/docs/skills)
- [Crush 技能文档](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-skills)
- [Cursor 技能文档](https://cursor.com/docs/context/skills)
- [Firebender 技能文档](https://docs.firebender.com/multi-agent/skills)
- [Gemini CLI 技能文档](https://geminicli.com/docs/cli/skills/)
- [GitHub Copilot 智能体技能](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [iFlow CLI 技能文档](https://platform.iflow.cn/en/cli/examples/skill)
- [Kimi Code CLI 技能文档](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)
- [Kiro CLI 技能文档](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources)
- [Kode 技能文档](https://github.com/shareAI-lab/kode/blob/main/docs/skills.md)
- [OpenCode 技能文档](https://opencode.ai/docs/skills)
- [Qwen Code 技能文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
- [OpenHands 技能文档](https://docs.openhands.ai/modules/usage/how-to/using-skills)
- [Pi 技能文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Qoder 技能文档](https://docs.qoder.com/cli/Skills)
- [Replit 技能文档](https://docs.replit.com/replitai/skills)
- [Roo Code 技能文档](https://docs.roocode.com/features/skills)
- [Trae 技能文档](https://docs.trae.ai/ide/skills)
- [Vercel 智能体技能仓库](https://github.com/vercel-labs/agent-skills)

## 许可证

MIT
