# 发布说明

## Skill 信息

| 项目 | 内容 |
|------|------|
| **Skill 名称** | evernote-note |
| **版本** | 1.0.0 |
| **描述** | 印象笔记 API skill，用于管理用户的印象笔记 |
| **主页** | https://www.yinxiang.com |
| **开发者** | WorkBuddy Team |

## 功能特性

- ✅ 搜索笔记（标题/关键词/笔记本）
- ✅ 浏览笔记本列表
- ✅ 读取笔记内容
- ✅ 新建笔记
- ✅ 追加内容到笔记
- ✅ 支持国内版和国际版印象笔记

## 依赖项

### 用户环境要求

1. **Python 3.6+**
   - 用于运行 evernote2 SDK

2. **Python 包**
   ```bash
   pip3 install evernote2 oauth2
   ```

### 环境变量

用户必须配置以下环境变量：

| 环境变量 | 必填 | 说明 | 示例 |
|---------|------|------|------|
| `EVERNOTE_TOKEN` | 是 | 印象笔记开发者令牌 | `S=s1:U=8f219:E=...` |
| `EVERNOTE_HOST` | 否 | 印象笔记服务器 | `app.yinxiang.com`（默认）或 `www.evernote.com` |

## 文件结构

```
evernote-note/
├── SKILL.md              # 核心 skill 文档（YAML frontmatter + Markdown）
├── README.md             # 用户快速开始指南
├── PUBLISH.md            # 发布说明（本文件）
├── _meta.json            # Skill 元数据
├── test_evernote.py      # 验证脚本（可选，提供给用户）
└── references/
    └── api.md            # 详细 API 参考文档
```

## 发布清单

发布前请确保：

- [ ] **移除所有私人凭证**
  - 不包含任何 EVERNOTE_TOKEN
  - 不包含任何 API Key
  - 不包含任何私人信息

- [ ] **文档完整性**
  - SKILL.md 包含完整的 Setup 指引
  - README.md 包含用户友好的快速开始指南
  - references/api.md 包含完整的 API 参考

- [ ] **代码验证**
  - 运行 `test_evernote.py` 验证配置流程
  - 测试所有核心功能（搜索、新建、读取等）

- [ ] **元数据正确**
  - _meta.json 包含正确的版本号
  - SKILL.md 中的 YAML frontmatter 正确

- [ ] **隐私规则**
  - SKILL.md 中明确说明隐私规则
  - 群聊场景中只展示标题和摘要

## 发布方式

### 方式一：发布到 skills.sh

1. **创建 GitHub 仓库**

   ```bash
   git init
   git add .
   git commit -m "Initial release: evernote-note v1.0.0"
   git branch -M main
   git remote add origin https://github.com/your-username/evernote-note-skill.git
   git push -u origin main
   ```

2. **添加 skill 元数据**

   确保仓库根目录包含 `SKILL.md` 且有正确的 frontmatter。

3. **提交到 skills.sh**

   访问 https://skills.sh/ 按指引提交 skill。

### 方式二：发布到 ClawHub

1. **创建 GitHub 仓库**（同上）

2. **提交到 ClawHub**

   访问 https://clawhub.com/ 按指引注册并提交 skill。

## 用户使用流程

1. **用户看到 skill 并决定安装**

2. **阅读 README.md**
   - 了解 skill 功能
   - 了解安装前准备

3. **获取开发者令牌**
   - 访问 https://app.yinxiang.com/api/DeveloperToken.action
   - 生成并复制 token

4. **安装依赖**
   ```bash
   pip3 install evernote2 oauth2
   ```

5. **配置环境变量**
   ```bash
   export EVERNOTE_TOKEN="their_token"
   export EVERNOTE_HOST="app.yinxiang.com"
   ```

6. **验证配置**
   ```bash
   python3 test_evernote.py
   ```

7. **开始使用**
   - 通过 WorkBuddy 对话使用 skill
   - 参考 SKILL.md 中的工作流

## 常见问题（FAQ）

### Q: 为什么需要开发者令牌？

A: 开发者令牌是印象笔记 API 的认证方式，用于访问用户账户。每个用户都需要自己获取，skill 不能提供通用令牌。

### Q: 这个 skill 会存储我的笔记内容吗？

A: 不会。skill 只通过 API 访问你的印象笔记账户，不会存储或传输笔记内容到第三方服务器。

### Q: 安全性如何？

A:
- 开发者令牌只在你本地使用
- skill 不会上传任何凭证
- 建议定期更换令牌

### Q: 国际版用户可以使用吗？

A: 可以。配置 `EVERNOTE_HOST="www.evernote.com"` 即可。

### Q: 有使用限制吗？

A:
- API 调用有频率限制（印象笔记官方限制）
- 开发者令牌只能访问自己的账户
- 不支持多用户共享

## 技术支持

- GitHub Issues: https://github.com/your-username/evernote-note-skill/issues
- 邮件: your-email@example.com

## 更新日志

### v1.0.0 (2026-03-22)

初始发布

- 支持搜索、浏览、读取、新建、追加笔记
- 支持国内版和国际版印象笔记
- 完整的文档和验证脚本
- 隐私保护规则

## 许可证

MIT License

## 致谢

感谢以下项目和资源：
- 印象笔记官方 API 文档
- evernote2 Python SDK
- WorkBuddy Skill 生态系统
