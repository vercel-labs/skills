---
name: evernote-note
description: |
  印象笔记 API skill，用于管理用户的印象笔记。支持搜索笔记、浏览笔记本、获取笔记内容、新建笔记和追加内容。
  当用户提到印象笔记、Evernote、笔记、备忘录、记事、知识库，或者想要查找、阅读、创建、编辑笔记内容时，使用此 skill。
  即使用户没有明确说"笔记"，只要意图涉及个人文档的存取（如"帮我记一下"、"我之前写过一个关于XX的东西"、"把这段内容保存下来"），也应触发此 skill。
homepage: https://www.yinxiang.com
metadata:
  {
    "openclaw":
      {
        "emoji": "📔",
        "requires": { "env": ["EVERNOTE_TOKEN"] },
        "primaryEnv": "EVERNOTE_TOKEN"
      },
  }
---

# evernote-note

通过印象笔记 API 管理用户个人笔记，支持读取（搜索、列表、获取内容）和写入（新建、追加）。

完整的数据结构和接口参数详见 `references/api.md`。

## Setup

### 选择认证方式

印象笔记支持两种认证方式，**推荐使用开发者令牌（更简单）**：

| 方式 | 适用场景 | 复杂度 | 说明 |
|------|---------|--------|------|
| **开发者令牌**（推荐） | 个人使用、测试脚本 | ⭐ 简单 | 直接使用，无需申请，只能访问自己的账户 |
| **API Key + OAuth** | 面向多用户的第三方应用 | ⭐⭐⭐ 复杂 | 需申请，支持多用户和高级功能 |

#### 方式一：开发者令牌（推荐）

1. **获取印象笔记开发者令牌**：
   - 国内版访问：https://app.yinxiang.com/api/DeveloperToken.action
   - 国际版访问：https://www.evernote.com/api/DeveloperToken.action
   - 点击"Create a developer token"生成令牌
   - 复制生成的 token（格式类似 `S=s1:U=8f219:E=154308dc976:C=14cd8dc9cd8:P=1cd:A=en-devtoken:V=2:H=1e4d28c7982faf6222ecf55df3a2e84b`）

2. **配置环境变量**：

```bash
# 国内版用户（默认）
export EVERNOTE_TOKEN="your_developer_token"
export EVERNOTE_HOST="app.yinxiang.com"

# 国际版用户（如使用的是国际版印象笔记）
export EVERNOTE_TOKEN="your_developer_token"
export EVERNOTE_HOST="www.evernote.com"
```

> 建议将上述 export 语句写入 `~/.zshrc` 或 `~/.bashrc`，避免每次重开终端失效。

#### 方式二：API Key + OAuth（可选）

如果需要开发面向多用户的第三方应用，需要：

1. **申请 API Key**：
   - 访问 https://dev.yinxiang.com/support/（需登录印象笔记账户）
   - 填写应用信息（名称、描述、权限等）
   - 等待审核（通常 1-5 个工作日）
   - 收到邮件后获取 Consumer Key 和 Consumer Secret

2. **实现 OAuth 流程**：
   - 参考 [OAuth 认证文档](https://dev.yinxiang.com/doc/articles/authentication.php)
   - 使用印象笔记 Python SDK 的 OAuth 功能

> **注意**：当前 skill 只支持开发者令牌方式。如需使用 OAuth，需要修改 skill 代码实现完整的 OAuth 流程。

### 安装 Python 依赖

**首次使用前**安装 Python 依赖：

```bash
pip3 install evernote2 oauth2
```

## 凭证预检

每次调用 API 前，先确认凭证可用。如果环境变量未设置，停止操作并提示用户按 Setup 步骤配置。

```bash
if [ -z "$EVERNOTE_TOKEN" ]; then
  echo "缺少印象笔记凭证，请按 Setup 步骤配置环境变量 EVERNOTE_TOKEN"
  exit 1
fi

# 检查 Python 依赖
python3 -c "import evernote2" 2>/dev/null || {
  echo "缺少 Python 依赖，请运行: pip3 install evernote2 oauth2"
  exit 1
}
```

## Python 初始化模板

所有操作前都需要初始化 EvernoteClient：

```python
import sys
sys.path.insert(0, '/Users/I501579/Library/Python/3.9/lib/python/site-packages')

import os
from evernote2.api.client import EvernoteClient
import evernote2.edam.notestore.ttypes as NoteStoreTypes
import evernote2.edam.type.ttypes as Types

# 从环境变量读取配置
developer_token = os.environ.get('EVERNOTE_TOKEN')
service_host = os.environ.get('EVERNOTE_HOST', 'app.yinxiang.com')

# 连接印象笔记
client = EvernoteClient(token=developer_token, service_host=service_host)
note_store = client.get_note_store()
```

> **注意**：根据实际 Python 环境调整 `sys.path.insert` 的路径，可通过 `pip3 show evernote2` 查看 `Location`。

## 辅助函数

```python
import re

def enml_to_text(enml):
    """将 ENML 转换为纯文本"""
    text = re.sub(r'<!DOCTYPE[^>]+>', '', enml)
    text = re.sub(r'<\?xml[^>]+\?>', '', enml)
    text = re.sub(r'<[^>]+>', '\n', enml)
    text = re.sub(r'\n+', '\n', text)
    return text.strip()

def text_to_enml(text):
    """将纯文本转换为 ENML 格式"""
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    text = text.replace('\n', '<br/>')
    enml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>{text}</en-note>'''
    return enml
```

## 接口决策表

| 用户意图 | 调用 API | 关键参数 |
|---------|---------|---------|
| 搜索/查找笔记 | `findNotesMetadata()` | `NoteFilter.words` |
| 查看笔记本列表 | `listNotebooks()` | - |
| 浏览某笔记本里的笔记 | `findNotesMetadata()` | `NoteFilter.notebookGuid` |
| 读取笔记正文 | `getNoteContent()` | `note_guid` |
| 新建一篇笔记 | `createNote()` | `Note.title` + `Note.content`（ENML） |
| 往已有笔记追加内容 | `updateNote()` | 先 `getNote()` 获取，再 `updateNote()` 保存 |

## 常用工作流

### 查找并阅读笔记

先搜索获取 `note_guid`，再用 `getNoteContent()` 读取正文：

```python
# 1. 按标题搜索
filter = NoteStoreTypes.NoteFilter()
filter.words = 'intitle:"会议纪要"'
result = note_store.findNotesMetadata(developer_token, filter, 0, 20, 
                                     NoteStoreTypes.NotesMetadataResultSpec(includeTitle=True))

# 2. 读取正文
note_guid = result.notes[0].guid
content = note_store.getNoteContent(developer_token, note_guid)
text = enml_to_text(content)
```

### 浏览笔记本里的笔记

先拉笔记本列表获取 `notebookGuid`，再拉该笔记本下的笔记：

```python
# 1. 列出笔记本
notebooks = note_store.listNotebooks()

# 2. 拉取指定笔记本的笔记
filter = NoteStoreTypes.NoteFilter()
filter.notebookGuid = notebooks[0].guid  # 选择第一个笔记本
result = note_store.findNotesMetadata(developer_token, filter, 0, 20,
                                     NoteStoreTypes.NotesMetadataResultSpec(includeTitle=True))
```

### 新建笔记

```python
# 新建到默认位置
note = Types.Note()
note.title = "笔记标题"
note.content = text_to_enml("笔记内容")
created = note_store.createNote(developer_token, note)

# 新建到指定笔记本
note = Types.Note()
note.title = "笔记标题"
note.content = text_to_enml("笔记内容")
note.notebookGuid = "笔记本_GUID"
created = note_store.createNote(developer_token, note)
```

### 追加内容到已有笔记

```python
# 获取笔记
note = note_store.getNote(developer_token, note_guid, True, False, False, False)

# 追加内容
note.content = note.content + "<br/><br/>" + text_to_enml("追加的内容")
note_store.updateNote(developer_token, note)
```

### 按关键词全文搜索

```python
filter = NoteStoreTypes.NoteFilter()
filter.words = 'SuccessFactors'
result = note_store.findNotesMetadata(developer_token, filter, 0, 20,
                                     NoteStoreTypes.NotesMetadataResultSpec(includeTitle=True))
```

## 搜索语法

印象笔记支持丰富的搜索语法，可通过 `NoteFilter.words` 设置：

| 语法 | 说明 | 示例 |
|------|------|------|
| `关键词` | 全文搜索 | `SuccessFactors` |
| `intitle:关键词` | 标题包含 | `intitle:"项目管理"` |
| `-关键词` | 排除关键词 | `项目 -会议` |
| `关键词A OR 关键词B` | 或条件 | `SuccessFactors OR Workday` |
| `notebook:"笔记本名"` | 在指定笔记本 | `notebook:"工作"` |
| `created:yyyyMMdd` | 创建日期 | `created:20260301` |
| `updated:day-7` | 最近7天更新 | `updated:day-7` |
| `tag:标签名` | 包含标签 | `tag:重要` |

## 核心响应字段

**搜索结果**（`NoteMetadata`）：
- `guid`: 笔记 GUID
- `title`: 标题
- `updated`: 更新时间戳（毫秒）
- `notebookGuid`: 所属笔记本 GUID

**笔记本**（`Notebook`）：
- `guid`: 笔记本 GUID
- `name`: 名称
- `created`: 创建时间戳（毫秒）
- `defaultNotebook`: 是否为默认笔记本

完整字段定义见 `references/api.md`。

## 分页

**笔记搜索**（`findNotesMetadata`）：
- 首次：`offset: 0, maxNotes: 20`
- 翻页：递增 `offset`
- 建议每次最多获取 50 条，避免 API 频率限制

## 注意事项

- **API 频率限制**：印象笔记对 API 调用有频率限制，建议：
  - 搜索时限制返回数量（如 20-50 条）
  - 避免短时间内大量请求
  - 使用 `findNotesMetadata()` 进行元数据搜索，而非 `findNotes()`
- **开发者令牌安全**：开发者令牌可完全访问账户，请勿泄露
- **ENML 格式限制**：
  - 不支持所有 HTML 标签和属性
  - 媒体资源需单独处理
  - 嵌入的 HTML 标签会被清理
- **搜索限制**：搜索结果最多 1000 条，建议使用分页
- **UTF-8 编码**：笔记内容必须为 UTF-8 编码，从外部文件读取时需确保正确转码

> **隐私规则**：笔记内容属于用户隐私，在群聊场景中只展示标题和摘要，禁止展示笔记正文。

## 错误处理

| 错误类型 | 说明 | 建议处理 |
|---------|------|---------|
| `EDAMUserException` | 用户相关错误 | 检查令牌是否有效、权限是否足够 |
| `EDAMSystemException` | 系统错误 | 稍后重试 |
| `EDAMNotFoundException` | 资源不存在 | 检查 GUID 是否正确 |
| `EDAMDataConflictException` | 数据冲突 | 使用最新数据重试 |
| `EDAMPermissionDenied` | 权限不足 | 检查令牌权限 |

```python
from evernote2.edam.error.ttypes import EDAMUserException, EDAMSystemException

try:
    notebooks = note_store.listNotebooks()
except EDAMUserException as e:
    print(f"用户错误: {e}")
except EDAMSystemException as e:
    print(f"系统错误: {e}")
except Exception as e:
    print(f"其他错误: {e}")
```

## 参考资料

- 印象笔记开发者文档：https://dev.yinxiang.com/doc/
- ENML 规范：https://dev.yinxiang.com/doc/articles/enml.php
- 搜索语法：https://help.evernote.com/hc/zh-cn/articles/209005987
- Python SDK：https://github.com/yinxiang-dev/evernote-sdk-python
- evernote2 库：https://github.com/JackonYang/evernote2
