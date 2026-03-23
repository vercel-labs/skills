# 印象笔记 Skill - 快速开始指南

## 简介

`evernote-note` 是一个用于管理印象笔记的通用 skill，支持：
- 🔍 搜索笔记（标题/关键词/笔记本）
- 📚 浏览笔记本
- 📖 读取笔记内容
- ➕ 新建笔记
- 📌 追加内容到笔记

## 安装前准备

### 1. 注册印象笔记账户

如果你还没有印象笔记账户，请先注册：
- 国内版：https://www.yinxiang.com/
- 国际版：https://evernote.com/

### 2. 选择认证方式

印象笔记提供两种认证方式：

#### 方式一：开发者令牌（推荐，无需申请）

**适用场景**：个人使用、测试脚本、快速接入

**优点**：
- ✅ 无需申请，立即可用
- ✅ 配置简单，几分钟搞定
- ✅ 适合个人工具和自动化脚本

**获取步骤**：

**国内版用户**：
访问：https://app.yinxiang.com/api/DeveloperToken.action

1. 点击"Create a developer token"
2. 复制生成的 token（格式类似：`S=s1:U=8f219:E=...`）
3. **妥善保管**，页面只显示一次

**国际版用户**：
访问：https://www.evernote.com/api/DeveloperToken.action

步骤同上。

#### 方式二：API Key + OAuth（需要申请）

**适用场景**：开发面向多用户的第三方应用

**优点**：
- ✅ 支持多用户访问
- ✅ 更高的安全性
- ✅ 支持高级功能（Webhook、应用笔记本等）

**缺点**：
- ❌ 需要申请 API Key（审核周期 1-5 个工作日）
- ❌ 需要实现完整的 OAuth 流程
- ❌ 开发复杂度较高

**获取步骤**：
1. 访问 https://dev.yinxiang.com/support/（需登录印象笔记账户）
2. 填写应用信息（名称、描述、权限等）
3. 等待审核（1-5 个工作日）
4. 收到邮件后获取 Consumer Key 和 Consumer Secret

> **注意**：当前 skill 只支持开发者令牌方式。如需使用 OAuth，需要参考 [OAuth 认证文档](https://dev.yinxiang.com/doc/articles/authentication.php) 修改 skill 代码。

### 3. 安装 Python 依赖

打开终端，运行：

```bash
pip3 install evernote2 oauth2
```

## 配置环境变量

### macOS / Linux

编辑你的 shell 配置文件（`~/.zshrc` 或 `~/.bashrc`）：

```bash
# 国内版用户
export EVERNOTE_TOKEN="your_developer_token_here"
export EVERNOTE_HOST="app.yinxiang.com"

# 国际版用户
# export EVERNOTE_TOKEN="your_developer_token_here"
# export EVERNOTE_HOST="www.evernote.com"
```

使配置生效：

```bash
source ~/.zshrc
```

### Windows PowerShell

编辑 `$PROFILE` 文件：

```powershell
# 国内版用户
$env:EVERNOTE_TOKEN = "your_developer_token_here"
$env:EVERNOTE_HOST = "app.yinxiang.com"
```

## 安装 Skill

### 方式一：从 GitHub 安装

```bash
npx skills add github.com/your-username/evernote-note-skill
```

### 方式二：手动安装

1. 克隆仓库：
```bash
git clone https://github.com/your-username/evernote-note-skill.git
```

2. 复制到 skills 目录：
```bash
cp -r evernote-note-skill/ ~/.workbuddy/skills/evernote-note/
```

## 验证安装

运行以下命令验证是否配置正确：

```python
import sys
import os
from evernote2.api.client import EvernoteClient

# 检查环境变量
if not os.environ.get('EVERNOTE_TOKEN'):
    print("❌ 缺少 EVERNOTE_TOKEN 环境变量")
    exit(1)

# 检查 Python 依赖
try:
    import evernote2
except ImportError:
    print("❌ 缺少 evernote2 依赖，请运行: pip3 install evernote2 oauth2")
    exit(1)

# 测试连接
try:
    developer_token = os.environ.get('EVERNOTE_TOKEN')
    service_host = os.environ.get('EVERNOTE_HOST', 'app.yinxiang.com')
    
    client = EvernoteClient(token=developer_token, service_host=service_host)
    note_store = client.get_note_store()
    
    notebooks = note_store.listNotebooks()
    print(f"✅ 连接成功！你共有 {len(notebooks)} 个笔记本")
except Exception as e:
    print(f"❌ 连接失败: {e}")
    exit(1)
```

保存为 `test_evernote.py` 并运行：

```bash
python3 test_evernote.py
```

## 使用示例

### 搜索笔记

```python
from evernote2.api.client import EvernoteClient
import evernote2.edam.notestore.ttypes as NoteStoreTypes
import os

client = EvernoteClient(
    token=os.environ['EVERNOTE_TOKEN'],
    service_host=os.environ.get('EVERNOTE_HOST', 'app.yinxiang.com')
)
note_store = client.get_note_store()

# 按标题搜索
filter = NoteStoreTypes.NoteFilter()
filter.words = 'intitle:"项目管理"'
result = note_store.findNotesMetadata(
    os.environ['EVERNOTE_TOKEN'], 
    filter, 
    0,  # offset
    20, # maxNotes
    NoteStoreTypes.NotesMetadataResultSpec(includeTitle=True)
)

for note in result.notes:
    print(f"- {note.title}")
```

### 新建笔记

```python
import evernote2.edam.type.ttypes as Types

note = Types.Note()
note.title = "测试笔记"
note.content = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>这是测试内容</en-note>'''

created = note_store.createNote(os.environ['EVERNOTE_TOKEN'], note)
print(f"创建成功，GUID: {created.guid}")
```

## 常见问题

### Q1: 提示"缺少 EVERNOTE_TOKEN 环境变量"

**A:** 确保已按"配置环境变量"步骤设置，并运行 `source ~/.zshrc` 使配置生效。

### Q2: 提示"ModuleNotFoundError: No module named 'evernote2'"

**A:** 运行 `pip3 install evernote2 oauth2` 安装依赖。

### Q3: 连接超时或失败

**A:** 检查：
1. 网络连接是否正常
2. `EVERNOTE_HOST` 是否正确（国内版用 `app.yinxiang.com`，国际版用 `www.evernote.com`）
3. 开发者令牌是否有效

### Q4: 提示权限不足

**A:** 开发者令牌只能访问自己的账户。如果需要访问其他账户，需要使用 OAuth 认证（当前 skill 不支持）。

### Q5: API 调用频率限制

**A:** 印象笔记对 API 调用有频率限制，建议：
- 每次搜索限制返回数量（如 20 条）
- 避免短时间内大量请求

### Q6: 是否需要申请 API Key？

**A:** **不需要**！这个 skill 使用开发者令牌（Developer Token）方式，无需申请 API Key。开发者令牌可以直接在印象笔记官网生成，几分钟就能完成配置。

只有当你需要开发面向多用户的第三方应用时，才需要申请 API Key 并实现 OAuth 认证。

### Q7: 开发者令牌和 API Key 有什么区别？

**A:** 见下表对比：

| 项目 | 开发者令牌 | API Key + OAuth |
|------|-----------|----------------|
| **用途** | 访问自己的账户 | 面向多用户的应用 |
| **获取方式** | 直接生成，无需审核 | 需要申请，1-5 个工作日 |
| **配置复杂度** | 简单（复制 token 即可） | 复杂（需要实现 OAuth 流程） |
| **支持功能** | 基础 CRUD | 基础 CRUD + Webhook + 高级权限 |
| **适用场景** | 个人工具、脚本 | 公开发布的应用 |

## 安全建议

1. **保护令牌**：开发者令牌可完全访问你的印象笔记账户，请勿泄露
2. **使用环境变量**：不要将令牌硬编码在代码中
3. **定期更换**：建议定期更换令牌，如果怀疑泄露立即撤销

## 下一步

- 阅读完整 API 文档：`references/api.md`
- 学习搜索语法：[印象笔记搜索语法](https://help.evernote.com/hc/zh-cn/articles/209005987)
- 了解 ENML 格式：[ENML 规范](https://dev.yinxiang.com/doc/articles/enml.php)

## 反馈与支持

如有问题或建议，欢迎：
- 提交 Issue：https://github.com/your-username/evernote-note-skill/issues
- 发送邮件：your-email@example.com
