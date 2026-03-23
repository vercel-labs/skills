#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证印象笔记 skill 配置是否正确"""

import sys
import os

# 检查环境变量
print("=" * 60)
print("1. 检查环境变量")
print("=" * 60)

if not os.environ.get('EVERNOTE_TOKEN'):
    print("❌ 缺少 EVERNOTE_TOKEN 环境变量")
    print("\n请按以下步骤配置：")
    print("1. 访问 https://app.yinxiang.com/api/DeveloperToken.action 获取令牌")
    print("2. 运行以下命令配置环境变量：")
    print('   export EVERNOTE_TOKEN="your_token_here"')
    print("3. 将上述命令添加到 ~/.zshrc 使配置永久生效")
    sys.exit(1)

print(f"✅ EVERNOTE_TOKEN: {os.environ['EVERNOTE_TOKEN'][:20]}...")

service_host = os.environ.get('EVERNOTE_HOST', 'app.yinxiang.com')
print(f"✅ EVERNOTE_HOST: {service_host}")

# 检查 Python 依赖
print("\n" + "=" * 60)
print("2. 检查 Python 依赖")
print("=" * 60)

try:
    import evernote2
    print(f"✅ evernote2 版本: {evernote2.__version__}")
except ImportError:
    print("❌ 缺少 evernote2 依赖")
    print("\n请运行: pip3 install evernote2 oauth2")
    sys.exit(1)

try:
    import oauth2
    print("✅ oauth2 已安装")
except ImportError:
    print("❌ 缺少 oauth2 依赖")
    print("\n请运行: pip3 install oauth2")
    sys.exit(1)

# 测试连接
print("\n" + "=" * 60)
print("3. 测试印象笔记 API 连接")
print("=" * 60)

try:
    from evernote2.api.client import EvernoteClient
    import evernote2.edam.notestore.ttypes as NoteStoreTypes

    developer_token = os.environ['EVERNOTE_TOKEN']
    service_host = os.environ.get('EVERNOTE_HOST', 'app.yinxiang.com')

    print(f"\n正在连接到: {service_host}...")

    client = EvernoteClient(token=developer_token, service_host=service_host)
    note_store = client.get_note_store()

    notebooks = note_store.listNotebooks()

    print(f"\n✅ 连接成功！")
    print(f"   服务器: {service_host}")
    print(f"   笔记本数量: {len(notebooks)}")

    # 列出前 5 个笔记本
    print(f"\n前 5 个笔记本：")
    for i, nb in enumerate(notebooks[:5]):
        print(f"   {i+1}. {nb.name} ({len(nb.guid)} 笔记)")

    # 统计笔记总数
    print(f"\n正在统计笔记总数...")
    filter = NoteStoreTypes.NoteFilter()
    result = note_store.findNotesMetadata(
        developer_token, 
        filter, 
        0, 
        1, 
        NoteStoreTypes.NotesMetadataResultSpec()
    )
    print(f"   笔记总数: {result.totalNotes}")

    # 测试搜索
    print(f"\n正在测试搜索功能...")
    filter = NoteStoreTypes.NoteFilter()
    filter.words = 'intitle:"测试"'
    result = note_store.findNotesMetadata(
        developer_token,
        filter,
        0,
        5,
        NoteStoreTypes.NotesMetadataResultSpec(includeTitle=True)
    )
    print(f"   标题包含'测试'的笔记: {result.totalNotes} 条")

    print("\n" + "=" * 60)
    print("✅ 所有检查通过！配置正确，可以使用 skill 了。")
    print("=" * 60)

except Exception as e:
    print(f"\n❌ 连接失败: {e}")
    print("\n可能的原因：")
    print("1. 开发者令牌无效或已过期")
    print("2. 网络连接问题")
    print("3. EVERNOTE_HOST 配置错误（国内版用 app.yinxiang.com，国际版用 www.evernote.com）")
    sys.exit(1)
