# company-skills

开放智能体技能生态的 CLI 工具。

<!-- agent-list:start -->
支持 **OpenCode**、**Claude Code**、**Codex**、**Cursor** 等 [77 个智能体](#支持的智能体)。
<!-- agent-list:end -->

## 安装技能

```bash
npx company-skills add vercel-labs/agent-skills
```

## 无需安装直接使用技能

为一个技能生成提示词，或交互式启动受支持的编码智能体：

```bash
npx company-skills use vercel-labs/agent-skills@web-design-guidelines | claude
npx company-skills use vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
```

`company-skills use` 与 `company-skills add` 使用相同的来源解析方式，将选中的技能文件写入临时目录，并在未提供 `--agent` 时仅向 stdout 输出生成的提示词。提供 `--agent` 时，会用生成的提示词交互式启动受支持的智能体。

### 来源格式

```bash
# GitHub 简写（owner/repo）
npx company-skills add vercel-labs/agent-skills

# 完整 GitHub 地址
npx company-skills add https://github.com/vercel-labs/agent-skills

# 仓库内技能的直接路径
npx company-skills add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab 地址
npx company-skills add https://gitlab.com/org/repo

# 任意 git 地址（含内网 GitLab 请使用 .git 后缀）
npx company-skills add git@github.com:vercel-labs/agent-skills.git

# 本地路径
npx company-skills add ./my-local-skills
```

### 参数

| 参数                      | 说明                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `-g, --global`            | 安装到用户目录（全局）而不是项目目录                         |
| `-a, --agent <agents...>` | <!-- agent-names:start -->指定目标智能体（如 `claude-code`、`codex`）。参见 [支持的智能体](#支持的智能体)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | 按名称安装指定技能（使用 `'*'` 表示所有技能）                |
| `-l, --list`              | 仅列出仓库中的可用技能，不安装                               |
| `--copy`                  | 复制文件而不是符号链接到智能体目录                           |
| `-y, --yes`               | 跳过所有确认提示                                             |
| `--all`                   | 无提示安装所有技能到所有智能体                               |

### 示例

```bash
# 列出仓库中的技能
npx company-skills add vercel-labs/agent-skills --list

# 安装指定技能
npx company-skills add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# 安装名称中包含空格的技能（必须加引号）
npx company-skills add owner/repo --skill "Convex Best Practices"

# 安装到指定智能体
npx company-skills add vercel-labs/agent-skills -a claude-code -a opencode

# 非交互式安装（适合 CI/CD）
npx company-skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# 安装仓库中所有技能到所有智能体
npx company-skills add vercel-labs/agent-skills --all

# 安装所有技能到指定智能体
npx company-skills add vercel-labs/agent-skills --skill '*' -a claude-code

# 安装指定技能到所有智能体
npx company-skills add vercel-labs/agent-skills --agent '*' --skill frontend-design

# 从直接的 SKILL.md 或压缩包下载地址安装
npx company-skills add https://example.com/download/my-skill
```

直接下载地址会在 well-known 发现之后尝试。它们可以指向单个有效的 `SKILL.md` 文件，或 `.zip`、`.tar`、`.tar.gz`、`.tgz` 压缩包；地址无需包含文件扩展名。默认下载限制为 10 MiB，解压内容限制为 25 MiB，压缩包文件数限制为 1000 个。在信任来源时，可通过 `SKILLS_DOWNLOAD_MAX_BYTES`、`SKILLS_EXTRACT_MAX_BYTES` 和 `SKILLS_EXTRACT_MAX_FILES` 覆盖。

### 安装范围

| 范围     | 参数      | 位置                | 适用场景                               |
| -------- | --------- | ------------------- | -------------------------------------- |
| **项目** | （默认）  | `./<agent>/skills/` | 随项目提交，与团队共享                 |
| **全局** | `-g`      | `~/<agent>/skills/` | 所有项目可用                           |

### 安装方式

交互式安装时可选择：

| 方式                      | 说明                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **符号链接**（推荐）      | 从每个智能体符号链接到规范副本。单一来源，易于更新。                                     |
| **复制**                  | 为每个智能体创建独立副本。当不支持符号链接时使用。                                       |

## 其他命令

| 命令                            | 说明                             |
| ------------------------------- | -------------------------------- |
| `npx company-skills use <source>`| 无需安装使用一个技能             |
| `npx company-skills list`        | 列出已安装技能（别名：`ls`）     |
| `npx company-skills find [query]`| 交互式或按关键字搜索技能         |
| `npx company-skills remove [skills]`| 从智能体中移除已安装技能       |
| `npx company-skills update [skills]`| 将技能更新到最新版本           |
| `npx company-skills init [name]` | 创建新的 SKILL.md 模板           |

### `skills list`

列出所有已安装技能，类似 `npm ls`。

```bash
# 列出所有已安装技能（项目 + 全局）
npx company-skills list

# 仅列出全局技能
npx company-skills ls -g

# 按指定智能体过滤
npx company-skills ls -a claude-code -a cursor
```

### `skills find`

交互式或按关键字搜索技能。

```bash
# 交互式搜索（fzf 风格）
npx company-skills find

# 按关键字搜索
npx company-skills find typescript

# 在某个组织/用户的所有仓库中搜索
npx company-skills find react --owner vercel
```

### `skills update`

```bash
# 更新所有技能（交互式范围询问）
npx company-skills update

# 按名称更新单个技能
npx company-skills update my-skill

# 更新多个指定技能
npx company-skills update frontend-design web-design-guidelines

# 仅更新全局或项目技能
npx company-skills update -g
npx company-skills update -p

# 非交互式（自动检测范围：项目内则项目，否则全局）
npx company-skills update -y
```

| 参数            | 说明                                                             |
| --------------- | ---------------------------------------------------------------- |
| `-g, --global`  | 仅更新全局技能                                                   |
| `-p, --project` | 仅更新项目技能                                                   |
| `-y, --yes`     | 跳过范围询问（自动检测：项目目录内则项目，否则全局）             |
| `[skills...]`   | 按名称更新指定技能，而不是全部                                   |

### `skills init`

```bash
# 在当前目录创建 SKILL.md
npx company-skills init

# 在子目录中创建新技能
npx company-skills init my-skill
```

### `skills remove`

从智能体中移除已安装技能。

```bash
# 交互式移除（从已安装技能中选择）
npx company-skills remove

# 按名称移除指定技能
npx company-skills remove web-design-guidelines

# 移除多个技能
npx company-skills remove frontend-design web-design-guidelines

# 从全局范围移除
npx company-skills remove --global web-design-guidelines

# 仅从指定智能体移除
npx company-skills remove --agent claude-code cursor my-skill

# 无确认移除所有已安装技能
npx company-skills remove --all

# 从指定智能体移除所有技能
npx company-skills remove --skill '*' -a cursor

# 从所有智能体移除指定技能
npx company-skills remove my-skill --agent '*'

# 使用 rm 别名
npx company-skills rm my-skill
```

| 参数         | 说明                                        |
| ------------ | ------------------------------------------- |
| `-g, --global` | 从全局范围（~/）移除，而不是项目范围       |
| `-a, --agent`  | 从指定智能体移除（使用 `'*'` 表示所有）    |
| `-s, --skill`  | 指定要移除的技能（使用 `'*'` 表示所有）    |
| `-y, --yes`    | 跳过确认提示                               |
| `--all`        | 等价于 `--skill '*' --agent '*' -y`        |

## 什么是 Agent Skills？

Agent Skills 是可复用的指令集，用于扩展编码智能体的能力。它们定义在包含 YAML frontmatter（含 `name` 和 `description`）的 `SKILL.md` 文件中。

技能让智能体可以执行专业任务，例如：

- 根据 git 历史生成发布说明
- 按团队规范创建 PR
- 与外部工具集成（Linear、Notion 等）

在 **[skills.sh](https://skills.sh)** 发现更多技能。

## 支持的智能体

技能可以安装到以下任意智能体：

<!-- supported-agents:start -->
| 智能体 | `--agent` | 项目路径 | 全局路径 |
|--------|-----------|----------|----------|
| AiderDesk | `aider-desk` | `.aider-desk/skills/` | `~/.aider-desk/skills/` |
| Amp, Replit, Universal | `amp`, `replit`, `universal` | `.agents/skills/` | `~/.config/agents/skills/` |
| Antigravity | `antigravity` | `.agents/skills/` | `~/.gemini/antigravity/skills/` |
| Antigravity CLI | `antigravity-cli` | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` |
| AstrBot | `astrbot` | `data/skills/` | `~/.astrbot/data/skills/` |
| Autohand Code CLI | `autohand-code` | `.autohand/skills/` | `~/.autohand/skills/` |
| Augment | `augment` | `.augment/skills/` | `~/.augment/skills/` |
| IBM Bob | `bob` | `.bob/skills/` | `~/.bob/skills/` |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| OpenClaw | `openclaw` | `skills/` | `~/.openclaw/skills/` |
| Cline, Dexto, Kimi Code CLI, Loaf, Warp, Zed | `cline`, `dexto`, `kimi-code-cli`, `loaf`, `warp`, `zed` | `.agents/skills/` | `~/.agents/skills/` |
| CodeArts Agent | `codearts-agent` | `.codeartsdoer/skills/` | `~/.codeartsdoer/skills/` |
| CodeBuddy | `codebuddy` | `.codebuddy/skills/` | `~/.codebuddy/skills/` |
| Codemaker | `codemaker` | `.codemaker/skills/` | `~/.codemaker/skills/` |
| Code Studio | `codestudio` | `.codestudio/skills/` | `~/.codestudio/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.codex/skills/` |
| Comate | `comate` | `.comate/skills/` | `~/.comate/skills/` |
| Command Code | `command-code` | `.commandcode/skills/` | `~/.commandcode/skills/` |
| Continue | `continue` | `.continue/skills/` | `~/.continue/skills/` |
| Cortex Code | `cortex` | `.cortex/skills/` | `~/.snowflake/cortex/skills/` |
| Crush | `crush` | `.crush/skills/` | `~/.config/crush/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| Deep Agents | `deepagents` | `.agents/skills/` | `~/.deepagents/agent/skills/` |
| Devin for Terminal | `devin` | `.devin/skills/` | `~/.config/devin/skills/` |
| Droid | `droid` | `.factory/skills/` | `~/.factory/skills/` |
| Eve | `eve` | `agent/skills/` | N/A (仅项目级) |
| Firebender | `firebender` | `.agents/skills/` | `~/.firebender/skills/` |
| ForgeCode | `forgecode` | `.forge/skills/` | `~/.forge/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Goose | `goose` | `.goose/skills/` | `~/.config/goose/skills/` |
| Grok Build | `grok` | `.grok/skills/` | `~/.grok/skills/` |
| Hermes Agent | `hermes-agent` | `.hermes/skills/` | `~/.hermes/skills/` |
| inference.sh | `inference-sh` | `.inferencesh/skills/` | `~/.inferencesh/skills/` |
| Jazz | `jazz` | `.jazz/skills/` | `~/.jazz/skills/` |
| Junie | `junie` | `.junie/skills/` | `~/.junie/skills/` |
| iFlow CLI | `iflow-cli` | `.iflow/skills/` | `~/.iflow/skills/` |
| Kilo Code | `kilo` | `.kilocode/skills/` | `~/.kilocode/skills/` |
| Kimchi | `kimchi` | `.kimchi/skills/` | `~/.config/kimchi/harness/skills/` |
| Kiro CLI | `kiro-cli` | `.kiro/skills/` | `~/.kiro/skills/` |
| Kode | `kode` | `.kode/skills/` | `~/.kode/skills/` |
| Lingma | `lingma` | `.lingma/skills/` | `~/.lingma/skills/` |
| MCPJam | `mcpjam` | `.mcpjam/skills/` | `~/.mcpjam/skills/` |
| MiniMax Code | `minimax-code` | `.minimax/skills/` | `~/.minimax/skills/` |
| Mistral Vibe | `mistral-vibe` | `.vibe/skills/` | `~/.vibe/skills/` |
| Moxby | `moxby` | `.moxby/skills/` | `~/.moxby/skills/` |
| Mux | `mux` | `.mux/skills/` | `~/.mux/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| OpenHands | `openhands` | `.openhands/skills/` | `~/.openhands/skills/` |
| Ona | `ona` | `.ona/skills/` | `~/.ona/skills/` |
| Pi | `pi` | `.pi/skills/` | `~/.pi/agent/skills/` |
| Qoder | `qoder` | `.qoder/skills/` | `~/.qoder/skills/` |
| Qoder CN | `qoder-cn` | `.qoder/skills/` | `~/.qoder-cn/skills/` |
| Qwen Code | `qwen-code` | `.qwen/skills/` | `~/.qwen/skills/` |
| Reasonix | `reasonix` | `.reasonix/skills/` | `~/.reasonix/skills/` |
| Rovo Dev | `rovodev` | `.rovodev/skills/` | `~/.rovodev/skills/` |
| Roo Code | `roo` | `.roo/skills/` | `~/.roo/skills/` |
| Tabnine CLI | `tabnine-cli` | `.tabnine/agent/skills/` | `~/.tabnine/agent/skills/` |
| Terramind | `terramind` | `.terramind/skills/` | `~/.terramind/skills/` |
| Tinycloud | `tinycloud` | `.tinycloud/skills/` | `~/.tinycloud/skills/` |
| Trae | `trae` | `.trae/skills/` | `~/.trae/skills/` |
| Trae CN | `trae-cn` | `.trae/skills/` | `~/.trae-cn/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| ZCode | `zcode` | `.zcode/skills/` | `~/.zcode/skills/` |
| Zencoder, Zenflow | `zencoder`, `zenflow` | `.zencoder/skills/` | `~/.zencoder/skills/` |
| Neovate | `neovate` | `.neovate/skills/` | `~/.neovate/skills/` |
| Pochi | `pochi` | `.pochi/skills/` | `~/.pochi/skills/` |
| PromptScript | `promptscript` | `.agents/skills/` | N/A (仅项目级) |
| AdaL | `adal` | `.adal/skills/` | `~/.adal/skills/` |
<!-- supported-agents:end -->

> [!NOTE]
> **Kiro CLI 用户：** 默认智能体会自动从 `.kiro/skills/` 和 `~/.kiro/skills/` 加载技能，无需配置。如果使用**自定义智能体**，请在 `.kiro/agents/<agent>.json` 中把技能加入其 `resources`：
>
> ```json
> {
>   "resources": ["skill://.kiro/skills/**/SKILL.md"]
> }
> ```

CLI 会自动检测你已安装的编码智能体。如果未检测到任何智能体，会提示你选择要安装到的目标。

## 创建技能

技能是包含 `SKILL.md` 文件的目录，文件带 YAML frontmatter：

```markdown
---
name: my-skill
description: 该技能的作用及使用时机
---

# 我的技能

当该技能被激活时，智能体需遵循的指令。

## 使用时机

描述应使用该技能的场景。

## 步骤

1. 首先，执行此操作
2. 然后，执行彼操作
```

### 必填字段

- `name`：唯一标识符（小写字母、连字符）
- `description`：技能作用的简要说明

### 可选字段

- `metadata.internal`：设置为 `true` 可将技能从常规发现中隐藏。内部技能仅在设置 `INSTALL_INTERNAL_SKILLS=1` 时可见和可安装。适合开发中的技能或仅供内部工具使用的技能。

```markdown
---
name: my-internal-skill
description: 默认不展示的内部技能
metadata:
  internal: true
---
```

### 技能发现

CLI 在仓库的以下位置搜索技能。每个技能容器目录会向下遍历一层以适配常见平铺结构（`skills/<name>/SKILL.md`），并额外向下一层以适配目录结构（`skills/<category>/<name>/SKILL.md`）。在较浅层发现的 `SKILL.md` 会遮蔽其下嵌套的内容。使用 `--full-depth` 可同时发现这些容器目录之外（如 `examples/` 或 `tests/` 下）的 `SKILL.md` 文件。

<!-- skill-discovery:start -->
- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.aider-desk/skills/`
- `.agents/skills/`
- `data/skills/`
- `.autohand/skills/`
- `.augment/skills/`
- `.bob/skills/`
- `.claude/skills/`
- `.codeartsdoer/skills/`
- `.codebuddy/skills/`
- `.codemaker/skills/`
- `.codestudio/skills/`
- `.comate/skills/`
- `.commandcode/skills/`
- `.continue/skills/`
- `.cortex/skills/`
- `.crush/skills/`
- `.devin/skills/`
- `.factory/skills/`
- `agent/skills/`
- `.forge/skills/`
- `.goose/skills/`
- `.grok/skills/`
- `.hermes/skills/`
- `.inferencesh/skills/`
- `.jazz/skills/`
- `.junie/skills/`
- `.iflow/skills/`
- `.kilocode/skills/`
- `.kimchi/skills/`
- `.kiro/skills/`
- `.kode/skills/`
- `.lingma/skills/`
- `.mcpjam/skills/`
- `.minimax/skills/`
- `.vibe/skills/`
- `.moxby/skills/`
- `.mux/skills/`
- `.openhands/skills/`
- `.ona/skills/`
- `.pi/skills/`
- `.qoder/skills/`
- `.qwen/skills/`
- `.reasonix/skills/`
- `.rovodev/skills/`
- `.roo/skills/`
- `.tabnine/agent/skills/`
- `.terramind/skills/`
- `.tinycloud/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zcode/skills/`
- `.zencoder/skills/`
- `.neovate/skills/`
- `.pochi/skills/`
- `.adal/skills/`
<!-- skill-discovery:end -->

### 插件清单发现

如果存在 `.claude-plugin/marketplace.json` 或 `.claude-plugin/plugin.json`，其中声明的技能也会被发现：

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

这提供了与 [Claude Code 插件市场](https://code.claude.com/docs/en/plugin-marketplaces)生态的兼容性。清单中声明的技能路径会按其声明深度搜索，不受上述深度-2 目录遍历限制。

如果在标准位置未找到技能，将执行递归搜索。

## 兼容性

技能遵循共享的 [Agent Skills 规范](https://agentskills.io)，通常在各个智能体间兼容。但部分功能可能因智能体而异：

| 功能              | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | OpenClaw | Neovate | Pi  | Qoder | Zencoder |
| ----------------- | -------- | --------- | ----------- | ----- | --------- | ----- | ------------ | -------- | ------ | ----------- | -------- | -------------- | --- | -------- | ------- | --- | ----- | -------- |
| 基础技能          | 支持     | 支持      | 支持        | 支持  | 支持      | 支持  | 支持         | 支持     | 支持   | 支持        | 支持     | 支持           | 支持 | 支持     | 支持    | 支持 | 支持  | 支持     |
| `allowed-tools`   | 支持     | 支持      | 支持        | 支持  | 支持      | 支持  | 支持         | 不支持   | 支持   | 支持        | 支持     | 支持           | 支持 | 支持     | 支持    | 支持 | 支持  | 不支持   |
| `context: fork`   | 不支持   | 不支持    | 支持        | 不支持| 不支持    | 不支持| 不支持       | 不支持   | 不支持 | 不支持      | 不支持   | 不支持         | 不支持| 不支持   | 不支持  | 不支持| 不支持| 不支持   |
| Hooks             | 不支持   | 不支持    | 支持        | 支持  | 不支持    | 不支持| 不支持       | 支持     | 不支持 | 不支持      | 不支持   | 不支持         | 不支持| 不支持   | 不支持  | 不支持| 不支持| 不支持   |

## 故障排查

### “未找到技能”

确保仓库包含有效的 `SKILL.md` 文件，且 frontmatter 同时包含 `name` 和 `description`。

### 技能未在智能体中加载

- 确认技能已安装到正确路径
- 查阅智能体文档了解技能加载要求
- 确保 `SKILL.md` 的 frontmatter 是有效的 YAML

### 权限错误

确保你拥有目标目录的写权限。

## 环境变量

| 变量                    | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `SKILLS_LANG`           | 界面语言覆盖：`zh` 中文 / `en` 英文（默认自动检测系统语言）|
| `INSTALL_INTERNAL_SKILLS` | 设为 `1` 或 `true` 可显示并安装标记为 `internal: true` 的技能 |
| `DISABLE_TELEMETRY`     | 设置后禁用匿名使用遥测                                       |
| `DO_NOT_TRACK`          | 禁用遥测的另一种方式                                       |

```bash
# 强制中文界面
SKILLS_LANG=zh npx company-skills add vercel-labs/agent-skills --list

# 安装内部技能
INSTALL_INTERNAL_SKILLS=1 npx company-skills add vercel-labs/agent-skills --list
```

## 遥测

本 CLI 会收集匿名使用数据以帮助改进工具。不收集任何个人信息。

遥测在 CI 环境中自动禁用。

## 相关链接

- [Agent Skills 规范](https://agentskills.io)
- [技能目录](https://skills.sh)
- [Amp Skills 文档](https://ampcode.com/manual#agent-skills)
- [Antigravity Skills 文档](https://antigravity.google/docs/skills)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [OpenClaw Skills 文档](https://docs.openclaw.ai/tools/skills)
- [Cline Skills 文档](https://docs.cline.bot/features/skills)
- [CodeBuddy Skills 文档](https://www.codebuddy.ai/docs/ide/Features/Skills)
- [Codex Skills 文档](https://developers.openai.com/codex/skills)
- [Command Code Skills 文档](https://commandcode.ai/docs/skills)
- [Crush Skills 文档](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-skills)
- [Cursor Skills 文档](https://cursor.com/docs/context/skills)
- [Firebender Skills 文档](https://docs.firebender.com/multi-agent/skills)
- [Gemini CLI Skills 文档](https://geminicli.com/docs/cli/skills/)
- [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Kimi Code CLI Skills 文档](https://moonshotai.github.io/kimi-code/en/customization/skills)
- [Kiro CLI Skills 文档](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources)
- [Kode Skills 文档](https://github.com/shareAI-lab/kode/blob/main/docs/skills.md)
- [OpenCode Skills 文档](https://opencode.ai/docs/skills)
- [Qwen Code Skills 文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
- [OpenHands Skills 文档](https://docs.openhands.ai/modules/usage/how-to/using-skills)
- [Qoder Skills 文档](https://docs.qoder.com/cli/Skills)
- [Replit Skills 文档](https://docs.replit.com/replitai/skills)
- [Roo Code Skills 文档](https://docs.roocode.com/features/skills)
- [Trae Skills 文档](https://docs.trae.ai/ide/skills)
- [Vercel Agent Skills 仓库](https://github.com/vercel-labs/agent-skills)

## License

本项目基于 [MIT License](LICENSE) 许可。
