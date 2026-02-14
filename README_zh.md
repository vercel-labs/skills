# skills

开放 Agent Skill（技能）生态系统的命令行工具（CLI）。

支持 **OpenCode**、**Claude Code**、**Codex**、**Cursor** 以及[更多 35+ 个 Agent](#支持的-agent)。

## 安装技能

```bash
npx skills add vercel-labs/agent-skills
```

### 来源格式

```bash
# GitHub 简写 (所有者/仓库)
npx skills add vercel-labs/agent-skills

# 完整的 GitHub URL
npx skills add https://github.com/vercel-labs/agent-skills

# 仓库中特定技能的直接路径
npx skills add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx skills add https://gitlab.com/org/repo

# 任何 git URL
npx skills add git@github.com:vercel-labs/agent-skills.git

# 本地路径
npx skills add ./my-local-skills
```

### 选项

| 选项 | 描述 |
| --- | --- |
| `-g, --global` | 安装到用户目录而非项目目录 |
| `-a, --agent <agents...>` | 指定目标 Agent（例如 `claude-code`, `codex`）。参见[可用 Agent](#支持的-agent) |
| `-s, --skill <skills...>` | 按名称安装特定技能（使用 `'*'` 安装所有技能） |
| `-l, --list` | 仅列出可用技能而不安装 |
| `-y, --yes` | 跳过所有确认提示 |
| `--all` | 无需提示，将所有技能安装到所有 Agent |

### 示例

```bash
# 列出仓库中的技能
npx skills add vercel-labs/agent-skills --list

# 安装特定技能
npx skills add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# 安装名称包含空格的技能（必须加引号）
npx skills add owner/repo --skill "Convex Best Practices"

# 安装到特定 Agent
npx skills add vercel-labs/agent-skills -a claude-code -a opencode

# 非交互式安装（对 CI/CD 友好）
npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# 将仓库中的所有技能安装到所有 Agent
npx skills add vercel-labs/agent-skills --all

# 将所有技能安装到特定 Agent
npx skills add vercel-labs/agent-skills --skill '*' -a claude-code

# 将特定技能安装到所有 Agent
npx skills add vercel-labs/agent-skills --agent '*' --skill frontend-design
```

### 安装范围

| 范围 | 标志 | 位置 | 使用场景 |
| --- | --- | --- | --- |
| **项目 (Project)** | (默认) | `./<agent>/skills/` | 随项目提交，与团队共享 |
| **全局 (Global)** | `-g` | `~/<agent>/skills/` | 在所有项目中可用 |

### 安装方式

在交互式安装时，你可以选择：

| 方式 | 描述 |
| --- | --- |
| **符号链接 (Symlink)** (推荐) | 从每个 Agent 创建到规范副本的符号链接。单一事实来源，易于更新。 |
| **复制 (Copy)** | 为每个 Agent 创建独立副本。在不支持符号链接时使用。 |

## 其他命令

| 命令 | 描述 |
| --- | --- |
| `npx skills list` | 列出已安装的技能（别名：`ls`） |
| `npx skills find [query]` | 交互式或通过关键字搜索技能 |
| `npx skills remove [skills]` | 从 Agent 中移除已安装的技能 |
| `npx skills check` | 检查可用技能的更新 |
| `npx skills update` | 将所有已安装技能更新到最新版本 |
| `npx skills init [name]` | 创建一个新的 SKILL.md 模板 |

### `skills list`

列出所有已安装的技能。类似于 `npm ls`。

```bash
# 列出所有已安装技能（项目和全局）
npx skills list

# 仅列出全局技能
npx skills ls -g

# 按特定 Agent 过滤
npx skills ls -a claude-code -a cursor
```

### `skills find`

交互式或通过关键字搜索技能。

```bash
# 交互式搜索 (fzf 风格)
npx skills find

# 通过关键字搜索
npx skills find typescript
```

### `skills check` / `skills update`

```bash
# 检查已安装技能是否有更新
npx skills check

# 将所有技能更新到最新版本
npx skills update
```

### `skills init`

```bash
# 在当前目录创建 SKILL.md
npx skills init

# 在子目录中创建新技能
npx skills init my-skill
```

### `skills remove`

从 Agent 中移除已安装的技能。

```bash
# 交互式移除（从已安装技能中选择）
npx skills remove

# 按名称移除特定技能
npx skills remove web-design-guidelines

# 移除多个技能
npx skills remove frontend-design web-design-guidelines

# 从全局范围移除
npx skills remove --global web-design-guidelines

# 仅从特定 Agent 中移除
npx skills remove --agent claude-code cursor my-skill

# 无需确认移除所有已安装技能
npx skills remove --all

# 从特定 Agent 移除所有技能
npx skills remove --skill '*' -a cursor

# 从所有 Agent 移除特定技能
npx skills remove my-skill --agent '*'

# 使用 'rm' 别名
npx skills rm my-skill
```

| 选项 | 描述 |
| --- | --- |
| `-g, --global` | 从全局范围 (~/) 移除而非项目目录 |
| `-a, --agent` | 从特定 Agent 移除（使用 `'*'` 代表所有） |
| `-s, --skill` | 指定要移除的技能（使用 `'*'` 代表所有） |
| `-y, --yes` | 跳过确认提示 |
| `--all` | `--skill '*' --agent '*' -y` 的简写 |

## 什么是 Agent Skill？

Agent Skill（技能）是可重用的指令集，用于扩展编码 Agent 的能力。它们定义在 `SKILL.md` 文件中，带有包含 `name` 和 `description` 的 YAML 前置元数据（frontmatter）。

技能让 Agent 能够执行专门的任务，例如：

*   从 git 历史记录生成发布说明
*   遵循团队规范创建 PR
*   与外部工具（Linear, Notion 等）集成

在 **[skills.sh](https://skills.sh)** 发现更多技能。

## 支持的 Agent

技能可以安装到以下任何 Agent：

| Agent | `--agent` | 项目路径 | 全局路径 |
| --- | --- | --- | --- |
| Amp, Kimi Code CLI | `amp`, `kimi-cli` | `.agents/skills/` | `~/.config/agents/skills/` |
| Antigravity | `antigravity` | `.agent/skills/` | `~/.gemini/antigravity/skills/` |
| Augment | `augment` | `.augment/rules/` | `~/.augment/rules/` |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| OpenClaw | `openclaw` | `skills/` | `~/.moltbot/skills/` |
| Cline | `cline` | `.cline/skills/` | `~/.cline/skills/` |
| CodeBuddy | `codebuddy` | `.codebuddy/skills/` | `~/.codebuddy/skills/` |
| Codex | `codex` | `.codex/skills/` | `~/.codex/skills/` |
| Command Code | `command-code` | `.commandcode/skills/` | `~/.commandcode/skills/` |
| Continue | `continue` | `.continue/skills/` | `~/.continue/skills/` |
| Crush | `crush` | `.crush/skills/` | `~/.config/crush/skills/` |
| Cursor | `cursor` | `.cursor/skills/` | `~/.cursor/skills/` |
| Droid | `droid` | `.factory/skills/` | `~/.factory/skills/` |
| Gemini CLI | `gemini-cli` | `.gemini/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.github/skills/` | `~/.copilot/skills/` |
| Goose | `goose` | `.goose/skills/` | `~/.config/goose/skills/` |
| Junie | `junie` | `.junie/skills/` | `~/.junie/skills/` |
| iFlow CLI | `iflow-cli` | `.iflow/skills/` | `~/.iflow/skills/` |
| Kilo Code | `kilo` | `.kilocode/skills/` | `~/.kilocode/skills/` |
| Kiro CLI | `kiro-cli` | `.kiro/skills/` | `~/.kiro/skills/` |
| Kode | `kode` | `.kode/skills/` | `~/.kode/skills/` |
| MCPJam | `mcpjam` | `.mcpjam/skills/` | `~/.mcpjam/skills/` |
| Mistral Vibe | `mistral-vibe` | `.vibe/skills/` | `~/.vibe/skills/` |
| Mux | `mux` | `.mux/skills/` | `~/.mux/skills/` |
| OpenCode | `opencode` | `.opencode/skills/` | `~/.config/opencode/skills/` |
| OpenHands | `openhands` | `.openhands/skills/` | `~/.openhands/skills/` |
| Pi | `pi` | `.pi/skills/` | `~/.pi/agent/skills/` |
| Qoder | `qoder` | `.qoder/skills/` | `~/.qoder/skills/` |
| Qwen Code | `qwen-code` | `.qwen/skills/` | `~/.qwen/skills/` |
| Replit | `replit` | `.agent/skills/` | N/A (仅限项目) |
| Roo Code | `roo` | `.roo/skills/` | `~/.roo/skills/` |
| Trae | `trae` | `.trae/skills/` | `~/.trae/skills/` |
| Trae CN | `trae-cn` | `.trae/skills/` | `~/.trae-cn/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| Zencoder | `zencoder` | `.zencoder/skills/` | `~/.zencoder/skills/` |
| Neovate | `neovate` | `.neovate/skills/` | `~/.neovate/skills/` |
| Pochi | `pochi` | `.pochi/skills/` | `~/.pochi/skills/` |
| AdaL | `adal` | `.adal/skills/` | `~/.adal/skills/` |

> [!NOTE]
> **Kiro CLI 用户：** 安装技能后，需手动将它们添加到 `.kiro/agents/<agent>.json` 中自定义 Agent 的 `resources` 里：
>
> ```json
> {
>   "resources": ["skill://.kiro/skills/**/SKILL.md"]
> }
> ```

CLI 会自动检测你安装了哪些编码 Agent。如果没有检测到，系统会提示你选择要安装到的 Agent。

## 创建技能

技能是包含 `SKILL.md` 文件的目录，文件带有 YAML 前置元数据：

```markdown
---
name: my-skill
description: 该技能的作用以及何时使用
---

# 我的技能

激活此技能时 Agent 需遵循的指令。

## 何时使用

描述应使用此技能的场景。

## 步骤

1. 首先，执行此操作
2. 然后，执行彼操作
```

### 必填字段

*   `name`: 唯一标识符（小写，允许使用连字符）
*   `description`: 对技能作用的简短说明

### 可选字段

*   `metadata.internal`: 设置为 `true` 以从常规发现中隐藏该技能。仅当设置了 `INSTALL_INTERNAL_SKILLS=1` 时，内部技能才可见且可安装。适用于开发中的技能或仅用于内部工具的技能。

```markdown
---
name: my-internal-skill
description: 默认不显示的内部技能
metadata:
  internal: true
---
```

### 技能发现

CLI 会在仓库内的以下位置搜索技能：

*   根目录（如果包含 `SKILL.md`）
*   `skills/`
*   `skills/.curated/`
*   `skills/.experimental/`
*   `skills/.system/`
*   `.agents/skills/`
*   `.agent/skills/`
*   `.augment/rules/`
*   `.claude/skills/`
*   `./skills/`
*   `.cline/skills/`
*   `.codebuddy/skills/`
*   `.codex/skills/`
*   `.commandcode/skills/`
*   `.continue/skills/`
*   `.crush/skills/`
*   `.cursor/skills/`
*   `.factory/skills/`
*   `.gemini/skills/`
*   `.github/skills/`
*   `.goose/skills/`
*   `.junie/skills/`
*   `.iflow/skills/`
*   `.kilocode/skills/`
*   `.kiro/skills/`
*   `.kode/skills/`
*   `.mcpjam/skills/`
*   `.vibe/skills/`
*   `.mux/skills/`
*   `.opencode/skills/`
*   `.openhands/skills/`
*   `.pi/skills/`
*   `.qoder/skills/`
*   `.qwen/skills/`
*   `.roo/skills/`
*   `.trae/skills/`
*   `.windsurf/skills/`
*   `.zencoder/skills/`
*   `.neovate/skills/`
*   `.pochi/skills/`
*   `.adal/skills/`

### 插件清单发现

如果存在 `.claude-plugin/marketplace.json` 或 `.claude-plugin/plugin.json`，则也会发现这些文件中声明的技能：

```json
// .claude-plugin/marketplace.json
{
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [{
    "name": "my-plugin",
    "source": "my-plugin",
    "skills": ["./skills/review", "./skills/test"]
  }]
}
```

这实现了与 [Claude Code 插件市场](https://code.claude.com/docs/en/plugin-marketplaces)生态系统的兼容。

如果在标准位置未找到技能，则会执行递归搜索。

## 兼容性

由于技能遵循共享的 [Agent Skills 规范](https://agentskills.io)，因此通常在不同 Agent 之间是兼容的。但是，某些功能可能是特定 Agent 特有的：

| 功能 | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | Clawdbot | Neovate | Pi | Qoder | Zencoder |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 基础技能 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| `allowed-tools` (允许的工具) | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 否 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 是 | 否 |
| `context: fork` (上下文隔离/派生) | 否 | 否 | 是 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 |
| Hooks (钩子) | 否 | 否 | 是 | 是 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 | 否 |

## 故障排除

### "未找到技能"

确保仓库包含有效的 `SKILL.md` 文件，且 frontmatter 中包含 `name` 和 `description`。

### 技能未在 Agent 中加载

*   验证技能是否安装到了正确的路径
*   检查 Agent 的文档以了解技能加载要求
*   确保 `SKILL.md` 的 frontmatter 是有效的 YAML

### 权限错误

确保你对目标目录具有写访问权限。

## 环境变量

| 变量 | 描述 |
| --- | --- |
| `INSTALL_INTERNAL_SKILLS` | 设置为 `1` 或 `true` 以显示并安装标记为 `internal: true` 的技能 |
| `DISABLE_TELEMETRY` | 设置以禁用匿名使用情况遥测 |
| `DO_NOT_TRACK` | 禁用遥测的另一种方式 |

```bash
# 安装内部技能
INSTALL_INTERNAL_SKILLS=1 npx skills add vercel-labs/agent-skills --list
```

## 遥测

此 CLI 收集匿名使用数据以帮助改进工具。不会收集个人信息。

在 CI 环境中，遥测会自动禁用。

## 相关链接

*   [Agent Skills 规范](https://agentskills.io)
*   [技能目录](https://skills.sh)
*   [Amp 技能文档](https://ampcode.com/manual#agent-skills)
*   [Antigravity 技能文档](https://antigravity.google/docs/skills)
*   [Factory AI / Droid 技能文档](https://docs.factory.ai/cli/configuration/skills)
*   [Claude Code 技能文档](https://code.claude.com/docs/en/skills)
*   [Clawdbot 技能文档](https://docs.clawd.bot/tools/skills)
*   [Cline 技能文档](https://docs.cline.bot/features/skills)
*   [CodeBuddy 技能文档](https://www.codebuddy.ai/docs/ide/Features/Skills)
*   [Codex 技能文档](https://developers.openai.com/codex/skills)
*   [Command Code 技能文档](https://commandcode.ai/docs/skills)
*   [Crush 技能文档](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-skills)
*   [Cursor 技能文档](https://cursor.com/docs/context/skills)
*   [Gemini CLI 技能文档](https://geminicli.com/docs/cli/skills/)
*   [GitHub Copilot Agent 技能](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
*   [iFlow CLI 技能文档](https://platform.iflow.cn/en/cli/examples/skill)
*   [Kimi Code CLI 技能文档](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)
*   [Kiro CLI 技能文档](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources)
*   [Kode 技能文档](https://github.com/shareAI-lab/kode/blob/main/docs/skills.md)
*   [OpenCode 技能文档](https://opencode.ai/docs/skills)
*   [Qwen Code 技能文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
*   [OpenHands 技能文档](https://docs.openhands.ai/modules/usage/how-to/using-skills)
*   [Pi 技能文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
*   [Qoder 技能文档](https://docs.qoder.com/cli/Skills)
*   [Replit 技能文档](https://docs.replit.com/replitai/skills)
*   [Roo Code 技能文档](https://docs.roocode.com/features/skills)
*   [Trae 技能文档](https://docs.trae.ai/ide/skills)
*   [Vercel Agent Skills 仓库](https://github.com/vercel-labs/agent-skills)

## 许可证

MIT
