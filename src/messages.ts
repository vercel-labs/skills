export type Locale = 'en' | 'zh';

let cachedLocale: Locale | null = null;

/**
 * Detect the display language. Priority:
 * 1. SKILLS_LANG env override (zh | en)
 * 2. LC_ALL / LC_MESSAGES / LANG env vars (zh* prefix -> Chinese)
 * Defaults to English.
 */
export function detectLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  const override = process.env.SKILLS_LANG;
  if (override === 'zh' || override === 'en') {
    cachedLocale = override;
    return cachedLocale;
  }
  const lang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  cachedLocale = /^zh/i.test(lang) ? 'zh' : 'en';
  return cachedLocale;
}

/** Reset the cached locale (mainly for tests). */
export function resetLocale(): void {
  cachedLocale = null;
}

const zhDict: Record<string, string> = {
  // Banner
  'The open agent skills ecosystem': '开放智能体技能生态',
  'Add a new skill': '添加新技能',
  'Use a skill without installing': '无需安装直接使用技能',
  'Remove installed skills': '移除已安装技能',
  'List installed skills': '列出已安装技能',
  'Search for skills': '搜索技能',
  'Update installed skills': '更新已安装技能',
  'Restore from skills-lock.json': '从 skills-lock.json 恢复',
  'Create a new skill': '创建新技能',
  'Sync skills from node_modules': '从 node_modules 同步技能',
  'try:': '试试：',
  'Discover more skills at': '发现更多技能：',

  // Help
  Usage: '用法',
  'Manage Skills:': '管理技能：',
  'Add a skill package (alias: a)': '添加技能包（别名：a）',
  'Generate a prompt for using one skill without installing it':
    '生成提示词，使用某个技能而不安装它',
  'Search for skills interactively': '交互式搜索技能',
  'Find Options:': '查找选项：',
  'Search only repositories from a GitHub owner': '仅搜索指定 GitHub 用户/组织的仓库',
  'Updates:': '更新：',
  'Update skills to latest versions (alias: upgrade)': '将技能更新到最新版本（别名：upgrade）',
  'Update Options:': '更新选项：',
  'Update global skills only': '仅更新全局技能',
  'Update project skills only': '仅更新项目技能',
  'Skip scope prompt (auto-detect: project if in a project, else global)':
    '跳过范围询问（自动检测：项目内则项目，否则全局）',
  'Project:': '项目：',
  'Restore skills from skills-lock.json': '从 skills-lock.json 恢复',
  'Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)':
    '初始化技能（创建 <name>/SKILL.md 或 ./SKILL.md）',
  'Sync skills from node_modules into agent directories': '从 node_modules 同步技能到智能体目录',
  'Add Options:': '添加选项：',
  'Install skill globally (user-level) instead of project-level': '安装到全局（用户级）而非项目级',
  "Specify agents to install to (use '*' for all agents)":
    "指定安装到的智能体（使用 '*' 表示所有智能体）",
  "Specify skill names to install (use '*' for all skills)":
    "指定要安装的技能名（使用 '*' 表示所有技能）",
  'List available skills in the repository without installing': '列出仓库中的可用技能而不安装',
  'Skip confirmation prompts': '跳过确认提示',
  'Copy files instead of symlinking to agent directories': '复制文件而非符号链接到智能体目录',
  'Attach valid JSON to the install telemetry event': '将有效 JSON 附加到安装遥测事件',
  "Install to Eve subagents (use 'root' for the root agent)":
    '安装到 Eve 子智能体（root 表示根智能体）',
  "Shorthand for --skill '*' --agent '*' -y": "等价于 --skill '*' --agent '*' -y",
  'Search all subdirectories even when a root SKILL.md exists':
    '即使存在根 SKILL.md 也搜索所有子目录',
  'Use Options:': '使用选项：',
  'Specify the skill to use': '指定要使用的技能',
  'Start one supported agent interactively': '以交互方式启动受支持的智能体',
  'Allow unverified OpenClaw community skills': '允许未经验证的 OpenClaw 社区技能',
  'Remove Options:': '移除选项：',
  'Remove from global scope': '从全局范围移除',
  "Remove from specific agents (use '*' for all agents)":
    "从指定智能体移除（使用 '*' 表示所有智能体）",
  "Specify skills to remove (use '*' for all skills)": "指定要移除的技能（使用 '*' 表示所有技能）",
  'Experimental Sync Options:': '实验性同步选项：',
  'List Options:': '列出选项：',
  'List global skills (default: project)': '列出全局技能（默认：项目）',
  'Filter by specific agents': '按指定智能体过滤',
  'Output as JSON (machine-readable, no ANSI codes)': '以 JSON 输出（机器可读，无 ANSI 代码）',
  'Options:': '选项：',
  'Show this help message': '显示帮助信息',
  'Show version number': '显示版本号',
  'Examples:': '示例：',
  'update a single skill': '更新单个技能',
  'restore from skills-lock.json': '从 skills-lock.json 恢复',
  'sync from node_modules': '从 node_modules 同步',
  'sync without prompts': '无提示同步',
  Description: '说明',
  'Remove installed skills from agents. If no skill names are provided, an interactive selection menu will be shown.':
    '从智能体中移除已安装的技能。如果未提供技能名，将显示交互式选择菜单。',
  'Arguments:': '参数：',
  'Optional skill names to remove (space-separated)': '要移除的技能名（空格分隔，可选）',
  'Remove from global scope (~/) instead of project scope': '从全局范围（~/）而非项目范围移除',
  'interactive selection': '交互式选择',
  'remove specific skill': '移除指定技能',
  'remove multiple skills': '移除多个技能',
  'remove from global scope': '从全局范围移除',
  'remove from specific agent': '从指定智能体移除',
  'remove all skills': '移除所有技能',
  'remove all skills from cursor': '从 cursor 移除所有技能',
  '--owner requires a GitHub owner': '--owner 需要一个 GitHub 用户/组织名',
  '--owner must be a valid GitHub owner': '--owner 必须是有效的 GitHub 用户/组织名',
  install: '次安装',
  installs: '次安装',
  'Search skills:': '搜索技能：',
  'Start typing to search (min 2 chars)': '输入以搜索（至少 2 个字符）',
  'Searching…': '搜索中…',
  'No skills found': '未找到技能',
  'up/down navigate | enter select | esc cancel': '上下键导航 | 回车选择 | esc 取消',
  'Tip: if running in a coding agent, follow these steps:':
    '提示：如果在编程智能体中运行，请按以下步骤操作：',
  'No skills found for "{query}"': '未找到与 "{query}" 匹配的技能',
  'from owner "{owner}"': '来自用户/组织 "{owner}"',
  'Install with': '使用以下命令安装',
  'Search cancelled': '搜索已取消',
  'Installing {name} from {pkg}…': '正在从 {pkg} 安装 {name}…',
  'View the skill at': '查看技能：',
  'Usage: npx skills find <query> [--owner <owner>]':
    '用法：npx skills find <query> [--owner <owner>]',

  // Update
  'Update scope': '更新范围',
  Project: '项目',
  'Update skills in current directory': '更新当前目录中的技能',
  Global: '全局',
  'Update skills in home directory': '更新主目录中的技能',
  Both: '两者',
  'Update all skills': '更新所有技能',
  Cancelled: '已取消',
  'Local path': '本地路径',
  'Git URL': 'Git 地址',
  'Well-known skill': '知名来源技能',
  'Private or deleted repo': '私有或已删除的仓库',
  'No skill path recorded': '未记录技能路径',
  'No version tracking': '无版本跟踪',
  '{count} skill(s) cannot be checked automatically:': '{count} 个技能无法自动检查：',
  'To update:': '更新方式：',
  'Warning:': '警告：',
  'The following skills from {source} appear to have been deleted upstream:':
    '以下来自 {source} 的技能似乎已在上游被删除：',
  'Skipping deletion in non-interactive mode.': '非交互模式下跳过删除。',
  'Would you like to remove the local copies of these deleted skills?':
    '是否要移除这些已删除技能的本地副本？',
  Removing: '正在移除',
  '{count} new skill(s) available from this source:': '此来源有 {count} 个新技能可用：',
  'To install:': '安装方式：',
  'Checking skills from source: {source}': '正在检查来源 {source} 中的技能',
  'Failed to check skills from {source}': '无法检查来自 {source} 的技能',
  'CLI entrypoint not found at {path}': '在 {path} 未找到 CLI 入口',
  'Updating {name}…': '正在更新 {name}…',
  'Updated {name}': '已更新 {name}',
  'Failed to update {name}': '更新 {name} 失败',
  'No global skills tracked in lock file.': '锁定文件中没有跟踪全局技能。',
  'Install skills with': '使用以下命令安装技能',
  'No global skills to check.': '没有可检查的全局技能。',
  'All global skills are up to date': '所有全局技能都已是最新',
  'Found {count} global update(s)': '发现 {count} 个全局更新',
  'Cannot update {name}: lock file is missing sourceUrl for this generic Git source':
    '无法更新 {name}：锁定文件缺少此通用 Git 来源的 sourceUrl',
  'Failed to update {name}: CLI entrypoint not found at {path}':
    '更新 {name} 失败：在 {path} 未找到 CLI 入口',
  'Failed to fetch tree for {source}': '无法获取 {source} 的仓库树',
  'No project skills to update.': '没有可更新的项目技能。',
  'Install project skills with': '使用以下命令安装项目技能',
  'No project skills can be updated in place.': '没有可原地更新的项目技能。',
  'Updating for: {agents}': '正在更新：{agents}',
  'Refreshing {count} skill(s)…': '正在刷新 {count} 个技能…',
  'Cannot update {source}: skills-lock.json is missing sourceUrl for this generic Git source':
    '无法更新 {source}：skills-lock.json 缺少此通用 Git 来源的 sourceUrl',
  'Cannot update {name}: skills-lock.json is missing sourceUrl for this generic Git source':
    '无法更新 {name}：skills-lock.json 缺少此通用 Git 来源的 sourceUrl',
  'Failed to check for deleted skills from {source}': '无法检查来自 {source} 的已删除技能',
  '{count} project skill(s) cannot be updated automatically (installed before skillPath tracking):':
    '{count} 个项目技能无法自动更新（在 skillPath 跟踪之前安装）：',
  'To refresh:': '刷新方式：',
  'To refresh: reinstall using the original full Git URL; this lock entry only has an ambiguous shorthand.':
    '刷新方式：请使用原始完整 Git 地址重新安装；此锁定条目只有模糊的简写。',
  'Updating {skills}…': '正在更新 {skills}…',
  'Checking for skill updates…': '正在检查技能更新…',
  'Global Skills': '全局技能',
  'Project Skills': '项目技能',
  'No installed skills found matching: {skills}': '未找到与 {skills} 匹配的已安装技能',
  'Updated {count} skill(s)': '已更新 {count} 个技能',
  'Failed to update {count} skill(s)': '更新 {count} 个技能失败',

  // Add
  'Skill: {name}': '技能：{name}',
  'Files: {files}': '文件：{files}',
  'Available Skills': '可用技能',
  'Run without --list to install': '不带 --list 运行即可安装',
  'Installing all {count} skills': '正在安装全部 {count} 个技能',
  'No matching skills found for: {skills}': '未找到与 {skills} 匹配的技能',
  'Available skills:': '可用技能：',
  'Select skills to install': '选择要安装的技能',
  '(space to toggle)': '（空格切换）',
  'Installation cancelled': '安装已取消',
  'Which agents do you want to install to?': '要安装到哪些智能体？',
  'Installing to: {agents}': '正在安装到：{agents}',
  'Installation scope': '安装范围',
  'Install in current directory (committed with your project)': '安装到当前目录（随项目提交）',
  'Install in home directory (available across all projects)': '安装到主目录（所有项目可用）',
  'Installation method': '安装方式',
  'Symlink (Recommended)': '符号链接（推荐）',
  'Single source of truth, easy updates': '单一来源，易于更新',
  'Copy to all agents': '复制到所有智能体',
  'Independent copies for each agent': '每个智能体独立副本',
  'Installation Summary': '安装摘要',
  'Proceed with installation?': '继续安装？',
  'Installing skills…': '正在安装技能…',
  'Installation complete': '安装完成',
  'overwrites:': '覆盖：',
  'Installed {count} skill(s)': '已安装 {count} 个技能',
  'Symlinks failed for: {agents}': '以下智能体符号链接失败：{agents}',
  'Files were copied instead. On Windows, enable Developer Mode for symlink support.':
    '已改为复制文件。在 Windows 上，请启用开发者模式以支持符号链接。',
  'Failed to install {count}': '有 {count} 个安装失败',
  'Done!': '完成！',
  'Review skills before use; they run with full agent permissions.':
    '使用前请审查技能；它们以完整智能体权限运行。',
  'Tip: use the --yes (-y) and --global (-g) flags to install without prompts.':
    '提示：使用 --yes (-y) 和 --global (-g) 参数可免提示安装。',
  ' ERROR ': ' 错误 ',
  'Missing required argument: source': '缺少必需参数：source',
  '  Usage:': '  用法：',
  '  Example:': '  示例：',
  'Validating local path…': '正在验证本地路径…',
  'Path not found': '路径不存在',
  'Local path does not exist: {path}': '本地路径不存在：{path}',
  'Local path validated': '本地路径已验证',
  'Discovering skills…': '正在发现技能…',
  'No valid skills found. Skills require a SKILL.md with name and description.':
    '未找到有效技能。技能需要包含 name 和 description 的 SKILL.md。',
  'Found {count} skill(s)': '发现 {count} 个技能',
  'Use --skill <name> to install specific skills': '使用 --skill <name> 安装指定技能',
  General: '通用',
  'Selected {count} skill(s): {skills}': '已选择 {count} 个技能：{skills}',
  'Installing to all {count} agents': '正在安装到全部 {count} 个智能体',
  'Invalid agents: {agents}': '无效的智能体：{agents}',
  'Valid agents: {agents}': '有效智能体：{agents}',
  'Loading agents…': '正在加载智能体…',
  '{count} agents': '{count} 个智能体',
  'Installing to all agents': '正在安装到所有智能体',
  'Detected an eve project. Install {skills} for your {agent} to use?':
    '检测到 eve 项目。是否将 {skills} 安装给您的 {agent} 使用？',
  '{count} selected skills': '{count} 个已选技能',
  'Failed to clone repository': '克隆仓库失败',
  'Unknown error occurred': '发生未知错误',
  'Installation failed': '安装失败',
  "One-time prompt - you won't be asked again if you dismiss.":
    '一次性提示 - 如果您选择跳过，将不再询问。',
  'Install the {skill} skill? It helps your agent discover and suggest skills.':
    '是否安装 {skill} 技能？它可以帮助您的智能体发现和推荐技能。',
  'Installing find-skills skill…': '正在安装 find-skills 技能…',
  'Select agents to install skills to': '选择要安装技能的智能体',
  'Security Risk Assessments': '安全风险评估',
  'No well-known skills found; trying direct download...': '未找到知名来源技能；尝试直接下载...',
  'Source:': '来源：',
  'Downloaded {kind}': '已下载 {kind}',
  'SKILL.md file': 'SKILL.md 文件',
  archive: '压缩包',
  'Falling back to clone…': '回退到克隆…',
  'Repository cloned': '仓库已克隆',
  'Parsing source…': '正在解析来源…',
  'Downloading source...': '正在下载来源...',
  'Discovering skills...': '正在发现技能...',
  'Fetching skills…': '正在获取技能…',
  'Cloning repository…': '正在克隆仓库…',
  copied: '已复制',

  // List
  'No {scope} skills found.': '未找到{scope}技能。',
  global: '全局',
  project: '项目',
  'Try listing project skills without -g': '试试不带 -g 列出项目技能',
  'Try listing global skills with -g': '试试带 -g 列出全局技能',
  'Agents:': '智能体：',

  // Remove
  'No skills found to remove.': '没有找到要移除的技能。',
  'Select skills to remove': '选择要移除的技能',
  'Removal cancelled': '移除已取消',
  'Targeting {count} potential agent(s)': '目标为 {count} 个潜在智能体',
  'Skills to remove:': '要移除的技能：',
  'Are you sure you want to uninstall {count} skill(s)?': '确定要卸载 {count} 个技能吗？',
  'Removing skills…': '正在移除技能…',
  'Successfully removed {count} skill(s)': '成功移除 {count} 个技能',
  'Failed to remove {count} skill(s)': '移除 {count} 个技能失败',

  // Sync
  'Agent detected — installing non-interactively': '检测到智能体 — 以非交互方式安装',
  'Scanning node_modules for skills…': '正在扫描 node_modules 中的技能…',
  'No SKILL.md files found in node_modules.': '在 node_modules 中未找到 SKILL.md 文件。',
  'Found {count} skill(s) in node_modules': '在 node_modules 中发现 {count} 个技能',
  'from {package}': '来自 {package}',
  'Force mode: reinstalling all skills': '强制模式：重新安装所有技能',
  '{count} skill(s) already up to date': '{count} 个技能已是最新',
  'All skills are up to date.': '所有技能都已是最新。',
  '{count} skill(s) to install/update': '{count} 个技能待安装/更新',
  'Sync cancelled': '同步已取消',
  'Universal (.agents/skills)': '通用（.agents/skills）',
  'Sync Summary': '同步摘要',
  'Proceed with sync?': '继续同步？',
  'Syncing skills…': '正在同步技能…',
  'Synced {count} skill(s)': '已同步 {count} 个技能',

  // Use
  'Generate a prompt for using one skill without installing it.':
    '生成提示词，使用某个技能而不安装它。',
  'Search nested directories like skills add --full-depth':
    '搜索嵌套目录，类似 skills add --full-depth',
  'Expected one source, received {count}: {skills}':
    '应提供一个来源，实际收到 {count} 个：{skills}',
  'OpenClaw skills are unverified community submissions.': 'OpenClaw 技能是未经审核的社区提交。',
  'Skills run with full agent permissions and could be malicious.':
    '技能以完整智能体权限运行，可能存在恶意。',
  'If you understand the risks, re-run with: {cmd}': '如了解风险，请使用以下命令重试：{cmd}',
  'Running {agent} is not supported yet.': '暂不支持运行 {agent}。',
  'Supported agents for skills use --agent: {agents}': 'skills use --agent 支持的智能体：{agents}',
  'Skipping broken symlink: {path}': '跳过损坏的符号链接：{path}',
  'Invalid skill name: potential path traversal detected': '无效的技能名：检测到潜在路径穿越',
  'Conflicting skill selectors: source selects "{source}" but --skill selects "{option}". Provide one selector.':
    '技能选择器冲突：来源选择了 "{source}"，但 --skill 选择了 "{option}"。请只提供一个。',
  'Skill selector "{selector}" matched multiple skills.':
    '技能选择器 "{selector}" 匹配到多个技能。',
  'No skills found at this URL. Make sure the server has a /.well-known/agent-skills/index.json or /.well-known/skills/index.json file.':
    '此地址未找到技能。请确保服务器有 /.well-known/agent-skills/index.json 或 /.well-known/skills/index.json 文件。',
  'This source contains multiple skills. Specify exactly one skill:':
    '此来源包含多个技能。请指定一个技能：',
  'No matching skill found for: {selector}': '未找到与 {selector} 匹配的技能',

  // Install (experimental_install)
  'No project skills found in skills-lock.json': '在 skills-lock.json 中未找到项目技能',
  'Add project-level skills with {cmd} (without {flag})':
    '使用 {cmd} 添加项目级技能（不带 {flag}）',
  'Cannot restore {name}: skills-lock.json is missing sourceUrl for this generic Git source':
    '无法恢复 {name}：skills-lock.json 缺少此通用 Git 来源的 sourceUrl',
  'Restoring {count} skill(s) from skills-lock.json into {dir}':
    '正在将 {count} 个技能从 skills-lock.json 恢复到 {dir}',
  'Failed to install from {source}: {error}': '从 {source} 安装失败：{error}',
  'Unknown error': '未知错误',
  '{count} skill(s) from node_modules': '{count} 个技能来自 node_modules',
  'Failed to sync node_modules skills: {error}': '同步 node_modules 技能失败：{error}',

  // Skills discovery
  '⚠ Skipped {path} — {reason}': '⚠ 已跳过 {path} — {reason}',
  'Agent detected — removing non-interactively': '检测到智能体 — 以非交互方式移除',
  'Could not scan directory {dir}: {error}': '无法扫描目录 {dir}：{error}',
  'Could not remove skill from {agent}: {error}': '无法从 {agent} 移除技能：{error}',
  'Installing to universal agents': '正在安装到通用智能体',

  // Init
  'Initialized skill: {name}': '已初始化技能：{name}',
  'Created:': '已创建：',
  'Next steps:': '下一步：',
  'Edit {path} to define your skill instructions': '编辑 {path} 以定义技能说明',
  'Update the {name} and {description} in the frontmatter':
    '更新 frontmatter 中的 {name} 和 {description}',
  'Publishing:': '发布：',
  'GitHub:': 'GitHub：',
  'URL:': 'URL：',
  'Push to a repo, then': '推送到仓库，然后',
  'Host the file, then': '托管该文件，然后',
  'Browse existing skills for inspiration at': '浏览现有技能以获取灵感：',
  'Skill already exists at {path}': '技能已存在于 {path}',
  'Error: {message}': '错误：{message}',
  'Unknown command: {command}': '未知命令：{command}',
  'Run {cmd} for usage.': '运行 {cmd} 查看用法。',
};

/**
 * Translate an English message template to the active locale.
 * The English string is used as the lookup key and as the fallback.
 * Placeholders use {name} syntax and are substituted from `vars`.
 */
export function t(template: string, vars?: Record<string, string | number>): string {
  let s = detectLocale() === 'zh' && zhDict[template] ? zhDict[template] : template;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
