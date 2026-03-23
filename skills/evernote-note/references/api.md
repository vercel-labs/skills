# 印象笔记 API 参考

## 基础信息

| 项目 | 值 |
|------|-----|
| API 端点 | `https://app.yinxiang.com/shard/{shardId}/notestore` |
| 协议 | Thrift RPC |
| 认证方式 | 开发者令牌（Developer Token）或 OAuth 1.0a |
| 内容格式 | ENML（Evernote Markup Language） |

## 核心数据类型

### Note（笔记）

```python
class Note:
    guid: str           # 笔记 GUID
    title: str          # 标题
    content: str        # ENML 格式内容
    created: int        # 创建时间戳（毫秒）
    updated: int        # 更新时间戳（毫秒）
    notebookGuid: str   # 所属笔记本 GUID
    tagGuids: list      # 标签 GUID 列表
    attributes: dict    # 其他属性
```

### Notebook（笔记本）

```python
class Notebook:
    guid: str           # 笔记本 GUID
    name: str          # 名称
    created: int       # 创建时间戳（毫秒）
    updated: int       # 更新时间戳（毫秒）
    defaultNotebook: bool  # 是否为默认笔记本
```

### NoteFilter（搜索过滤器）

```python
class NoteFilter:
    order: NoteSortOrder  # 排序方式
    ascending: bool       # 是否升序
    words: str           # 搜索词（支持搜索语法）
    notebookGuid: str    # 限制在指定笔记本
    tagGuids: list       # 限制在指定标签
    startTime: int       # 起始时间戳（毫秒）
    endTime: int         # 结束时间戳（毫秒）
```

## 主要 API 方法

### 1. 列出笔记本

```python
note_store.listNotebooks() -> List[Notebook]
```

**返回**：所有笔记本的列表

**示例**：
```python
notebooks = note_store.listNotebooks()
for nb in notebooks:
    print(f"{nb.name} ({nb.guid})")
```

---

### 2. 搜索笔记（元数据）

```python
note_store.findNotesMetadata(
    authenticationToken,
    filter: NoteFilter,
    offset: int,
    maxNotes: int,
    resultSpec: NotesMetadataResultSpec
) -> NoteMetadataList
```

**参数**：
- `authenticationToken`: 开发者令牌或 OAuth token
- `filter`: 搜索条件过滤器
- `offset`: 偏移量（分页用）
- `maxNotes`: 最大返回数量（建议 <= 100）
- `resultSpec`: 指定返回哪些元数据字段

**返回**：`NoteMetadataList`
```python
{
    notes: List[NoteMetadata],
    startIndex: int,
    totalNotes: int,
    stoppedWords: List[str],
    searchedWords: List[str]
}
```

**示例**：
```python
from evernote2.edam.notestore.ttypes import NoteFilter, NotesMetadataResultSpec

filter = NoteFilter()
filter.words = 'intitle:"项目管理"'
filter.order = NoteSortOrder.UPDATED
filter.ascending = False

result_spec = NotesMetadataResultSpec(includeTitle=True, includeUpdated=True)

result = note_store.findNotesMetadata(token, filter, 0, 20, result_spec)
print(f"找到 {result.totalNotes} 条笔记")

for note in result.notes:
    print(f"- {note.title}")
```

---

### 3. 获取笔记内容

```python
note_store.getNoteContent(
    authenticationToken,
    guid: str
) -> str
```

**参数**：
- `authenticationToken`: 认证令牌
- `guid`: 笔记 GUID

**返回**：ENML 格式的字符串

**示例**：
```python
content = note_store.getNoteContent(token, note_guid)
print(content)
```

**返回示例**：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>
<div>这是笔记内容</div>
<br/>
<div>第二段</div>
</en-note>
```

---

### 4. 获取笔记完整信息

```python
note_store.getNote(
    authenticationToken,
    guid: str,
    withContent: bool,
    withResourcesData: bool,
    withResourcesRecognition: bool,
    withResourcesAlternateData: bool
) -> Note
```

**参数**：
- `withContent`: 是否包含 ENML 内容
- `withResourcesData`: 是否包含资源数据
- `withResourcesRecognition`: 是否包含资源识别数据
- `withResourcesAlternateData`: 是否包含资源备份数据

**示例**：
```python
note = note_store.getNote(token, note_guid, True, False, False, False)
print(f"标题: {note.title}")
print(f"内容: {note.content}")
```

---

### 5. 创建笔记

```python
note_store.createNote(
    authenticationToken,
    note: Note
) -> Note
```

**参数**：
- `note`: 笔记对象（必须包含 title 和 content）

**返回**：创建后的笔记对象（包含生成的 guid）

**示例**：
```python
from evernote2.edam.type.ttypes import Note

note = Note()
note.title = "新笔记"
note.content = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>笔记内容</en-note>'

created = note_store.createNote(token, note)
print(f"创建成功，GUID: {created.guid}")
```

---

### 6. 更新笔记

```python
note_store.updateNote(
    authenticationToken,
    note: Note
) -> Note
```

**参数**：
- `note`: 笔记对象（必须包含 guid）

**返回**：更新后的笔记对象

**示例**：
```python
# 先获取笔记
note = note_store.getNote(token, note_guid, True, False, False, False)

# 修改内容
note.content = note.content + '<br/><br/>追加的新内容'

# 更新
updated = note_store.updateNote(token, note)
print("更新成功")
```

---

### 7. 删除笔记

```python
note_store.deleteNote(
    authenticationToken,
    guid: str
) -> int
```

**参数**：
- `guid`: 笔记 GUID

**返回**：更新序号

**示例**：
```python
usn = note_store.deleteNote(token, note_guid)
print("删除成功")
```

---

### 8. 获取笔记本

```python
note_store.getNotebook(
    authenticationToken,
    guid: str
) -> Notebook
```

**示例**：
```python
notebook = note_store.getNotebook(token, notebook_guid)
print(f"笔记本名称: {notebook.name}")
```

---

### 9. 创建笔记本

```python
note_store.createNotebook(
    authenticationToken,
    notebook: Notebook
) -> Notebook
```

**示例**：
```python
from evernote2.edam.type.ttypes import Notebook

notebook = Notebook()
notebook.name = "新笔记本"

created = note_store.createNotebook(token, notebook)
print(f"创建成功，GUID: {created.guid}")
```

---

## 搜索语法

印象笔记支持强大的搜索语法，可通过 `NoteFilter.words` 设置：

### 基本搜索

| 语法 | 说明 | 示例 |
|------|------|------|
| `关键词` | 全文搜索 | `SuccessFactors` |
| `"短语"` | 精确匹配 | `"人工成本管理"` |
| `-关键词` | 排除关键词 | `项目 -会议` |
| `关键词A OR 关键词B` | 或条件 | `SuccessFactors OR Workday` |
| `关键词A AND 关键词B` | 且条件（默认） | `人力 AND 系统` |

### 字段搜索

| 语法 | 说明 | 示例 |
|------|------|------|
| `intitle:关键词` | 标题包含 | `intitle:"项目管理"` |
| `tag:标签名` | 包含标签 | `tag:重要` |
| `notebook:"笔记本名"` | 在指定笔记本 | `notebook:"工作"` |
| `created:yyyyMMdd` | 创建日期 | `created:20260301` |
| `updated:yyyyMMdd` | 更新日期 | `updated:20260301` |
| `resource:*/*` | 包含附件 | `resource:application/*` |

### 特殊类型

| 语法 | 说明 | 示例 |
|------|------|------|
| `todo:true` | 待办事项 | `todo:true` |
| `todo:false` | 已完成待办 | `todo:false` |
| `todo:*` | 所有待办 | `todo:*` |
| `source:web.clip` | 网页剪藏 | `source:web.clip` |
| `source:mail.smtp` | 邮件 | `source:mail.smtp` |
| `source:mobile.*` | 移动端 | `source:mobile.*` |

### 日期格式

| 格式 | 说明 | 示例 |
|------|------|------|
| `yyyyMMdd` | 具体日期 | `20260301` |
| `yyyyMMddTHHmmss` | 具体时间 | `20260301T143000` |
| `day-数字` | 最近N天 | `day-7`（最近7天） |
| `day+数字` | N天前 | `day+7`（7天前） |
| `week-数字` | 最近N周 | `week-4` |
| `month-数字` | 最近N月 | `month-6` |

### 组合搜索

可以组合多个条件：

```python
# 标题包含"项目"，并且最近7天更新
filter.words = 'intitle:"项目" updated:day-7'

# 在"工作"笔记本中，包含"SuccessFactors"或"Workday"
filter.words = 'notebook:"工作" (SuccessFactors OR Workday)'

# 不包含"会议"，包含"计划"
filter.words = '-会议 计划'
```

---

## 排序方式

`NoteFilter.order` 可选值：

```python
from evernote2.edam.type.ttypes import NoteSortOrder

NoteSortOrder.CREATED    # 按创建时间
NoteSortOrder.UPDATED    # 按更新时间
NoteSortOrder.TITLE      # 按标题
NoteSortOrder.RELEVANCE  # 按相关性（搜索时）
NoteSortOrder.UPDATE_SEQUENCE_NUMBER  # 按更新序号
```

---

## ENML 格式规范

### 基本结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>
  <!-- 内容 -->
</en-note>
```

### 支持的 HTML 标签

| 标签 | 说明 |
|------|------|
| `div`, `span`, `p` | 容器 |
| `h1` - `h6` | 标题 |
| `ul`, `ol`, `li` | 列表 |
| `b`, `strong` | 加粗 |
| `i`, `em` | 斜体 |
| `u` | 下划线 |
| `strike`, `s` | 删除线 |
| `sup`, `sub` | 上标、下标 |
| `br`, `hr` | 换行、分隔线 |
| `table`, `tr`, `td`, `th` | 表格 |
| `blockquote` | 引用 |
| `a` | 链接（必须有 href） |

### 特殊 ENML 标签

| 标签 | 说明 |
|------|------|
| `en-todo` | 待办事项：`<en-todo checked="true/false"/>` |
| `en-media` | 媒体资源：`<en-media type="image/png" hash="abc123"/>` |
| `en-crypt` | 加密文本 |
| `en-note` | 根元素 |

### 支持的样式属性

| 属性 | 值 |
|------|-----|
| `color` | 颜色（十六进制或名称） |
| `background-color` | 背景色 |
| `font-family` | 字体 |
| `font-size` | 字号 |
| `font-style` | normal/italic |
| `font-weight` | normal/bold |
| `text-decoration` | none/underline/line-through |

### 不支持的元素

- `<script>`
- `<iframe>`
- `<style>`
- `<form>`
- `<input>`, `<button>`
- SVG（大部分）
- JavaScript 事件（onclick 等）

---

## 错误处理

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `EDAM_USER_EXCEPTION` | 用户相关错误 | 检查令牌是否有效 |
| `EDAM_SYSTEM_EXCEPTION` | 系统错误 | 稍后重试 |
| `EDAM_NOT_FOUND_EXCEPTION` | 资源不存在 | 检查 GUID 是否正确 |
| `EDAM_DATA_CONFLICT_EXCEPTION` | 数据冲突 | 使用最新数据重试 |
| `EDAM_PERMISSION_DENIED` | 权限不足 | 检查令牌权限 |

### Python 异常处理

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

---

## 工具函数

### ENML 转纯文本

```python
import re

def enml_to_text(enml):
    """去除 ENML 标签，提取纯文本"""
    # 移除 XML 声明和 DOCTYPE
    text = re.sub(r'<!DOCTYPE[^>]+>', '', enml)
    text = re.sub(r'<\?xml[^>]+\?>', '', text)
    
    # 将标签替换为换行
    text = re.sub(r'<[^>]+>', '\n', text)
    
    # 合并多个换行
    text = re.sub(r'\n+', '\n', text)
    
    # 清理首尾空白
    return text.strip()
```

### 纯文本转 ENML

```python
def text_to_enml(text):
    """将纯文本转换为 ENML 格式"""
    # 转义 HTML 特殊字符
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    
    # 将换行转换为 <br/>
    text = text.replace('\n', '<br/>')
    
    # 封装 ENML 结构
    enml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>{text}</en-note>'''
    
    return enml
```

### Markdown 转 ENML

```python
import re

def markdown_to_enml(markdown):
    """将 Markdown 转换为 ENML"""
    html = markdown
    
    # 标题
    html = re.sub(r'^### (.+)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.+)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^# (.+)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    
    # 加粗
    html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html)
    
    # 斜体
    html = re.sub(r'\*(.+?)\*', r'<em>\1</em>', html)
    
    # 列表
    html = re.sub(r'^- (.+)$', r'<li>\1</li>', html, flags=re.MULTILINE)
    html = re.sub(r'(<li>.*?</li>\n)+', r'<ul>\g<0></ul>', html)
    
    # 换行
    html = html.replace('\n', '<br/>')
    
    # 封装 ENML
    enml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>{html}</en-note>'''
    
    return enml
```

---

## 参考资料

- 印象笔记官方文档：https://dev.yinxiang.com/doc/
- EDAM API 参考：https://dev.yinxiang.com/doc/reference/
- ENML 规范：https://dev.yinxiang.com/doc/articles/enml.php
- Python SDK GitHub：https://github.com/yinxiang-dev/evernote-sdk-python
- evernote2 库：https://github.com/JackonYang/evernote2
