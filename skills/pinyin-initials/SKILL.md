---
name: pinyin-initials
description: "获取中文句子的拼音首字母，忽略非汉字字符。当用户需要将中文文本转换为拼音首字母缩写时使用。"
---

# Pinyin Initials

## 概述
此技能用于将中文句子转换为拼音首字母缩写。只处理汉字字符，自动忽略字母、数字、标点、空格等非汉字字符。

## 使用场景
当用户请求以下操作时激活此技能：
- 获取中文句子的拼音首字母
- 将中文文本转换为拼音首字母缩写
- 生成中文标题或名称的首字母缩写
- 需要忽略非汉字字符的拼音首字母提取

## 核心规则
1. **只处理汉字**：使用正则表达式 `[\u4e00-\u9fa5]` 提取所有汉字字符
2. **忽略非汉字**：自动跳过所有非汉字字符（字母、数字、标点、空格、连字符等）
3. **拼音首字母**：使用 `pypinyin` 库的 `lazy_pinyin` 函数，设置 `style=pypinyin.Style.FIRST_LETTER`
4. **大写输出**：返回大写的拼音首字母字符串
5. **空输入处理**：如果没有汉字，返回空字符串

## 示例
```
输入: "你好世界" -> 输出: "NHSJ"
输入: "中国" -> 输出: "ZG"
输入: "阿里巴巴" -> 输出: "ALBB"
输入: "武汉大学" -> 输出: "WHDX"
输入: "改变世界的壮举-登上月球" -> 输出: "GBSJDZJDSYQ"
输入: "Hello世界" -> 输出: "SJ"
输入: "123" -> 输出: ""
```

## 实现方式
使用 Python 的 `pypinyin` 库实现。核心函数为 `get_pinyin_initials(text: str) -> str`。

### 快速使用
```python
from scripts.get_initials import get_pinyin_initials

result = get_pinyin_initials("你好世界")
print(result)  # 输出: NHSJ
```

### 脚本使用
可以使用提供的脚本文件 `scripts/get_initials.py`，该文件包含完整的实现和测试用例。

运行测试：
```bash
python scripts/get_initials.py
```

## 注意事项
- 需要安装 `pypinyin` 库：`pip install pypinyin`
- 仅处理汉字字符，不处理其他语言的字符
- 返回的字符串为大写拼音首字母


