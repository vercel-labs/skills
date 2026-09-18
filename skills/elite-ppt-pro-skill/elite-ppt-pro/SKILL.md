---
name: elite-ppt-pro
description: >
  Elite consulting-style PPT generator — merges 7 color themes × 38 slide layouts
  with a McKinsey-grade data-first workflow. Forces research before design (≥15 data
  points, ≥5 sources), mandatory source citations on every data slide, max 2 accent
  colors per page, conclusion-as-title rule, and dual output (.pptx + HTML preview).
  Use for: consulting decks, strategy reports, investor presentations, market analysis,
  annual reviews, business frameworks (SWOT, KANO, STP, RFM, Porter, etc.).
  Trigger words: consulting PPT, McKinsey style PPTX, elite PPT, data-driven
  presentation, strategy deck, investor deck, 咨询PPT, 麦肯锡风格, 顶级咨询PPT.
---

# Elite PPT Pro — 顶级咨询PPT融合技能

> 融合 **consult-ppt-style**（多风格版式库）× **McKinsey Presentation Generator**（数据驱动工作流）的最佳实践

---

## 核心设计理念

| 维度 | 原则 |
|------|------|
| **数据优先** | 先研究收集15+数据点，再动手做PPT |
| **标题即结论** | 每页标题直接写结论，不写话题（"AI市场集中度正在提高" 而非 "市场分析"） |
| **信息密度最大** | 每页至少4个内容区域，数据+图表+分析并存 |
| **颜色克制** | 每页最多2个强调色；严格使用风格配色体系 |
| **来源标注** | 每个数据点必须有来源，页面底部统一引用 |
| **双输出** | PPTX（可编辑交付）+ HTML（高保真预览） |

---

## 工作流（必须按顺序执行）

### Step 1：研究阶段（绝不跳过）

**数据质量决定PPT质量。先收集，再设计。**

#### 必须收集的信息

```
1. 市场规模、CAGR、增速数据
2. 竞争对手份额与对比
3. 历史趋势数据（用于图表）
4. 关键指标与里程碑
5. 行业预测与展望
```

#### 数据来源优先级

| 级别 | 来源类型 | 示例 |
|------|----------|------|
| Tier 1 | 官方数据/政府发布 | 国家统计局、SEC、公司年报 |
| Tier 2 | 顶级研究机构 | 麦肯锡、BCG、高盛、摩根士丹利、IMF |
| Tier 3 | 行业报告 | Gartner、CB Insights、艾瑞咨询 |
| Tier 4 | 权威媒体 | Reuters、Bloomberg、财新 |
| Tier 5 | 公司官网 | 官方新闻稿、IR页面 |

#### 完成研究的最低标准

- [ ] ≥15个具体数据点（带数字）
- [ ] ≥5个不同来源
- [ ] 每张内容幻灯片均有对应数据
- [ ] 至少1组历史趋势数据（用于折线/柱状图）
- [ ] 竞争对比数据
- [ ] 所有引用标注来源名称和日期

#### 研究记录格式

```
## 研究摘要

### 主题：[主题名称]
研究日期：[当前日期]

---

### 第N页：[页面标题]

**关键数据：**
1. [数据点] - [数值/比率]  来源：[机构名] [日期]
2. ...

**图表数据（如适用）：**
| 年份 | 数值 | 同比增长 |
|------|------|---------|
| 2023 | $XX  | +XX%    |
| 2024 | $XX  | +XX%    |

**引用标注：** Source: [机构1], [机构2] | [时间段]

---

### 所有来源汇总
| # | 来源名 | 类型 | 日期 | 可靠性 |
|---|--------|------|------|--------|
| 1 | [名称] | 报告/新闻/官方 | [日期] | 高/中 |
```

---

### Step 2：策划幻灯片结构

基于研究结果规划页面：

**默认10页结构：**
1. 封面 Cover
2. 核心洞察摘要（3-4个结论）
3-8. 内容页（数据+图表+分析，每页对应一个核心观点）
9. 执行建议
10. 附录/数据来源

**典型页数：8-15页**

---

### Step 3：选择风格

根据场景选择合适风格（可跨风格混搭）：

| 风格 | 名称 | 主色 | 适用场景 |
|------|------|------|----------|
| **风格A** | 咨询青绿色 | `#00A69C` | 战略规划、市场分析、投资人汇报 |
| **风格B** | 职场汇报紫色 | `#7B5EA7` | 年度总结、工作汇报、团队复盘 |
| **风格C** | InsightX商业绿 | `#2D8A6A` | 商业框架、策略分析、产品管理 |
| **风格D** | 贝恩红 | `#C41E3A` | 消费者洞察、市场研究、代际分析 |
| **风格E** | 埃森哲蓝 | `#0369A1` | 数字化转型、战略布局、价值链 |
| **风格F** | 消费者橙 | `#E65100` | 消费者行为研究、行为经济学 |
| **风格G** | 数据科技蓝 | `#1A237E` | KPI仪表板、数据报告、增长分析 |
| **麦肯锡标准** | 深海军蓝 | `#0B1F3A` | 严肃正式汇报、监管报告 |

---

### Step 4：选择版式（38种）

详见 [slide-types.md](references/slide-types.md)

**数据驱动版式推荐：**

| 数据类型 | 推荐版式 |
|----------|----------|
| 市场增长趋势 | A5数据看板 / G3阶梯增长 |
| 竞争格局 | A3竞争矩阵 / C11波特三角 |
| 战略路径 | A2战略箭头 / A6流程步骤 |
| 用户分析 | C9客户旅程 / F1消费者旅程 / C7RFM |
| 业务框架 | C10商业画布 / C1SWOT |
| 市场细分 | C2安索夫矩阵 / C6STP |
| KPI汇报 | G1KPI仪表板 / B5增长箭头 |
| 时间规划 | C8甘特图 / A4时间里程碑 |

---

### Step 5：生成PPTX代码

使用 pptxgenjs 生成 `.pptx` 文件，规范见技术规范章节。

#### 每页代码结构模板

```javascript
function createSlide_N(pres, theme, data) {
  // data = 从研究阶段收集的实际数据对象
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  // 1. 顶部标题条（必须）
  addEliteHeader(slide, pres, "结论性标题，直接写出洞察", "Conclusion as Title");

  // 2. 内容区域（至少4个区域）
  // 区域1：关键指标/数字
  // 区域2：图表（柱状/折线/散点）
  // 区域3：分析要点（3-5条）
  // 区域4：背景/对比数据

  // 3. 数据来源引用（必须）
  addDataSource(slide, pres, "Source: [机构], [机构] | [时间段]");

  // 4. 页码徽章（非封面页必须）
  addPageBadge(slide, pres, N);

  return slide;
}
```

---

### Step 6：HTML预览版（可选但推荐）

在生成PPTX同时，生成对应HTML版本用于：
- 浏览器全屏演示（无需PPT软件）
- 在线分享链接
- 高保真效果预览

HTML版遵循麦肯锡设计规范：
- 白色背景强制（内容页）
- SVG图表（矢量，无失真）
- 数据来源标注在每页底部

---

### Step 7：QA检查

生成后必须执行以下检查，详见 [qa-checklist.md](references/qa-checklist.md)：

- [ ] 标题是结论，不是话题
- [ ] 每个数据点有来源标注
- [ ] 每页≥4个内容区域
- [ ] 全文最多2个强调色（图表多系列除外）
- [ ] 文字无截断（wrap: true）
- [ ] 布局不超出幻灯片边界

---

## 七大风格配色体系

### 风格A：咨询青绿色（麦肯锡/BCG风格）
```javascript
const themeA = {
  primary:   "1A1A2E",  // 深藏青
  secondary: "2D6A6A",  // 深青绿
  accent:    "00A69C",  // 亮青绿（主强调色）
  light:     "E8F7F6",  // 浅青绿
  bg:        "FFFFFF",
  darkText:  "333333",
  midText:   "666666",
  border:    "DDDDDD",
};
```

### 风格B：职场汇报紫色
```javascript
const themeB = {
  primary:   "4527A0",
  secondary: "7B5EA7",
  accent:    "9575CD",
  light:     "EDE7F6",
  bg:        "FAFAFA",
  darkText:  "1A1A1A",
  midText:   "666666",
  border:    "D1C4E9",
};
```

### 风格C：InsightX商业绿
```javascript
const themeC = {
  primary:   "1B5E4A",
  secondary: "2D8A6A",
  accent:    "4CAF50",
  light:     "E8F7F0",
  bg:        "FFFFFF",
  darkText:  "333333",
  midText:   "666666",
  border:    "CCEECC",
};
```

### 风格D：贝恩红（消费者洞察）
```javascript
const themeD = {
  primary:   "C41E3A",
  secondary: "E53935",
  accent:    "FFCDD2",
  light:     "FDEAEA",
  bg:        "FFFFFF",
  darkText:  "1A1A1A",
  midText:   "666666",
  border:    "EEEEEE",
};
```

### 风格E：埃森哲蓝（数字化转型）
```javascript
const themeE = {
  primary:   "0369A1",
  secondary: "0288D1",
  accent:    "E3F2FD",
  light:     "F5FAFF",
  bg:        "FFFFFF",
  darkText:  "1A1A1A",
  midText:   "666666",
  border:    "BBDEFB",
};
```

### 风格F：消费者橙
```javascript
const themeF = {
  primary:   "E65100",
  secondary: "FF9800",
  accent:    "FFF3E0",
  light:     "FFF8E1",
  bg:        "FFFFFF",
  darkText:  "333333",
  midText:   "666666",
  border:    "FFCC80",
};
```

### 风格G：数据科技蓝
```javascript
const themeG = {
  primary:   "1A237E",
  secondary: "3949AB",
  accent:    "C5CAE9",
  light:     "E8EAF6",
  bg:        "FFFFFF",
  darkText:  "212121",
  midText:   "666666",
  border:    "9FA8DA",
};
```

### 麦肯锡标准深海军蓝
```javascript
const themeMcK = {
  primary:   "0B1F3A",  // 深海军蓝
  secondary: "1B5AB5",  // 钴蓝
  accent:    "2E8BC0",  // 青蓝
  light:     "E8EEF7",
  bg:        "FFFFFF",
  darkText:  "2D2D2D",
  midText:   "8C8C8C",
  border:    "E0E0E0",
};
```

---

## 技术规范（pptxgenjs）

### 基础设置

```javascript
const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";  // 10 x 5.625 英寸
```

### 通用辅助函数

```javascript
// ─── 顶部标题条 ───────────────────────────────────────
function addEliteHeader(slide, pres, titleCN, titleEN = "", theme = themeA) {
  // 顶部底色条
  slide.addShape("rect", {
    x: 0, y: 0, w: 10, h: 0.55,
    fill: { color: "FFFFFF" },
    line: { color: theme.border, width: 0.5 }
  });
  // 左侧强调竖条
  slide.addShape("rect", {
    x: 0, y: 0, w: 0.06, h: 0.55,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  // 主标题（结论性语句）
  slide.addText(titleCN, {
    x: 0.15, y: 0.06, w: 8.3, h: 0.28,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, wrap: true
  });
  // 英文副标题（可选）
  if (titleEN) {
    slide.addText(titleEN, {
      x: 0.15, y: 0.32, w: 7, h: 0.18,
      fontSize: 7.5, fontFace: "Arial",
      color: theme.midText, wrap: true
    });
  }
  // 右上角来源标注区
  slide.addText("Elite PPT Pro", {
    x: 8.5, y: 0.08, w: 1.4, h: 0.35,
    fontSize: 6, fontFace: "Arial",
    color: theme.midText, align: "right"
  });
}

// ─── 数据来源引用（页面底部）────────────────────────────
function addDataSource(slide, pres, sourceText, theme = themeA) {
  slide.addShape("line", {
    x: 0.2, y: 5.38, w: 9.6, h: 0,
    line: { color: theme.border, width: 0.5 }
  });
  slide.addText("Source: " + sourceText, {
    x: 0.2, y: 5.42, w: 8.5, h: 0.15,
    fontSize: 7.5, fontFace: "Arial",
    color: theme.midText, wrap: false
  });
}

// ─── 页码徽章 ─────────────────────────────────────────
function addPageBadge(slide, pres, pageNum, theme = themeA) {
  slide.addShape("rect", {
    x: 9.55, y: 5.2, w: 0.35, h: 0.25,
    fill: { color: theme.accent }, line: { color: theme.accent }
  });
  slide.addText(String(pageNum).padStart(2, "0"), {
    x: 9.55, y: 5.2, w: 0.35, h: 0.25,
    fontSize: 9, fontFace: "Arial",
    color: "FFFFFF", bold: true,
    align: "center", valign: "middle"
  });
}

// ─── 关键指标卡片 ─────────────────────────────────────
function addKPICard(slide, x, y, w, h, value, label, delta, theme = themeA) {
  // 卡片底色
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: theme.light }, line: { color: theme.border, width: 1 }
  });
  // 大数字
  slide.addText(value, {
    x: x + 0.1, y: y + 0.12, w: w - 0.2, h: 0.45,
    fontSize: 28, fontFace: "Arial", bold: true,
    color: theme.accent, align: "center"
  });
  // 指标标签
  slide.addText(label, {
    x: x + 0.1, y: y + 0.6, w: w - 0.2, h: 0.22,
    fontSize: 9, fontFace: "Microsoft YaHei",
    color: theme.darkText, align: "center", wrap: true
  });
  // 变化率（可选）
  if (delta) {
    const isPositive = delta.startsWith("+");
    slide.addText(delta, {
      x: x + 0.1, y: y + 0.82, w: w - 0.2, h: 0.18,
      fontSize: 9, fontFace: "Arial",
      color: isPositive ? "2D8A6A" : "C41E3A",
      align: "center", bold: true
    });
  }
}

// ─── 分析要点列表 ─────────────────────────────────────
function addBulletPoints(slide, x, y, w, h, title, points, theme = themeA) {
  // 标题
  slide.addText(title, {
    x, y, w, h: 0.28,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true
  });
  // 要点
  const bulletText = points.map(p => "▸ " + p).join("\n");
  slide.addText(bulletText, {
    x, y: y + 0.32, w, h: h - 0.32,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.darkText, wrap: true, valign: "top",
    lineSpacingMultiple: 1.4
  });
}

// ─── 数据卡片（带来源）───────────────────────────────
function addDataCard(slide, x, y, w, h, title, content, source, borderColor, theme = themeA) {
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: "F8F9FA" }, line: { color: borderColor, width: 1.5 }
  });
  // 顶部色条
  slide.addShape("rect", {
    x, y, w, h: 0.06,
    fill: { color: borderColor }, line: { color: borderColor }
  });
  slide.addText(title, {
    x: x + 0.12, y: y + 0.1, w: w - 0.24, h: 0.26,
    fontSize: 11, fontFace: "Microsoft YaHei",
    color: borderColor, bold: true
  });
  slide.addText(content, {
    x: x + 0.12, y: y + 0.42, w: w - 0.24, h: h - 0.58,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.darkText, wrap: true, valign: "top"
  });
  if (source) {
    slide.addText(source, {
      x: x + 0.12, y: y + h - 0.2, w: w - 0.24, h: 0.16,
      fontSize: 7, fontFace: "Arial",
      color: theme.midText, wrap: false
    });
  }
}
```

### 文字换行规则（关键！）

```javascript
// ❌ 错误：文字会重叠
slide.addText('第一行\n第二行', { x:0.5, y:1, w:4, h:1 });

// ✅ 正确：必须加 wrap: true
slide.addText('第一行\n第二行', {
  x: 0.5, y: 1, w: 4, h: 1,
  wrap: true,    // 关键！
  valign: "top"
});
```

### 颜色规范

```javascript
// ✅ 正确：6字符hex，无#前缀
color: "00A69C"

// ❌ 错误
color: "#00A69C"   // 带#
color: "00A69C33"  // 带透明度（pptxgenjs不支持）
```

### 形状类型（字符串形式）

```javascript
// ✅ 使用字符串
slide.addShape("rect", { ... })
slide.addShape("oval", { ... })
slide.addShape("line", { ... })
slide.addShape("roundRect", { ... })

// ❌ 不要用 pres.ShapeType.xxx（可能不存在）
```

### 保存文件

```javascript
pres.writeFile({ fileName: "output.pptx" })
    .then(() => console.log("✅ 生成成功！"))
    .catch(err => console.error("❌ 错误：", err));
```

---

## 设计规范（强制）

### 必须遵守

| 规范 | 要求 |
|------|------|
| **每页强调色** | 最多2种（多系列图表除外） |
| **标题写法** | 结论性陈述，不写话题标题 |
| **内容区域** | 每页至少4个区域 |
| **数据来源** | 每个含数据的页面必须有来源注释 |
| **字体** | 中文 Microsoft YaHei，英文 Arial |
| **背景** | 内容页强制白色（`FFFFFF`） |
| **边框** | 卡片边框 ≥ 1px，颜色来自主题 |

### 明确禁止

| 禁止项 | 替代方案 |
|--------|----------|
| 颜色带 `#` 前缀 | 直接写6字符hex |
| 无来源的数据声明 | 标注来源机构+日期 |
| 文字超出框体被截断 | 增大h值 + wrap:true |
| 元素超出幻灯片边界 | x+w ≤ 10，y+h ≤ 5.625 |
| 标题写话题而非结论 | 改为"数据显示XX领先" |
| 单页超过2个强调色 | 合并为主题色 |
| 空洞的定性描述 | 替换为具体数字 |

---

## 版式库（38种）

详见 [slide-types.md](references/slide-types.md)

---

## 快速开始示例

```javascript
const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";

const theme = { /* 选择上面任一风格配色 */ ...themeA };

// 封面页
const cover = pres.addSlide();
cover.background = { color: theme.primary };
cover.addText("AI行业竞争格局深度分析", {
  x: 1, y: 1.6, w: 8, h: 1.2,
  fontSize: 40, fontFace: "Microsoft YaHei",
  color: "FFFFFF", bold: true, align: "center", wrap: true
});
cover.addText("全球AI市场规模2026年预计突破5000亿美元，竞争进入决战期", {
  x: 1.5, y: 3.0, w: 7, h: 0.5,
  fontSize: 14, fontFace: "Microsoft YaHei",
  color: theme.accent, align: "center", wrap: true
});
cover.addText("Source: Gartner, IDC, Goldman Sachs | 2025", {
  x: 3, y: 5.1, w: 4, h: 0.3,
  fontSize: 9, fontFace: "Arial",
  color: "FFFFFF88", align: "center"  // 注意：封面可用透明色
});

// 内容页（使用辅助函数）
const s1 = pres.addSlide();
s1.background = { color: "FFFFFF" };
addEliteHeader(s1, pres,
  "头部三家公司市占率合计超过65%，AI行业马太效应持续强化",
  "Top-3 Players control 65%+ market share", theme);

// KPI区域（4个指标卡片）
const kpis = [
  { v: "$847B", l: "全球AI市场规模", d: "+38% YoY" },
  { v: "65%",   l: "头部3家市占率", d: "+8pp YoY" },
  { v: "$2.1T", l: "2030年预测规模", d: "CAGR 42%" },
  { v: "1,240", l: "AI独角兽数量",   d: "+340 新增" }
];
kpis.forEach((k, i) => {
  addKPICard(s1, 0.25 + i * 2.38, 0.65, 2.2, 1.15, k.v, k.l, k.d, theme);
});

// 分析要点
addBulletPoints(s1, 0.25, 1.95, 5.5, 1.8, "核心洞察", [
  "OpenAI、Google、Anthropic三家占据基础模型市场2/3份额",
  "2025年AI投资同比增长180%，资金向头部集中趋势明显",
  "开源模型崛起：Llama生态年下载量超过10亿次",
  "企业级AI应用渗透率从12%升至34%，B端需求爆发"
], theme);

addDataSource(s1, pres, "Goldman Sachs AI Report, IDC Market Forecast | Q4 2025", theme);
addPageBadge(s1, pres, 2, theme);

pres.writeFile({ fileName: "ai-industry-analysis.pptx" })
    .then(() => console.log("✅ 生成完成！"));
```
