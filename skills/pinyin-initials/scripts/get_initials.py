import pypinyin
import re
from typing import List

def get_pinyin_initials(text: str) -> str:
    """
    获取中文句子的拼音首字母。
    
    规则：
    - 只处理汉字字符，忽略其他所有字符（字母、数字、标点、空格等）
    - 返回大写拼音首字母字符串
    - 如果没有汉字，返回空字符串
    
    Args:
        text: 输入的字符串
    
    Returns:
        大写拼音首字母字符串
    
    Examples:
        >>> get_pinyin_initials("你好世界")
        'NHSJ'
        >>> get_pinyin_initials("中国")
        'ZG'
        >>> get_pinyin_initials("改变世界的壮举-登上月球")
        'GBSJDZJDSYQ'
    """
    # 使用正则表达式提取所有汉字
    chinese_chars: List[str] = re.findall(r'[\u4e00-\u9fa5]', text)
    
    # 如果没有汉字，返回空字符串
    if not chinese_chars:
        return ""
    
    # 获取每个汉字的拼音首字母
    initials: List[str] = pypinyin.lazy_pinyin(
        "".join(chinese_chars),
        style=pypinyin.Style.FIRST_LETTER
    )
    
    # 转换为大写并连接
    return "".join(initials).upper()

# 快速测试
if __name__ == "__main__":
    # 测试用例
    test_cases = [
        ("你好世界", "NHSJ"),
        ("中国", "ZG"),
        ("阿里巴巴", "ALBB"),
        ("武汉大学", "WHDX"),
        ("改变世界的壮举-登上月球", "GBSJDZJDSYQ"),
        ("Hello世界", "SJ"),
        ("123", ""),
        ("", ""),
    ]
    
    for text, expected in test_cases:
        result = get_pinyin_initials(text)
        status = "PASS" if result == expected else "FAIL"
        print(f"{status} {text!r} -> {result}")
