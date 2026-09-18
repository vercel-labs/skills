# 咨询风PPT — 幻灯片版式参考库

## 目录

### 🎨 风格A：咨询青绿色（世达ppt/麦肯锡风格）
- [A1. 封面页 Cover](#a1-封面页-cover)
- [A2. 战略箭头页 Strategy Arrow](#a2-战略箭头页-strategy-arrow)
- [A3. 竞争矩阵页 Competitive Matrix](#a3-竞争矩阵页-competitive-matrix)
- [A4. 时间里程碑页 Timeline](#a4-时间里程碑页-timeline)
- [A5. 数据看板页 Dashboard](#a5-数据看板页-dashboard)
- [A6. 流程步骤页 Process Steps](#a6-流程步骤页-process-steps)
- [A7. 浪潮演进页 Wave Evolution](#a7-浪潮演进页-wave-evolution)

### 🟣 风格B：职场汇报紫色风（鱼丸PPT风格）
- [B1. Before/After改善对比页](#b1-beforeafter改善对比页)
- [B2. 团队成员角色标签页](#b2-团队成员角色标签页)
- [B3. 业绩复盘六面体页](#b3-业绩复盘六面体页)
- [B4. 圆环工作规划页（放射状）](#b4-圆环工作规划页放射状)
- [B5. 增长箭头业绩看板页](#b5-增长箭头业绩看板页)

### 🟢 风格C：InsightX 商业模型白底绿色（BerryPPT/InsightX100风格）
- [C1. SWOT分析四象限](#c1-swot分析四象限)
- [C2. 安索夫矩阵 Ansoff Matrix](#c2-安索夫矩阵-ansoff-matrix)
- [C3. 帕累托漏斗 Pareto Model](#c3-帕累托漏斗-pareto-model)
- [C4. 跨域鸿沟曲线 Chasm Model](#c4-跨域鸿沟曲线-chasm-model)
- [C5. KANO模型坐标图](#c5-kano模型坐标图)
- [C6. STP营销模型圆环图](#c6-stp营销模型圆环图)
- [C7. RFM客户价值三维图](#c7-rfm客户价值三维图)
- [C8. 甘特图项目计划](#c8-甘特图项目计划)
- [C9. 客户旅程地图](#c9-客户旅程地图)
- [C10. 商业模式画布](#c10-商业模式画布)
- [C11. 波特三角策略模型](#c11-波特三角策略模型)
- [C12. 四象限决策优先级](#c12-四象限决策优先级)

---

# 风格A：咨询青绿色

> 主色 `#00A69C`，白底，高信息密度，麦肯锡/BCG风格

## A1. 封面页 Cover

**特征**：大标题居中/左对齐，副标题小字，右下角品牌，背景白色或浅灰

```javascript
function createCoverSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: "F8F8F8" };

  // 左侧色块装饰条
  slide.addShape("rect", {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: "00A69C" }, line: { color: "00A69C" }
  });

  // 主标题
  slide.addText("战略规划报告\n2025", {
    x: 0.5, y: 1.8, w: 6, h: 1.8,
    fontSize: 42, fontFace: "Microsoft YaHei",
    color: "1A1A2E", bold: true, lineSpacingMultiple: 1.2
  });

  // 副标题
  slide.addText("以数字化为核心，创造独特价值并成为社会创新业务的全球领导者", {
    x: 0.5, y: 3.7, w: 7, h: 0.6,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: "00A69C", bold: false
  });

  // 右下角公司/日期信息
  slide.addText("2025 Q1 战略汇报", {
    x: 6.5, y: 5.1, w: 3.3, h: 0.35,
    fontSize: 10, fontFace: "Arial",
    color: "999999", align: "right"
  });

  return slide;
}
```

---

## A2. 战略箭头页 Strategy Arrow

**特征**：大渐变箭头从左到右，上方标注阶段，表示战略演进路径

```javascript
function createStrategyArrowSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  addConsultHeader(slide, pres,
    "Strategic priorities: Capture short-term potential and ensure market leadership beyond 2025"
  );

  // 时间轴分割线（虚线）
  const timelineY = 3.2;
  slide.addShape("line", {
    x: 0.5, y: timelineY, w: 9, h: 0,
    line: { color: "CCCCCC", width: 0.5, dashType: "dash" }
  });

  // 三个阶段标签
  const stages = ["2017-19\nReinforcing", "Mid-term\nUpgrading", "Mid-term and beyond\nNew growth"];
  const xPos = [0.6, 3.8, 7.0];
  stages.forEach((s, i) => {
    slide.addText(s, {
      x: xPos[i], y: 0.65, w: 2.5, h: 0.6,
      fontSize: 10, fontFace: "Arial",
      color: i === 2 ? "00A69C" : "333333",
      bold: i === 2, align: i === 0 ? "left" : "center"
    });
  });

  // 主渐变箭头
  slide.addShape("rect", {
    x: 0.5, y: 2.3, w: 8.8, h: 0.7,
    fill: { type: "gradient", color: "B2E0DF",
      stops: [{ position: 0, color: "C8E8E7" }, { position: 100, color: "00A69C" }]
    },
    line: { color: "00A69C", width: 0.5 }
  });

  // 阶段内容块（战略举措）
  const initiatives = [
    { label: "Drive profitable growth\nin core business", x: 0.6, y: 3.4 },
    { label: "Tap into adjacent\ngrowth markets", x: 3.5, y: 3.4 },
    { label: '"Market leadership 2025"', x: 7.0, y: 3.4 }
  ];
  initiatives.forEach(item => {
    slide.addText(item.label, {
      x: item.x, y: item.y, w: 2.5, h: 0.5,
      fontSize: 8.5, fontFace: "Arial",
      color: "555555"
    });
  });

  addPageBadge(slide, pres, 2);
  return slide;
}
```

---

## A3. 竞争矩阵页 Competitive Matrix

**特征**：左侧气泡竞争图 + 右侧文字分析框，Y轴=价格/质量，X轴=服务方式

（参见原 references/slide-types.md 完整代码）

---

## A4. 时间里程碑页 Timeline

**特征**：横向时间轴，关键节点圆形标记，上下交错注释文字，主箭头为渐变青绿色

（参见原 references/slide-types.md 完整代码）

---

## A5. 数据看板页 Dashboard

**特征**：KPI数字大卡片 + 图表（饼图/柱状图/折线图）组合，绿色/青绿色配色

（参见原 references/slide-types.md 完整代码）

---

## A6. 流程步骤页 Process Steps

**特征**：圆形图标 + 步骤编号 + 蛇形/S型排列，奇数行从左到右，偶数行从右到左

（参见原 references/slide-types.md 完整代码）

---

## A7. 浪潮演进页 Wave Evolution

**特征**：X轴=时间轴，两条曲线交叉（责任进度 vs 品牌采纳），下方分4个阶段三角形

（参见原 references/slide-types.md 完整代码）

---

# 风格B：职场汇报紫色风（鱼丸PPT）

> 主色 `#7B5EA7`（中紫色）或 `#6A4CAF`，辅助浅紫 `#B39DDB`，白底带圆角卡片，适合年度汇报、工作总结、业绩复盘场景。
> 特征：圆角卡片、渐变紫色色块、小人物插图装饰、表情符号辅助视觉

## B1. Before/After 改善对比页

**视觉特征**：左侧橙红 ✗ 区域（问题），右侧紫色/青色 ✓ 区域（改善），中间大箭头穿插，上下呼应

```javascript
function createBeforeAfterSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FAFAFA" };

  // 页面顶部标题条
  slide.addShape("rect", {
    x: 0, y: 0, w: 10, h: 0.55,
    fill: { color: "FFFFFF" }, line: { color: "E0E0E0", width: 0.4 }
  });
  slide.addText("工作问题改善前后对比", {
    x: 0.2, y: 0.1, w: 8, h: 0.35,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: "1A1A1A", bold: true
  });

  // "改善前"标题块（左侧，橙红色）
  slide.addShape("rect", {
    x: 0.2, y: 0.7, w: 4.4, h: 0.45,
    fill: { color: "E53935" }, line: { color: "E53935" }
  });
  slide.addText("✗  改善前   痛点·电机装配质量瓶颈", {
    x: 0.2, y: 0.7, w: 4.4, h: 0.45,
    fontSize: 12, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, valign: "middle"
  });

  // 三个问题框（左侧竖排）
  const problems = [
    { num: "01", title: "尺寸精密度不足", desc: "电机端盖装配间隙合格率仅82%，月均超差返工152台，关键定位夹具磨损导致基准偏差0.3mm，尺寸CPK值仅0.89" },
    { num: "02", title: "整体效率低下", desc: "人工检测效率低：单件检测耗时约70秒/分钟，日均损失7个工时。工序拖接不顺畅，装配线与检测站面面消耗，物料转移耗时占总工时的18%。单座产能要损失约550台" },
    { num: "03", title: "数据问题缺失", desc: "标准未量化，无组可作的闭环质量追踪制度追溯链条断裂，不良品无法关联具体工位，问题定位24小时" }
  ];
  problems.forEach((p, i) => {
    const y = 1.25 + i * 1.0;
    slide.addShape("rect", {
      x: 0.2, y, w: 4.4, h: 0.88,
      fill: { color: "FFF8F8" }, line: { color: "FFCCCC", width: 0.5 }
    });
    slide.addText(p.num + ". " + p.title, {
      x: 0.35, y: y + 0.05, w: 4.1, h: 0.25,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: "C62828", bold: true
    });
    slide.addText(p.desc, {
      x: 0.35, y: y + 0.3, w: 4.1, h: 0.52,
      fontSize: 7.5, fontFace: "Microsoft YaHei",
      color: "555555", wrap: true
    });
  });

  // 中间大箭头
  slide.addShape("rect", {
    x: 4.75, y: 1.8, w: 0.5, h: 1.5,
    fill: { color: "6A4CAF" }, line: { color: "6A4CAF" }
  });
  slide.addText("→", {
    x: 4.65, y: 2.2, w: 0.7, h: 0.7,
    fontSize: 28, color: "FFFFFF", align: "center", valign: "middle"
  });

  // "改善后"标题块（右侧，紫色）
  slide.addShape("rect", {
    x: 5.4, y: 0.7, w: 4.4, h: 0.45,
    fill: { color: "6A4CAF" }, line: { color: "6A4CAF" }
  });
  slide.addText("✓  改善后   破局·系统性质量提升", {
    x: 5.4, y: 0.7, w: 4.4, h: 0.45,
    fontSize: 12, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, valign: "middle"
  });

  // 三个改善方案框（右侧竖排）
  const solutions = [
    { num: "01", title: "工艺升级革新", desc: "定位精度提升：采用液压自锁夹具，基准偏移量由0.05mm，CPK值提升至1.67。防错机制嵌入：增加压力传感器实时监控" },
    { num: "02", title: "智能检测介入", desc: "自动测量替代：引入激光扫描仪，检测效率提升400%，单件耗时降至45秒。检测优化：检测工位嵌入装配线" },
    { num: "03", title: "质量体系完善", desc: "SOP数字孪生化：建立控制点自动采集系统，超差即时报警锁定工位。看板实时管理：电子巡查覆盖全面监控" }
  ];
  solutions.forEach((s, i) => {
    const y = 1.25 + i * 1.0;
    slide.addShape("rect", {
      x: 5.4, y, w: 4.4, h: 0.88,
      fill: { color: "F8F4FF" }, line: { color: "D1C4E9", width: 0.5 }
    });
    slide.addText(s.num + ". " + s.title, {
      x: 5.55, y: y + 0.05, w: 4.1, h: 0.25,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: "4527A0", bold: true
    });
    slide.addText(s.desc, {
      x: 5.55, y: y + 0.3, w: 4.1, h: 0.52,
      fontSize: 7.5, fontFace: "Microsoft YaHei",
      color: "555555", wrap: true
    });
  });

  addPageBadge(slide, pres, 1);
  return slide;
}
```

---

## B2. 团队成员角色标签页

**视觉特征**：每位成员一张吊牌/卡片，上方写职位，下方写代表技能，用绳子连成一排，背景浅紫色

```javascript
function createTeamTagsSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "F3EEF8" };

  addConsultHeader(slide, pres, "年度团队成果汇报");

  // 服务闭环说明
  slide.addShape("rect", {
    x: 0.2, y: 0.65, w: 1.6, h: 0.35,
    fill: { color: "6A4CAF" }, line: { color: "6A4CAF" }
  });
  slide.addText("服务闭环", {
    x: 0.2, y: 0.65, w: 1.6, h: 0.35,
    fontSize: 11, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });
  slide.addText("客服体系如何实现质效双升？", {
    x: 2.0, y: 0.7, w: 5, h: 0.3,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: "1A1A1A", bold: true
  });

  // 连接绳线（模拟绑绳）
  slide.addShape("line", {
    x: 0.5, y: 1.6, w: 9, h: 0,
    line: { color: "999999", width: 1.2 }
  });

  // 成员标签卡片
  const members = [
    { name: "李岩", role: "客服专员", tags: "服务升级，面对客户", x: 0.3 },
    { name: "周凯利", role: "资深客服", tags: "效能筑底，面对客户三维渠道，团队分战略研与背景", x: 2.2 },
    { name: "张忆", role: "客服组长", tags: "口径深挖，面对客户评测及制度风险，能够快速启动预案+客诉闭环", x: 4.1 },
    { name: "陈子羽", role: "投诉专员", tags: "流程革新，面对老旧流程及时消除，能够快速培育监理痛点+迭代方案", x: 6.0 },
    { name: "王蒙蒙", role: "实习管理", tags: "客服管理，面对客户段客户较为弱化，快速掌握遗留问题+找到调研", x: 7.9 }
  ];

  members.forEach((m, i) => {
    // 卡片主体（圆角矩形）
    slide.addShape("roundRect", {
      x: m.x, y: 1.2, w: 1.7, h: 2.5,
      fill: { color: "FFFFFF" },
      line: { color: "C5A8E8", width: 0.8 },
      rectRadius: 0.12
    });
    // 顶部职位色块
    slide.addShape("rect", {
      x: m.x, y: 1.2, w: 1.7, h: 0.35,
      fill: { color: "7B5EA7" }, line: { color: "7B5EA7" }
    });
    slide.addText(m.role, {
      x: m.x, y: 1.2, w: 1.7, h: 0.35,
      fontSize: 9, fontFace: "Microsoft YaHei",
      color: "FFFFFF", align: "center", valign: "middle"
    });
    // 姓名
    slide.addText(m.name, {
      x: m.x, y: 1.6, w: 1.7, h: 0.35,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: "4527A0", bold: true, align: "center"
    });
    // 技能描述
    slide.addText(m.tags, {
      x: m.x + 0.08, y: 2.0, w: 1.54, h: 1.6,
      fontSize: 7, fontFace: "Microsoft YaHei",
      color: "555555", wrap: true
    });
  });

  addPageBadge(slide, pres, 2);
  return slide;
}
```

---

## B3. 业绩复盘六面体页

**视觉特征**：中心3D立方体/六面体，4个方向延伸出"目标完成"、"核心成果"、"业绩达成"、"问题分析"标签；底部横幅总结语

```javascript
function createReviewCubeSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  addConsultHeader(slide, pres, "工作成果复盘");

  // 中心六面体（用叠加矩形+渐变模拟3D效果）
  // 正面
  slide.addShape("rect", {
    x: 3.8, y: 1.5, w: 2.3, h: 1.8,
    fill: { type: "gradient", stops: [{ position: 0, color: "9575CD" }, { position: 100, color: "5E35B1" }] },
    line: { color: "5E35B1", width: 0.5 }
  });
  slide.addText("业绩\n达成", {
    x: 3.8, y: 1.9, w: 2.3, h: 1.0,
    fontSize: 18, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });

  // 四个延伸标签
  const labels = [
    { text: "目标完成", x: 1.0, y: 1.6, w: 1.5, color: "7B5EA7" },
    { text: "核心成果", x: 1.0, y: 2.8, w: 1.5, color: "00897B" },
    { text: "问题分析", x: 7.4, y: 1.6, w: 1.5, color: "E53935" },
    { text: "差距改进", x: 7.4, y: 2.8, w: 1.5, color: "F57C00" }
  ];
  labels.forEach(l => {
    slide.addShape("rect", {
      x: l.x, y: l.y, w: l.w, h: 0.4,
      fill: { color: l.color }, line: { color: l.color }
    });
    slide.addText(l.text, {
      x: l.x, y: l.y, w: l.w, h: 0.4,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
  });

  // 连接线
  slide.addShape("line", { x: 2.5, y: 1.8, w: 1.3, h: 0, line: { color: "9E9E9E", width: 0.8 } });
  slide.addShape("line", { x: 2.5, y: 3.0, w: 1.3, h: 0, line: { color: "9E9E9E", width: 0.8 } });
  slide.addShape("line", { x: 6.1, y: 1.8, w: 1.3, h: 0, line: { color: "9E9E9E", width: 0.8 } });
  slide.addShape("line", { x: 6.1, y: 3.0, w: 1.3, h: 0, line: { color: "9E9E9E", width: 0.8 } });

  // 底部总结横幅
  slide.addShape("rect", {
    x: 0.3, y: 4.8, w: 9.4, h: 0.45,
    fill: { color: "EDE7F6" }, line: { color: "B39DDB", width: 0.5 }
  });
  slide.addText("知行合一 · 持续超越   聚焦关键改进，驱动团队功能与业绩再上新台阶", {
    x: 0.3, y: 4.8, w: 9.4, h: 0.45,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: "4527A0", bold: true, align: "center", valign: "middle"
  });

  addPageBadge(slide, pres, 3);
  return slide;
}
```

---

## B4. 圆环工作规划页（放射状）

**视觉特征**：中心大圆 + 放射出4条线路，每条对应一项战略，右侧文字详细展开；支持"N项工作规划"格式

```javascript
function createRadialPlanSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  addConsultHeader(slide, pres, "2025年核心工作计划");

  // 中心圆环
  slide.addShape("oval", {
    x: 1.0, y: 1.2, w: 2.8, h: 2.8,
    fill: { type: "gradient", stops: [{ position: 0, color: "D1C4E9" }, { position: 100, color: "9575CD" }] },
    line: { color: "7E57C2", width: 1.5 }
  });
  slide.addText("4项\n工作规划", {
    x: 1.0, y: 1.9, w: 2.8, h: 1.4,
    fontSize: 22, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });

  // 4条放射分支 + 标题
  const plans = [
    { icon: "多卖产品", color: "7B5EA7", y: 1.3 },
    { icon: "做好产品", color: "00897B", y: 2.1 },
    { icon: "管好内部", color: "E53935", y: 2.9 },
    { icon: "带好队伍", color: "F57C00", y: 3.7 }
  ];
  plans.forEach(p => {
    slide.addShape("line", { x: 3.8, y: p.y + 0.2, w: 0.8, h: 0, line: { color: p.color, width: 1.5 } });
    slide.addShape("rect", {
      x: 4.6, y: p.y, w: 1.2, h: 0.4,
      fill: { color: p.color }, line: { color: p.color }
    });
    slide.addText(p.icon, {
      x: 4.6, y: p.y, w: 1.2, h: 0.4,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
  });

  addPageBadge(slide, pres, 4);
  return slide;
}
```

---

## B5. 增长箭头业绩看板页

**视觉特征**：左侧大箭头上升图（从市场→产品→客户→运营→战略），右侧KPI数字卡片+注释，底部季度对比区

```javascript
function createGrowthDashboardSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };

  addConsultHeader(slide, pres, "工作亮点/公司业绩增长分析");

  // 业绩增长大标题
  slide.addText("逆势突围创新局  多维驱动稳增长", {
    x: 0.2, y: 0.65, w: 9.5, h: 0.4,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: "1A1A1A", bold: true
  });

  // KPI 大数字行
  const kpis = [
    { value: "+42%", label: "新客户激增", sub: "区域置盖 | 渠道下沉 | 线上裂变", color: "7B5EA7" },
    { value: "+25%", label: "竞争力升级", sub: "智能迭代 | 场景定制 | 专利壁垒", color: "5E35B1" },
    { value: "92%", label: "满意度跃升", sub: "响应提速 | 专属运维 | 价值挖掘", color: "7B5EA7" },
    { value: "18%", label: "效能突破", sub: "流程再造 | 数据平台 | 风险管控", color: "00897B" }
  ];
  kpis.forEach((k, i) => {
    const x = 0.2 + i * 2.45;
    slide.addShape("rect", {
      x, y: 1.15, w: 2.3, h: 0.9,
      fill: { color: "F8F4FF" }, line: { color: "D1C4E9", width: 0.5 }
    });
    slide.addText(k.value, {
      x, y: 1.2, w: 2.3, h: 0.4,
      fontSize: 22, fontFace: "Arial",
      color: k.color, bold: true, align: "center"
    });
    slide.addText(k.label, {
      x, y: 1.6, w: 2.3, h: 0.2,
      fontSize: 8, fontFace: "Microsoft YaHei",
      color: "333333", align: "center"
    });
    slide.addText(k.sub, {
      x, y: 1.82, w: 2.3, h: 0.2,
      fontSize: 6.5, fontFace: "Microsoft YaHei",
      color: "888888", align: "center"
    });
  });

  // 增长箭头（从左下到右上，渐变紫色）
  slide.addShape("rect", {
    x: 0.2, y: 2.3, w: 9.5, h: 0.6,
    fill: { type: "gradient", stops: [{ position: 0, color: "D1C4E9" }, { position: 100, color: "7B5EA7" }] },
    line: { color: "7B5EA7", width: 0.5 }
  });
  const arrowLabels = ["市场", "产品", "客户", "运营", "战略"];
  arrowLabels.forEach((l, i) => {
    slide.addText(l, {
      x: 0.5 + i * 1.9, y: 2.38, w: 1.3, h: 0.45,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
  });

  addPageBadge(slide, pres, 5);
  return slide;
}
```

---

# 风格C：InsightX 商业模型（BerryPPT）

> 白底，主色 `#2D8A6A`（深绿）+ `#4CAF50`，圆角色块，左上角编号徽章，标题中英双语，简洁学术风
> 适合：商业模型分析、策略框架展示、产品管理汇报

## InsightX 通用辅助函数

```javascript
function addInsightXHeader(slide, pres, num, titleCN, titleEN) {
  // 顶部左上角编号徽章
  slide.addShape("oval", {
    x: 0.2, y: 0.12, w: 0.5, h: 0.5,
    fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }
  });
  slide.addText(String(num).padStart(3, "0"), {
    x: 0.2, y: 0.12, w: 0.5, h: 0.5,
    fontSize: 9, fontFace: "Arial",
    color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });
  // 标题（中英双语）
  slide.addText(titleCN + " " + titleEN, {
    x: 0.85, y: 0.15, w: 8, h: 0.4,
    fontSize: 15, fontFace: "Microsoft YaHei",
    color: "1A1A1A", bold: true
  });
  // 右上角 InsightX 标签
  slide.addText("InsightX 100©", {
    x: 8.5, y: 0.18, w: 1.4, h: 0.3,
    fontSize: 9, fontFace: "Arial",
    color: "888888", align: "right"
  });
  // 顶部分隔线
  slide.addShape("line", {
    x: 0.2, y: 0.65, w: 9.6, h: 0,
    line: { color: "EEEEEE", width: 0.5 }
  });
}

function addInsightXFooter(slide, pres) {
  slide.addText("© The InsightX 100© PPT template is the exclusive copyright of BerryPPT®. All rights reserved.", {
    x: 0.2, y: 5.35, w: 9.6, h: 0.2,
    fontSize: 6, fontFace: "Arial",
    color: "BBBBBB", align: "center"
  });
}
```

---

## C1. SWOT 分析四象限

**视觉特征**：中心4个3D绿色方块（S/W/O/T），四周文字框说明定义和示例

```javascript
function createSWOTSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 25, "SWOT分析模型", "SWOT Analysis Model");

  // 四个核心模块
  const swot = [
    { letter: "S", label: "优势", x: 1.0, y: 1.0, color: "2D8A6A" },
    { letter: "W", label: "劣势", x: 4.5, y: 1.0, color: "2D8A6A" },
    { letter: "O", label: "机会", x: 1.0, y: 3.0, color: "2D8A6A" },
    { letter: "T", label: "威胁", x: 4.5, y: 3.0, color: "2D8A6A" }
  ];
  swot.forEach(s => {
    // 3D方块（叠加矩形模拟）
    slide.addShape("rect", {
      x: s.x, y: s.y, w: 2.8, h: 1.7,
      fill: { type: "gradient", stops: [{ position: 0, color: "A8D5C2" }, { position: 100, color: "2D8A6A" }] },
      line: { color: "1B5E4A", width: 0.8 }
    });
    slide.addText(s.letter, {
      x: s.x, y: s.y + 0.15, w: 2.8, h: 1.0,
      fontSize: 52, fontFace: "Arial",
      color: "FFFFFF", bold: true, align: "center", valign: "middle",
      transparency: 20
    });
    slide.addText(s.label, {
      x: s.x, y: s.y + 1.25, w: 2.8, h: 0.35,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center"
    });
  });

  // 四个文字说明框（右侧）
  const descriptions = [
    { title: "Strengths 优势", color: "2D8A6A",
      text: "定义｜内部因素，指企业或个人在市场竞争中拥有的积极因素或能力，可以为目标的实现提供帮助。\n示例｜强大的品牌声誉、广泛的客户基础、领先的技术能力、高效的运营流程等。" },
    { title: "Opportunities 机会", color: "2D8A6A",
      text: "定义｜外部因素，指企业或个人在外部环境中可以利用的积极因素，有助于实现目标或增长。\n示例｜市场扩展、新兴技术、政策支持、竞争对手的弱点等。" },
    { title: "Weaknesses 劣势", color: "5A8A5A",
      text: "定义｜内部因素，指企业或个人在市场竞争中存在的不足或限制，可能阻碍目标的实现。\n示例｜资源有限、品牌知名度低、技术落后、员工技能不足等。" },
    { title: "Threats 威胁", color: "5A8A5A",
      text: "定义｜外部因素，指企业或个人在外部环境中面临的潜在挑战或风险，可能对目标的实现产生不利影响。\n示例｜市场竞争加剧、法规变动、经济衰退、自然灾害等。" }
  ];
  const boxPositions = [
    { x: 7.6, y: 0.75 }, { x: 7.6, y: 2.7 },
    { x: 0.15, y: 2.7 }, { x: 0.15, y: 4.3 }
  ];
  descriptions.forEach((d, i) => {
    const pos = boxPositions[i];
    slide.addShape("roundRect", {
      x: pos.x, y: pos.y, w: 2.3, h: 1.7,
      fill: { color: "FFFFFF" }, line: { color: "DDDDDD", width: 0.5 }, rectRadius: 0.08
    });
    slide.addShape("rect", {
      x: pos.x, y: pos.y, w: 1.5, h: 0.28,
      fill: { color: "FFFFFF" }, line: { color: "FFFFFF" }
    });
    slide.addShape("roundRect", {
      x: pos.x + 0.08, y: pos.y + 0.06, w: 1.3, h: 0.22,
      fill: { color: d.color }, line: { color: d.color }, rectRadius: 0.1
    });
    slide.addText(d.title, {
      x: pos.x + 0.08, y: pos.y + 0.06, w: 1.3, h: 0.22,
      fontSize: 7, fontFace: "Arial",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
    slide.addText(d.text, {
      x: pos.x + 0.1, y: pos.y + 0.35, w: 2.1, h: 1.3,
      fontSize: 6.5, fontFace: "Microsoft YaHei",
      color: "444444", wrap: true
    });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C2. 安索夫矩阵 Ansoff Matrix

**视觉特征**：2×2矩阵，X轴=产品（现有/新），Y轴=市场（现有/新），4个象限分别为市场渗透/产品开发/市场开发/多元化，右侧4项编号说明

```javascript
function createAnsoffMatrixSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 21, "安索夫矩阵模型", "Ansoff Matrix Model");

  // 矩阵4象限
  const quadrants = [
    { name: "Market\nDevelopment", nameCN: "市场开发", x: 0.7, y: 0.8, bg: "F0FAF7" },
    { name: "Diversification", nameCN: "多元化发展", x: 3.4, y: 0.8, bg: "E8F7F2" },
    { name: "Market\nPenetration", nameCN: "市场渗透", x: 0.7, y: 2.65, bg: "E0F5EC" },
    { name: "Product\nDevelopment", nameCN: "产品开发", x: 3.4, y: 2.65, bg: "F0FAF7" }
  ];
  quadrants.forEach(q => {
    slide.addShape("roundRect", {
      x: q.x, y: q.y, w: 2.5, h: 1.75,
      fill: { color: q.bg }, line: { color: "CCEECC", width: 0.8 }, rectRadius: 0.1
    });
    slide.addText(q.name, {
      x: q.x, y: q.y + 0.3, w: 2.5, h: 0.65,
      fontSize: 13, fontFace: "Arial",
      color: "2D8A6A", bold: true, align: "center"
    });
    slide.addShape("roundRect", {
      x: q.x + 0.5, y: q.y + 1.1, w: 1.5, h: 0.3,
      fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12
    });
    slide.addText(q.nameCN, {
      x: q.x + 0.5, y: q.y + 1.1, w: 1.5, h: 0.3,
      fontSize: 9, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
  });

  // 坐标轴标签
  slide.addText("New\nMarkets", { x: 0.1, y: 0.8, w: 0.6, h: 1.7, fontSize: 8, fontFace: "Arial", color: "555555", align: "center" });
  slide.addText("Existing\nMarkets", { x: 0.1, y: 2.6, w: 0.6, h: 1.7, fontSize: 8, fontFace: "Arial", color: "555555", align: "center" });
  slide.addShape("roundRect", { x: 0.7, y: 4.55, w: 1.5, h: 0.25, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.1 });
  slide.addText("Existing Products  现有产品", { x: 0.7, y: 4.55, w: 1.5, h: 0.25, fontSize: 7, fontFace: "Arial", color: "FFFFFF", align: "center", valign: "middle" });
  slide.addShape("roundRect", { x: 3.4, y: 4.55, w: 1.5, h: 0.25, fill: { color: "555555" }, line: { color: "555555" }, rectRadius: 0.1 });
  slide.addText("New Products  新产品", { x: 3.4, y: 4.55, w: 1.5, h: 0.25, fontSize: 7, fontFace: "Arial", color: "FFFFFF", align: "center", valign: "middle" });

  // 右侧4项编号说明
  const explanations = [
    { num: "1", title: "市场渗透 (Market Penetration)", desc: "定义：企业在现有市场中销售现有产品，通过提高市场份额来实现增长。" },
    { num: "2", title: "产品开发 (Product Development)", desc: "定义：企业在现有市场上针对已有客户推出新产品或改进现有产品。" },
    { num: "3", title: "市场开发 (Market Development)", desc: "定义：企业将现有产品销售到新的市场，包括新的地理区域、市场细分或新的客户群。" },
    { num: "4", title: "多元化 (Diversification)", desc: "定义：企业进入新市场并推出全新的产品，是最为激进的增长策略。" }
  ];
  explanations.forEach((e, i) => {
    const y = 0.75 + i * 1.1;
    slide.addShape("oval", {
      x: 6.3, y: y, w: 0.28, h: 0.28,
      fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }
    });
    slide.addText(e.num, { x: 6.3, y: y, w: 0.28, h: 0.28, fontSize: 9, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    slide.addText(e.title, { x: 6.65, y: y, w: 3.2, h: 0.28, fontSize: 9, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });
    slide.addText(e.desc, { x: 6.65, y: y + 0.3, w: 3.2, h: 0.7, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555", wrap: true });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C3. 帕累托漏斗 Pareto Model

**视觉特征**：左右对称两个倒三角漏斗，中间箭头说明16倍收益率公式，底部圆形汇总

```javascript
function createParetoSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 24, "帕累托法则模型", "Pareto Principle Model");

  // 左侧漏斗（回头客）
  slide.addShape("rect", {
    x: 0.5, y: 0.8, w: 3.0, h: 0.4,
    fill: { color: "4CAF50" }, line: { color: "4CAF50" }
  });
  slide.addText("20% 的回头客 =", { x: 0.5, y: 0.8, w: 3.0, h: 0.4, fontSize: 11, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
  slide.addShape("rect", { x: 0.8, y: 1.2, w: 2.4, h: 1.2, fill: { color: "E8F5E9" }, line: { color: "4CAF50", width: 0.5 } });
  slide.addText("80%\n（收益）", { x: 0.8, y: 1.3, w: 2.4, h: 1.0, fontSize: 26, fontFace: "Arial", color: "2D8A6A", bold: true, align: "center", valign: "middle" });
  slide.addText("回头客的收益率", { x: 0.8, y: 2.5, w: 2.4, h: 0.3, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "center" });
  slide.addShape("roundRect", { x: 1.0, y: 2.85, w: 2.0, h: 0.3, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12 });
  slide.addText("(RE1)=80/20=4", { x: 1.0, y: 2.85, w: 2.0, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });

  // 右侧漏斗（一次性客户）
  slide.addShape("rect", { x: 6.5, y: 0.8, w: 3.0, h: 0.4, fill: { color: "4CAF50" }, line: { color: "4CAF50" } });
  slide.addText("80% 一次性客户 =", { x: 6.5, y: 0.8, w: 3.0, h: 0.4, fontSize: 11, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
  slide.addShape("rect", { x: 6.8, y: 1.2, w: 2.4, h: 1.2, fill: { color: "E8F5E9" }, line: { color: "4CAF50", width: 0.5 } });
  slide.addText("20%\n（收益）", { x: 6.8, y: 1.3, w: 2.4, h: 1.0, fontSize: 26, fontFace: "Arial", color: "2D8A6A", bold: true, align: "center", valign: "middle" });
  slide.addText("回头客的收益率", { x: 6.8, y: 2.5, w: 2.4, h: 0.3, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "center" });
  slide.addShape("roundRect", { x: 7.0, y: 2.85, w: 2.0, h: 0.3, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12 });
  slide.addText("(RE2)=20/80=0.25", { x: 7.0, y: 2.85, w: 2.0, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });

  // 中间公式说明
  slide.addText("根据帕累托法则\n回头客的收益效率是一次性\n客户的16倍", { x: 3.7, y: 1.5, w: 2.6, h: 1.0, fontSize: 9, fontFace: "Microsoft YaHei", color: "444444", align: "center", wrap: true });

  // 底部汇总
  slide.addShape("line", { x: 1.9, y: 3.25, w: 1.8, h: 0, line: { color: "2D8A6A", width: 1 } });
  slide.addShape("line", { x: 6.3, y: 3.25, w: 1.8, h: 0, line: { color: "2D8A6A", width: 1 } });
  slide.addShape("line", { x: 3.7, y: 3.25, w: 2.6, h: 0.8, line: { color: "2D8A6A", width: 1 } });
  slide.addShape("roundRect", { x: 3.7, y: 3.6, w: 2.6, h: 0.3, fill: { color: "F0FAF7" }, line: { color: "4CAF50", width: 0.5 }, rectRadius: 0.1 });
  slide.addText("收益贡献杠杆）RCL = RE1/RE2 = 4/0.25 = 16", { x: 3.7, y: 3.6, w: 2.6, h: 0.3, fontSize: 8, fontFace: "Arial", color: "2D8A6A", align: "center", valign: "middle" });
  slide.addShape("oval", { x: 4.4, y: 4.1, w: 1.2, h: 0.7, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" } });
  slide.addText("16X", { x: 4.4, y: 4.1, w: 1.2, h: 0.7, fontSize: 20, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C4. 跨域鸿沟曲线 Chasm Model

**视觉特征**：山形分布曲线，左侧早期市场，中间鸿沟，右侧主流市场；各阶段百分比标注，底部绿色标签

```javascript
function createChasmModelSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 17, "跨域鸿沟模型", "Cross-Domain Chasm Model");

  // 左山（早期市场）- 用三角形模拟
  slide.addShape("rect", { x: 0.3, y: 1.5, w: 2.2, h: 2.5, fill: { color: "D4EEE8" }, line: { color: "4CAF50", width: 0.5 } });
  slide.addText("2.5%\n创新者", { x: 0.3, y: 2.8, w: 1.0, h: 0.8, fontSize: 14, fontFace: "Arial", color: "2D8A6A", bold: true, align: "center" });
  slide.addText("13.5%\n早期采用者", { x: 1.3, y: 2.8, w: 1.2, h: 0.8, fontSize: 14, fontFace: "Arial", color: "2D8A6A", bold: true, align: "center" });

  // 鸿沟区（中间白色/灰色）
  slide.addShape("rect", { x: 2.5, y: 1.0, w: 1.2, h: 3.5, fill: { color: "F5F5F5" }, line: { color: "DDDDDD", width: 0.5 } });
  slide.addShape("oval", { x: 2.85, y: 1.2, w: 0.5, h: 0.5, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" } });
  slide.addText("鸿沟", { x: 2.85, y: 1.2, w: 0.5, h: 0.5, fontSize: 8, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
  slide.addText("最小特征\n集合", { x: 2.55, y: 2.2, w: 1.1, h: 0.5, fontSize: 8, fontFace: "Microsoft YaHei", color: "555555", align: "center" });

  // 右山（主流市场）
  slide.addShape("rect", { x: 3.7, y: 1.0, w: 5.5, h: 3.0, fill: { color: "D4EEE8" }, line: { color: "4CAF50", width: 0.5 } });
  const mainstream = [
    { pct: "34%", label: "早期多数", x: 3.9 },
    { pct: "34%", label: "后期多数", x: 5.7 },
    { pct: "16%", label: "落后者", x: 7.5 }
  ];
  mainstream.forEach(m => {
    slide.addText(m.pct, { x: m.x, y: 2.5, w: 1.5, h: 0.5, fontSize: 22, fontFace: "Arial", color: "2D8A6A", bold: true, align: "center" });
    slide.addShape("roundRect", { x: m.x + 0.1, y: 3.1, w: 1.3, h: 0.28, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.1 });
    slide.addText(m.label, { x: m.x + 0.1, y: 3.1, w: 1.3, h: 0.28, fontSize: 9, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
  });

  // 底部标签
  slide.addShape("roundRect", { x: 0.3, y: 4.1, w: 2.2, h: 0.28, fill: { color: "F0FAF7" }, line: { color: "4CAF50", width: 0.5 }, rectRadius: 0.1 });
  slide.addText("Innovator of Market  市场创新者", { x: 0.3, y: 4.1, w: 2.2, h: 0.28, fontSize: 7.5, fontFace: "Arial", color: "2D8A6A", align: "center", valign: "middle" });
  slide.addShape("roundRect", { x: 3.7, y: 4.1, w: 2.2, h: 0.28, fill: { color: "F0FAF7" }, line: { color: "4CAF50", width: 0.5 }, rectRadius: 0.1 });
  slide.addText("Complete Solutions  想要完整解决方案的人群", { x: 3.7, y: 4.1, w: 2.2, h: 0.28, fontSize: 7.5, fontFace: "Arial", color: "2D8A6A", align: "center", valign: "middle" });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C5. KANO 模型坐标图

**视觉特征**：X轴=功能具备程度，Y轴=满意度，4条属性曲线（魅力、必备、无差异、期望、反向），右侧3个特性说明框

```javascript
function createKANOSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 19, "KANO模型", "KANO Model");

  // 坐标轴
  slide.addShape("line", { x: 1.0, y: 0.8, w: 0, h: 4.2, line: { color: "333333", width: 1.2 } });
  slide.addShape("line", { x: 0.5, y: 3.0, w: 5.5, h: 0, line: { color: "333333", width: 1.2 } });
  slide.addText("满意度高", { x: 0.2, y: 0.8, w: 0.7, h: 0.3, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555" });
  slide.addText("满意度低", { x: 0.2, y: 4.8, w: 0.7, h: 0.3, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555" });
  slide.addText("High Satisfaction  满意度高", { x: 1.1, y: 0.7, w: 4, h: 0.28, fontSize: 7, fontFace: "Arial", color: "888888", align: "center" });
  slide.addText("Low Satisfaction  满意度低", { x: 1.1, y: 4.85, w: 4, h: 0.28, fontSize: 7, fontFace: "Arial", color: "888888", align: "center" });

  // 模拟4条曲线（折线近似）
  // 魅力属性（金色/向上曲线）
  slide.addShape("line", { x: 1.0, y: 3.0, w: 4.5, h: -1.8, line: { color: "D4A017", width: 1.5 } });
  slide.addText("魅力属性", { x: 4.0, y: 1.3, w: 1.2, h: 0.28, fontSize: 8, fontFace: "Microsoft YaHei", color: "D4A017", bold: true });

  // 必备属性（深绿色/陡升曲线）
  slide.addShape("line", { x: 2.5, y: 3.0, w: 2.5, h: -1.5, line: { color: "2D8A6A", width: 1.5 } });
  slide.addText("必备属性", { x: 4.0, y: 1.7, w: 1.2, h: 0.28, fontSize: 8, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });

  // 无差异属性（灰色横线）
  slide.addShape("line", { x: 1.0, y: 2.5, w: 4.5, h: 0, line: { color: "AAAAAA", width: 1.0 } });
  slide.addText("无差异属性", { x: 3.5, y: 2.2, w: 1.5, h: 0.28, fontSize: 8, fontFace: "Microsoft YaHei", color: "888888" });

  // 期望属性（蓝绿色对角线）
  slide.addShape("line", { x: 1.0, y: 3.8, w: 4.5, h: -2.0, line: { color: "4CAF50", width: 1.5 } });

  // 右侧说明框
  const features = [
    { title: "不需要的特性", color: "E53935", text: "这类特性对顾客可能引起不满或反感的产品功能或服务。它们不仅不能提升顾客满意度，反而可能对品牌形象造成负面影响。" },
    { title: "不重要的特性", color: "F57C00", text: "这类特性对顾客的满意度影响微乎其微。它们既不增加也不减少顾客的满意度，通常被视为对产品或服务价值贡献较低的部分。" },
    { title: "期望的特性", color: "2D8A6A", text: "期望的特性是顾客特别重视并期望在产品中看到的功能或服务。这些特性直接影响顾客的购买决策和满意度。企业通过强化这类特性，可以显著提升客户的满意度和忠诚度。" }
  ];
  features.forEach((f, i) => {
    const y = 0.8 + i * 1.6;
    slide.addShape("roundRect", { x: 6.5, y, w: 3.3, h: 1.45, fill: { color: "FAFAFA" }, line: { color: "EEEEEE", width: 0.5 }, rectRadius: 0.08 });
    slide.addShape("roundRect", { x: 6.6, y: y + 0.1, w: 1.4, h: 0.25, fill: { color: f.color }, line: { color: f.color }, rectRadius: 0.1 });
    slide.addText(f.title, { x: 6.6, y: y + 0.1, w: 1.4, h: 0.25, fontSize: 8, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    slide.addText(f.text, { x: 6.6, y: y + 0.42, w: 3.1, h: 0.95, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555", wrap: true });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C6. STP 营销模型圆环图

**视觉特征**：右侧大圆环，中心写"顾客"，环上分布6P营销要素；左侧3个S/T/P步骤说明框

```javascript
function createSTPSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 18, "STP分析模型", "STP Analysis Model");

  // 左侧三步骤
  const steps = [
    { letter: "S", title: "市场细分 Segmentation", desc: "市场细分是将广泛市场需求，行为或特征划分成较小群体的过程。这很有助于企业精确识别目标顾客，为专门的营销策略提供依据。" },
    { letter: "T", title: "目标市场 Targeting", desc: "在市场细分后，企业将选择一个或多个最有潜力的细分市场进行专注。选择依据包括市场的规模、增长潜力以及企业的资源匹配程度。" },
    { letter: "P", title: "市场定位 Positioning", desc: "市场定位是在目标消费者心中塑造品牌独特形象的过程。它通过强调产品的独特优势和与竞品的差异，使品牌在市场中脱颖而出。" }
  ];
  steps.forEach((s, i) => {
    const y = 0.8 + i * 1.5;
    slide.addShape("oval", { x: 0.2, y, w: 0.55, h: 0.55, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" } });
    slide.addText(s.letter, { x: 0.2, y, w: 0.55, h: 0.55, fontSize: 18, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    slide.addText(s.title, { x: 0.85, y, w: 4.0, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });
    slide.addShape("roundRect", { x: 0.85, y: y + 0.32, w: 4.0, h: 1.0, fill: { color: "F5FBF8" }, line: { color: "CCEECC", width: 0.5 }, rectRadius: 0.08 });
    slide.addText(s.desc, { x: 0.95, y: y + 0.38, w: 3.8, h: 0.88, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555", wrap: true });
  });

  // 右侧圆环图（中心"顾客"）
  slide.addShape("oval", { x: 5.8, y: 0.75, w: 4.0, h: 4.0, fill: { color: "E8F7F0" }, line: { color: "4CAF50", width: 1.5 } });
  slide.addShape("oval", { x: 7.2, y: 2.1, w: 1.2, h: 1.2, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" } });
  slide.addText("顾客\n(Customer)", { x: 7.2, y: 2.1, w: 1.2, h: 1.2, fontSize: 9, fontFace: "Microsoft YaHei", color: "FFFFFF", bold: true, align: "center", valign: "middle" });

  // 6P标签（圆环上方）
  const labels6p = [
    { text: "产品\n(Product)", x: 6.6, y: 1.0 },
    { text: "推广\n(Promotion)", x: 8.4, y: 1.0 },
    { text: "沟通\n(Communi-\ncating)", x: 9.3, y: 2.4 },
    { text: "渠道\n(Place)", x: 8.4, y: 3.8 },
    { text: "定价\n(Price)", x: 6.6, y: 3.8 },
    { text: "便利\n(Convenience)", x: 5.5, y: 2.4 }
  ];
  labels6p.forEach(l => {
    slide.addText(l.text, { x: l.x, y: l.y, w: 1.0, h: 0.6, fontSize: 8, fontFace: "Microsoft YaHei", color: "2D8A6A", align: "center" });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C7. RFM 客户价值三维图

**视觉特征**：3D立方体坐标系，XYZ轴分别是Recency/Frequency/Monetary，8个象限各代表不同客户类型，四周文字标注

```javascript
function createRFMSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 57, "RFM客户价值模型", "RFM (Recency, Frequency, Monetary) Model");

  // 3D立方体（叠加多个矩形模拟）
  // 正面
  slide.addShape("rect", { x: 2.5, y: 1.0, w: 3.5, h: 3.5,
    fill: { color: "E8F7F0" }, line: { color: "4CAF50", width: 0.8 } });
  // 右侧面（深色）
  slide.addShape("rect", { x: 6.0, y: 0.6, w: 1.2, h: 3.5,
    fill: { color: "C8E6C9" }, line: { color: "4CAF50", width: 0.8 } });
  // 顶面
  slide.addShape("rect", { x: 2.5, y: 0.6, w: 3.5, h: 0.4,
    fill: { color: "A5D6A7" }, line: { color: "4CAF50", width: 0.8 } });

  // 坐标轴标签
  slide.addShape("roundRect", { x: 4.0, y: 0.1, w: 1.5, h: 0.3,
    fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12 });
  slide.addText("F Frequency  购买频率", { x: 4.0, y: 0.1, w: 1.5, h: 0.3, fontSize: 8, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", valign: "middle" });
  slide.addShape("roundRect", { x: 0.2, y: 2.5, w: 1.5, h: 0.3,
    fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12 });
  slide.addText("R Recency  最近购买时间", { x: 0.2, y: 2.5, w: 1.5, h: 0.3, fontSize: 8, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", valign: "middle" });
  slide.addShape("roundRect", { x: 4.5, y: 4.8, w: 1.5, h: 0.3,
    fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.12 });
  slide.addText("N Monetary  购买金额", { x: 4.5, y: 4.8, w: 1.5, h: 0.3, fontSize: 8, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", valign: "middle" });

  // 客户分类（左侧）
  const leftTypes = [
    { name: "重要挽留用户", desc: "高价值的用户，最近互动少，但频繁消费，需要挽留。", y: 0.75 },
    { name: "重要保持用户", desc: "这些用户的互动频率高，但最近互动时间较长，可能需要保持。", y: 1.7 },
    { name: "一般挽留用户", desc: "低价值的用户，最近互动少，且消费频率较低，可能需要挽留。", y: 2.65 },
    { name: "一般保持用户", desc: "这些用户的互动频率中等，但最近互动时间较长，可能需要保持。", y: 3.6 }
  ];
  leftTypes.forEach(t => {
    slide.addText(t.name, { x: 0.2, y: t.y, w: 2.0, h: 0.25, fontSize: 9, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });
    slide.addText(t.desc, { x: 0.2, y: t.y + 0.28, w: 2.0, h: 0.5, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555", wrap: true });
  });

  // 客户分类（右侧）
  const rightTypes = [
    { name: "重要发展用户", desc: "高价值的用户，最近有互动，但消费频率较低，需要进一步发展。", y: 0.75 },
    { name: "重要价值用户", desc: "高价值的用户，他们最近进行了互动，并且频繁消费。", y: 1.7 },
    { name: "一般发展用户", desc: "中等价值用户，最近有互动，但消费频率较低，需要发展。", y: 2.65 },
    { name: "一般价值用户", desc: "中等价值的用户，最近互动并不频繁，但总体消费较高。", y: 3.6 }
  ];
  rightTypes.forEach(t => {
    slide.addText(t.name, { x: 7.8, y: t.y, w: 2.0, h: 0.25, fontSize: 9, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });
    slide.addText(t.desc, { x: 7.8, y: t.y + 0.28, w: 2.0, h: 0.5, fontSize: 7, fontFace: "Microsoft YaHei", color: "555555", wrap: true });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C8. 甘特图项目计划

**视觉特征**：表格式甘特图，左侧任务列表，右侧时间格，3周周期，绿色进度条

```javascript
function createGanttChartSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 67, "甘特图模型", "Gantt Chart Model");

  // 项目信息行
  const headers = ["项目开始日期", "项目截止日期", "项目负责人"];
  const values = ["2024年8月29日", "2024年10月16日", "BerryPPT"];
  headers.forEach((h, i) => {
    slide.addShape("rect", { x: 0.2 + i * 2.0, y: 0.75, w: 1.9, h: 0.28, fill: { color: "F5F5F5" }, line: { color: "EEEEEE", width: 0.3 } });
    slide.addText(h, { x: 0.2 + i * 2.0, y: 0.75, w: 1.9, h: 0.28, fontSize: 8, fontFace: "Microsoft YaHei", color: "555555", align: "center", valign: "middle" });
    slide.addText(values[i], { x: 0.2 + i * 2.0, y: 1.05, w: 1.9, h: 0.28, fontSize: 8, fontFace: "Microsoft YaHei", color: "333333", bold: true, align: "center", valign: "middle" });
  });

  // 3个周次标题（右侧）
  const weeks = ["WeeK 1\n8月29-9月4日", "WeeK 2\n9月5-9月11日", "WeeK 3\n9月12-9月18日"];
  weeks.forEach((w, i) => {
    slide.addShape("rect", {
      x: 6.3 + i * 1.2, y: 0.75, w: 1.15, h: 0.55,
      fill: { color: i === 2 ? "2D8A6A" : "4CAF50" }, line: { color: i === 2 ? "2D8A6A" : "4CAF50" }
    });
    slide.addText(w, { x: 6.3 + i * 1.2, y: 0.75, w: 1.15, h: 0.55, fontSize: 7, fontFace: "Arial", color: "FFFFFF", align: "center", valign: "middle" });
  });

  // 任务列表（Programme阶段）
  const tasks = [
    { name: "确定营销目标", start: "8月29日", end: "8月2日", days: 5, pct: "100%", actual: 5, week: 0 },
    { name: "市场调研", start: "8月3日", end: "8月7日", days: 5, pct: "60%", actual: 3, week: 0 },
    { name: "预算分配", start: "8月2日", end: "8月3日", days: 2, pct: "50%", actual: 1, week: 0 },
    { name: "营销策略制定", start: "8月1日", end: "8月4日", days: 4, pct: "75%", actual: 2, week: 0 },
    { name: "确定团队成员及分工", start: "8月4日", end: "8月6日", days: 3, pct: "50%", actual: 2, week: 0 }
  ];

  // 阶段标题行
  slide.addShape("roundRect", { x: 0.2, y: 1.45, w: 1.5, h: 0.25, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" }, rectRadius: 0.08 });
  slide.addText("Programme  计划", { x: 0.2, y: 1.45, w: 1.5, h: 0.25, fontSize: 7.5, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", valign: "middle" });

  // 任务行
  tasks.forEach((t, i) => {
    const y = 1.78 + i * 0.48;
    slide.addText(t.name, { x: 0.2, y, w: 1.8, h: 0.38, fontSize: 7.5, fontFace: "Microsoft YaHei", color: "333333", valign: "middle" });
    slide.addText(t.start, { x: 2.05, y, w: 0.8, h: 0.38, fontSize: 7, fontFace: "Arial", color: "555555", align: "center", valign: "middle" });
    slide.addText(t.end, { x: 2.9, y, w: 0.8, h: 0.38, fontSize: 7, fontFace: "Arial", color: "555555", align: "center", valign: "middle" });
    slide.addText(String(t.days), { x: 3.75, y, w: 0.5, h: 0.38, fontSize: 7, fontFace: "Arial", color: "555555", align: "center", valign: "middle" });
    slide.addText(t.pct, { x: 4.3, y, w: 0.8, h: 0.38, fontSize: 7, fontFace: "Arial", color: t.pct === "100%" ? "2D8A6A" : "F57C00", bold: true, align: "center", valign: "middle" });
    slide.addText(String(t.actual), { x: 5.15, y, w: 0.5, h: 0.38, fontSize: 7, fontFace: "Arial", color: "555555", align: "center", valign: "middle" });
    // 进度条（绿色）
    const barW = (t.actual / 7) * 3.5;
    slide.addShape("rect", { x: 5.8, y: y + 0.1, w: barW, h: 0.2, fill: { color: "4CAF50" }, line: { color: "4CAF50" } });
    // 剩余灰条
    slide.addShape("rect", { x: 5.8 + barW, y: y + 0.1, w: 3.5 - barW, h: 0.2, fill: { color: "E0E0E0" }, line: { color: "E0E0E0" } });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C9. 客户旅程地图

**视觉特征**：横向4阶段（需求研究→产品发现→决策与购买→订单与服务），纵向分层（阶段/行为/感受/情绪），情绪曲线用波浪表示

```javascript
function createCustomerJourneySlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 4, "客户旅程图模型", "Customer Journey Mapping Model");

  const stages = ["需求研究", "产品发现", "决策与购买", "订单与服务"];
  const stageColors = ["2D8A6A", "4CAF50", "81C784", "A5D6A7"];

  stages.forEach((s, i) => {
    const x = 0.3 + i * 2.45;
    slide.addShape("rect", { x, y: 0.75, w: 2.35, h: 0.35,
      fill: { color: stageColors[i] }, line: { color: stageColors[i] } });
    slide.addText(s, { x, y: 0.75, w: 2.35, h: 0.35,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle" });
  });

  // 行为层
  const rows = ["阶段", "行为", "感受", "情绪", "机会"];
  rows.forEach((r, i) => {
    const y = 1.2 + i * 0.85;
    slide.addShape("rect", { x: 0.0, y, w: 0.3, h: 0.8,
      fill: { color: "F0FAF7" }, line: { color: "CCEECC", width: 0.3 } });
    slide.addText(r, { x: 0.0, y, w: 0.3, h: 0.8,
      fontSize: 7, fontFace: "Microsoft YaHei",
      color: "2D8A6A", bold: true, align: "center", valign: "middle" });
  });

  // 内容格（简化）
  stages.forEach((_, si) => {
    const x = 0.3 + si * 2.45;
    for (let ri = 0; ri < rows.length; ri++) {
      const y = 1.2 + ri * 0.85;
      slide.addShape("rect", { x, y, w: 2.35, h: 0.8,
        fill: { color: "FAFAFA" }, line: { color: "EEEEEE", width: 0.3 } });
    }
  });

  // 情绪表情行（第4行）
  const emotions = ["😊", "🤔", "😐", "😄"];
  emotions.forEach((e, i) => {
    slide.addText(e, {
      x: 0.3 + i * 2.45 + 0.85, y: 1.2 + 2 * 0.85 + 0.25, w: 0.6, h: 0.4,
      fontSize: 18, align: "center", valign: "middle"
    });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C10. 商业模式画布

**视觉特征**：9宫格画布（合作伙伴/关键活动/价值主张/客户关系/客户细分/关键资源/渠道通路/成本结构/收入来源），绿色标题，白色内容区

```javascript
function createBusinessCanvasSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 28, "商业模式画布模型", "Business Model Canvas Model");

  const blocks = [
    { title: "Key Partnerships\n合作伙伴", x: 0.2, y: 0.75, w: 1.9, h: 2.8, icon: "🤝" },
    { title: "Key Activities\n关键业务", x: 2.15, y: 0.75, w: 1.9, h: 1.35, icon: "⚙" },
    { title: "Value Propositions\n价值主张", x: 4.1, y: 0.75, w: 1.9, h: 2.8, icon: "💎" },
    { title: "Customer Relationships\n客户关系", x: 6.05, y: 0.75, w: 1.9, h: 1.35, icon: "❤" },
    { title: "Customer Segments\n客户细分", x: 8.0, y: 0.75, w: 1.8, h: 2.8, icon: "👥" },
    { title: "Key Resources\n关键资源", x: 2.15, y: 2.15, w: 1.9, h: 1.4, icon: "🔑" },
    { title: "Channels\n渠道通路", x: 6.05, y: 2.15, w: 1.9, h: 1.4, icon: "📦" },
    { title: "Cost Structure\n成本结构", x: 0.2, y: 3.6, w: 4.7, h: 1.4, icon: "💰" },
    { title: "Revenue Streams\n收入来源", x: 4.95, y: 3.6, w: 4.85, h: 1.4, icon: "📈" }
  ];

  blocks.forEach(b => {
    slide.addShape("roundRect", { x: b.x, y: b.y, w: b.w, h: b.h,
      fill: { color: "FAFAFA" }, line: { color: "DDDDDD", width: 0.5 }, rectRadius: 0.06 });
    slide.addShape("rect", { x: b.x, y: b.y, w: b.w, h: 0.35,
      fill: { color: "E8F7F0" }, line: { color: "E8F7F0" } });
    slide.addText(b.title, { x: b.x + 0.05, y: b.y + 0.02, w: b.w - 0.1, h: 0.32,
      fontSize: 6.5, fontFace: "Microsoft YaHei",
      color: "2D8A6A", bold: true, wrap: true, valign: "middle" });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C11. 波特三角策略模型

**视觉特征**：中央大三角形（三分区），代表3种基本竞争战略（成本领先/差异化/集中化），左侧4项ABCD定义框，右侧说明文字

```javascript
function createPorterStrategiesSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 22, "波特的三种基本竞争战略模型", "Porter's Generic Strategies Model");

  // 三角形（叠加矩形+色块模拟3D三棱柱）
  // 顶部三角
  slide.addShape("rect", { x: 3.0, y: 0.8, w: 3.5, h: 1.5,
    fill: { type: "gradient", stops: [{ position: 0, color: "A5D6A7" }, { position: 100, color: "4CAF50" }] },
    line: { color: "2D8A6A", width: 0.8 } });
  slide.addShape("oval", { x: 4.0, y: 1.2, w: 1.5, h: 1.5, fill: { color: "FFFFFF" }, line: { color: "2D8A6A", width: 0.8 } });
  slide.addText("1\n成本领先策略", { x: 4.0, y: 1.2, w: 1.5, h: 1.5, fontSize: 10, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true, align: "center", valign: "middle" });

  // 左下三角
  slide.addShape("rect", { x: 2.0, y: 2.5, w: 2.0, h: 1.8,
    fill: { type: "gradient", stops: [{ position: 0, color: "C8E6C9" }, { position: 100, color: "2D8A6A" }] },
    line: { color: "1B5E4A", width: 0.8 } });
  slide.addShape("oval", { x: 2.2, y: 3.0, w: 1.6, h: 1.6, fill: { color: "FFFFFF" }, line: { color: "2D8A6A", width: 0.8 } });
  slide.addText("2\n差异化策略", { x: 2.2, y: 3.0, w: 1.6, h: 1.6, fontSize: 10, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true, align: "center", valign: "middle" });

  // 右下三角
  slide.addShape("rect", { x: 5.5, y: 2.5, w: 2.0, h: 1.8,
    fill: { type: "gradient", stops: [{ position: 0, color: "C8E6C9" }, { position: 100, color: "2D8A6A" }] },
    line: { color: "1B5E4A", width: 0.8 } });
  slide.addShape("oval", { x: 5.7, y: 3.0, w: 1.6, h: 1.6, fill: { color: "FFFFFF" }, line: { color: "2D8A6A", width: 0.8 } });
  slide.addText("3\n集中化策略", { x: 5.7, y: 3.0, w: 1.6, h: 1.6, fontSize: 10, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true, align: "center", valign: "middle" });

  // 左侧ABCD定义框
  const items = [
    { letter: "A", text: "定义与目标" },
    { letter: "B", text: "实施方法" },
    { letter: "C", text: "竞争优势" },
    { letter: "D", text: "风险与挑战" }
  ];
  items.forEach((item, i) => {
    const y = 0.85 + i * 0.9;
    slide.addShape("oval", { x: 0.2, y, w: 0.35, h: 0.35, fill: { color: "2D8A6A" }, line: { color: "2D8A6A" } });
    slide.addText(item.letter, { x: 0.2, y, w: 0.35, h: 0.35, fontSize: 10, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    slide.addText(item.text, { x: 0.65, y: y + 0.04, w: 1.2, h: 0.28, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333" });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

## C12. 四象限决策优先级

**视觉特征**：2×2矩阵（紧急×重要），4个任务象限（A/B/C/D），右侧任务优先级评分表格

```javascript
function createQuadrantDecisionSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  addInsightXHeader(slide, pres, 53, "四象限决策法模型", "Four Quadrants Decision Model");

  // 优先级标题行
  const priorityTabs = ["优先级", "紧急和重要", "不紧急但重要", "不紧急也不重要", "紧急但不重要"];
  priorityTabs.forEach((t, i) => {
    slide.addShape("rect", { x: 0.2 + i * 1.2, y: 0.75, w: 1.15, h: 0.28,
      fill: { color: i === 0 ? "2D8A6A" : "F0FAF7" },
      line: { color: i === 0 ? "2D8A6A" : "CCEECC", width: 0.3 } });
    slide.addText(t, { x: 0.2 + i * 1.2, y: 0.75, w: 1.15, h: 0.28,
      fontSize: 6.5, fontFace: "Microsoft YaHei",
      color: i === 0 ? "FFFFFF" : "2D8A6A", align: "center", valign: "middle" });
  });

  // 四象限矩阵
  const quadrants = [
    { label: "任务 A", x: 0.2, y: 1.1 },
    { label: "任务 C", x: 2.7, y: 1.1 },
    { label: "任务 B", x: 0.2, y: 2.75 },
    { label: "任务 D", x: 2.7, y: 2.75 }
  ];
  quadrants.forEach(q => {
    slide.addShape("rect", { x: q.x, y: q.y, w: 2.35, h: 1.55,
      fill: { color: "F0FAF7" }, line: { color: "CCEECC", width: 0.5 } });
    slide.addText(q.label, { x: q.x, y: q.y + 0.55, w: 2.35, h: 0.5,
      fontSize: 20, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true, align: "center" });
  });

  // 坐标轴
  slide.addShape("line", { x: 0.2, y: 2.88, w: 5.0, h: 0, line: { color: "2D8A6A", width: 1.0 } });
  slide.addShape("line", { x: 2.73, y: 1.1, w: 0, h: 3.2, line: { color: "2D8A6A", width: 1.0 } });
  slide.addText("重要 ↑", { x: 0.2, y: 1.1, w: 0.5, h: 0.3, fontSize: 8, fontFace: "Microsoft YaHei", color: "2D8A6A", bold: true });
  slide.addText("不紧急 →", { x: 4.5, y: 4.4, w: 0.8, h: 0.25, fontSize: 8, fontFace: "Microsoft YaHei", color: "2D8A6A" });

  // 右侧任务评分表
  slide.addShape("line", { x: 5.4, y: 0.75, w: 0, h: 4.5, line: { color: "EEEEEE", width: 0.5 } });
  const headers2 = ["项目名称", "预计小时数", "工作强度", "任务权重", "综合分数"];
  headers2.forEach((h, i) => {
    slide.addShape("rect", { x: 5.5 + i * 0.9, y: 0.75, w: 0.88, h: 0.28,
      fill: { color: "F5F5F5" }, line: { color: "EEEEEE", width: 0.3 } });
    slide.addText(h, { x: 5.5 + i * 0.9, y: 0.75, w: 0.88, h: 0.28, fontSize: 6.5, fontFace: "Microsoft YaHei", color: "555555", align: "center", valign: "middle" });
  });
  const tasks2 = [
    ["任务 A", "190 hour", "3", "4", "7"],
    ["任务 B", "120 hour", "2", "2", "4"],
    ["任务 C", "175 hour", "3", "3", "6"],
    ["任务 D", "48 hour", "1", "1", "2"]
  ];
  tasks2.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const y2 = 1.12 + ri * 0.65;
      slide.addShape("roundRect", { x: 5.5 + ci * 0.9, y: y2, w: 0.88, h: 0.5,
        fill: { color: "FAFAFA" }, line: { color: "EEEEEE", width: 0.3 }, rectRadius: 0.05 });
      slide.addText(cell, { x: 5.5 + ci * 0.9, y: y2, w: 0.88, h: 0.5, fontSize: ci === 0 ? 8 : 11, fontFace: ci === 0 ? "Microsoft YaHei" : "Arial", color: ci === 0 ? "2D8A6A" : "333333", bold: ci === 0, align: "center", valign: "middle" });
    });
  });

  addInsightXFooter(slide, pres);
  return slide;
}
```

---

### 🔴 风格D：贝恩红（Bain风格）
- [D1. 代际对比双栏页](#d1-代际对比双栏页)
- [D2. 消费特征卡片页](#d2-消费特征卡片页)
- [D3. 行业洞察表格页](#d3-行业洞察表格页)

### 🔵 风格E：埃森哲蓝（Accenture/世界经济论坛风格）
- [E1. 数字化转型框架页](#e1-数字化转型框架页)
- [E2. 环形战略模型页](#e2-环形战略模型页)
- [E3. 成本趋势分析页](#e3-成本趋势分析页)
- [E4. 价值链分析页](#e4-价值链分析页)

### 🟠 风格F：消费者橙（Bain/消费者研究风格）
- [F1. 消费者旅程漏斗页](#f1-消费者旅程漏斗页)
- [F2. 行为细分漏斗页](#f2-行为细分漏斗页)
- [F3. 消费者需求金字塔页](#f3-消费者需求金字塔页)
- [F4. 行为经济学卡片页](#f4-行为经济学卡片页)

### 🔷 风格G：数据科技蓝（科技/数据报告风格）
- [G1. KPI仪表板页](#g1-kpi仪表板页)
- [G2. 信息流时间线页](#g2-信息流时间线页)
- [G3. 阶梯式增长图页](#g3-阶梯式增长图页)

---

# 风格D：贝恩红（Bain风格）

> 主色 `#C41E3A`，深红+浅红配色，高对比度数据展示

## D1. 代际对比双栏页

**特征**：左右双栏对比布局，顶部标签栏，不同代际特征卡片

```javascript
function createGenComparisonSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const red = "C41E3A";
  const lightRed = "FDEAEA";
  
  // 顶部标题条
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: lightRed }, line: { color: red, width: 0.5 } });
  
  // 左侧代际标签
  slide.addShape("rect", { x: 0.3, y: 0.7, w: 1.2, h: 0.4, fill: { color: red }, line: { color: red } });
  slide.addText("MILLENNIALS", { x: 0.3, y: 0.75, w: 1.2, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF", align: "center", bold: true });
  
  // 右侧代际标签
  slide.addShape("rect", { x: 5.3, y: 0.7, w: 1.2, h: 0.4, fill: { color: red }, line: { color: red } });
  slide.addText("GEN Z", { x: 5.3, y: 0.75, w: 1.2, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF", align: "center", bold: true });
  
  // 左侧特征卡片
  const leftCards = ["数字化原生代", "社交媒体活跃", "追求个性化", "环保意识强"];
  leftCards.forEach((c, i) => {
    slide.addShape("rect", { x: 0.3, y: 1.3 + i * 0.9, w: 4.3, h: 0.75, fill: { color: "FAFAFA" }, line: { color: "DDDDDD", width: 0.5 } });
    slide.addText(c, { x: 0.5, y: 1.5 + i * 0.9, w: 4, h: 0.35, fontSize: 12, fontFace: "Microsoft YaHei", color: "333333" });
  });
  
  // 右侧特征卡片
  const rightCards = ["移动端优先", "短视频偏好", "体验式消费", "社会责任关注"];
  rightCards.forEach((c, i) => {
    slide.addShape("rect", { x: 5.3, y: 1.3 + i * 0.9, w: 4.3, h: 0.75, fill: { color: "FAFAFA" }, line: { color: "DDDDDD", width: 0.5 } });
    slide.addText(c, { x: 5.5, y: 1.5 + i * 0.9, w: 4, h: 0.35, fontSize: 12, fontFace: "Microsoft YaHei", color: "333333" });
  });
  
  return slide;
}
```

---

## D2. 消费特征卡片页

**特征**：多列卡片布局，顶部色块+图标+文字

```javascript
function createFeatureCardsSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const red = "C41E3A";
  
  // 标题
  slide.addText("消费者关键特征", { x: 0.4, y: 0.8, w: 5, h: 0.5, fontSize: 24, fontFace: "Microsoft YaHei", color: red, bold: true });
  
  // 卡片数据
  const cards = [
    { title: "便利性", desc: "随时随地购物体验", icon: "⬡" },
    { title: "个性化", desc: "定制化产品服务", icon: "⬡" },
    { title: "社交化", desc: "分享推荐决策", icon: "⬡" },
    { title: "可持续", desc: "环保消费选择", icon: "⬡" }
  ];
  
  cards.forEach((c, i) => {
    const x = 0.4 + i * 2.35;
    slide.addShape("rect", { x: x, y: 1.5, w: 2.1, h: 3.2, fill: { color: "FAFAFA" }, line: { color: "EEEEEE", width: 0.5 } });
    slide.addShape("rect", { x: x, y: 1.5, w: 2.1, h: 0.6, fill: { color: red }, line: { color: red } });
    slide.addText(c.title, { x: x, y: 1.6, w: 2.1, h: 0.45, fontSize: 12, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", bold: true });
    slide.addText(c.desc, { x: x + 0.1, y: 2.3, w: 1.9, h: 0.8, fontSize: 11, fontFace: "Microsoft YaHei", color: "333333", align: "center" });
  });
  
  return slide;
}
```

---

## D3. 行业洞察表格页

**特征**：多列表格，条形图内置，底部汇总

```javascript
function createIndustryInsightTable(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const red = "C41E3A";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: red }, line: { color: red } });
  slide.addText("行业价值分析 | INDUSTRY VALUE ANALYSIS", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 10, fontFace: "Arial", color: "FFFFFF" });
  
  // 表格
  const headers = ["行业", "市场规模", "增长率", "利润率", "价值"];
  const data = [["制造业", "¥12.5万亿", "+8.2%", "12.5%", 65], ["服务业", "¥8.2万亿", "+12.5%", "18.2%", 80], ["科技业", "¥5.8万亿", "+15.8%", "22.5%", 95]];
  
  headers.forEach((h, i) => {
    const x = 0.3 + i * 1.9;
    slide.addShape("rect", { x: x, y: 0.7, w: 1.8, h: 0.4, fill: { color: "F5F5F5" }, line: { color: "DDDDDD" } });
    slide.addText(h, { x: x, y: 0.75, w: 1.8, h: 0.3, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "center", bold: true });
  });
  
  data.forEach((row, ri) => {
    const y = 1.2 + ri * 0.8;
    row.forEach((cell, ci) => {
      const x = 0.3 + ci * 1.9;
      if (ci === 4) {
        // 条形图
        const barW = cell * 0.08;
        slide.addShape("rect", { x: x, y: y + 0.15, w: barW, h: 0.35, fill: { color: red }, line: { color: red } });
        slide.addText(cell + "%", { x: x + barW + 0.1, y: y + 0.15, w: 0.6, h: 0.35, fontSize: 9, fontFace: "Arial", color: "333333" });
      } else {
        slide.addText(cell, { x: x, y: y + 0.15, w: 1.8, h: 0.35, fontSize: 10, fontFace: ci === 0 ? "Microsoft YaHei" : "Arial", color: "333333", align: "center" });
      }
    });
  });
  
  return slide;
}
```

---

# 风格E：埃森哲蓝（Accenture风格）

> 主色 `#0369A1`，深蓝+浅蓝配色，科技感，数字化转型

## E1. 数字化转型框架页

**特征**：流程图布局，方框+箭头+说明文字

```javascript
function createDigitalFrameworkSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "0369A1";
  const lightBlue = "E3F2FD";
  
  // 顶部
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: lightBlue }, line: { color: blue, width: 0.5 } });
  slide.addText("数字化转型框架 | DIGITAL TRANSFORMATION FRAMEWORK", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: blue });
  
  // 标题
  slide.addText("数字化转型四阶段", { x: 0.4, y: 0.7, w: 5, h: 0.5, fontSize: 22, fontFace: "Microsoft YaHei", color: blue, bold: true });
  
  // 四个阶段
  const stages = [
    { title: "评估", desc: "现状诊断\n差距分析" },
    { title: "规划", desc: "路线图制定\n资源配置" },
    { title: "实施", desc: "系统建设\n流程优化" },
    { title: "优化", desc: "持续迭代\n效果评估" }
  ];
  
  stages.forEach((s, i) => {
    const x = 0.4 + i * 2.4;
    slide.addShape("roundRect", { x: x, y: 1.4, w: 2.1, h: 2.8, fill: { color: "FAFAFA" }, line: { color: blue, width: 1 }, rectRadius: 0.1 });
    slide.addShape("rect", { x: x, y: 1.4, w: 2.1, h: 0.6, fill: { color: blue }, line: { color: blue } });
    slide.addText(s.title, { x: x, y: 1.5, w: 2.1, h: 0.45, fontSize: 14, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", bold: true });
    slide.addText(s.desc, { x: x + 0.1, y: 2.2, w: 1.9, h: 1.2, fontSize: 11, fontFace: "Microsoft YaHei", color: "333333", align: "center", lineSpacingMultiple: 1.4 });
    
    // 箭头
    if (i < 3) {
      slide.addText("→", { x: x + 2.1, y: 2.5, w: 0.3, h: 0.4, fontSize: 18, fontFace: "Arial", color: blue, align: "center" });
    }
  });
  
  return slide;
}
```

---

## E2. 环形战略模型页

**特征**：中心辐射状布局，环形/扇形图

```javascript
function createRadialStrategySlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "0369A1";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: blue }, line: { color: blue } });
  slide.addText("战略布局 | STRATEGIC LAYOUT", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF" });
  
  // 中心圆
  slide.addShape("oval", { x: 4.0, y: 2.0, w: 2.0, h: 2.0, fill: { color: blue }, line: { color: blue, width: 1 } });
  slide.addText("核心\n能力", { x: 4.0, y: 2.6, w: 2.0, h: 0.8, fontSize: 12, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", valign: "middle", bold: true });
  
  // 四个方向辐射
  const directions = [
    { x: 1.5, y: 1.2, label: "技术创新" },
    { x: 6.5, y: 1.2, label: "市场拓展" },
    { x: 1.5, y: 4.0, label: "人才发展" },
    { x: 6.5, y: 4.0, label: "运营优化" }
  ];
  
  directions.forEach(d => {
    slide.addShape("oval", { x: d.x, y: d.y, w: 1.3, h: 1.3, fill: { color: "E3F2FD" }, line: { color: blue, width: 1 } });
    slide.addText(d.label, { x: d.x, y: d.y + 0.4, w: 1.3, h: 0.5, fontSize: 10, fontFace: "Microsoft YaHei", color: blue, align: "center", bold: true });
  });
  
  // 连接线
  directions.forEach(d => {
    slide.addShape("line", { x: d.x + 0.65, y: d.y + 0.65, w: 4.0 - d.x, h: 3.0 - d.y, line: { color: blue, width: 0.5, dashType: "dash" } });
  });
  
  return slide;
}
```

---

## E3. 成本趋势分析页

**特征**：趋势线图+关键数字标注+图标

```javascript
function createCostTrendSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "0369A1";
  const lightBlue = "E3F2FD";
  
  // 标题
  slide.addText("技术成本下降趋势", { x: 0.4, y: 0.8, w: 5, h: 0.5, fontSize: 22, fontFace: "Microsoft YaHei", color: blue, bold: true });
  
  // 左侧KPI
  const kpis = [
    { label: "云计算成本", value: "-65%", trend: "↓" },
    { label: "AI算力", value: "-48%", trend: "↓" },
    { label: "存储成本", value: "-72%", trend: "↓" }
  ];
  
  kpis.forEach((k, i) => {
    const y = 1.5 + i * 1.0;
    slide.addShape("rect", { x: 0.4, y: y, w: 2.5, h: 0.8, fill: { color: lightBlue }, line: { color: blue, width: 0.5 } });
    slide.addText(k.label, { x: 0.5, y: y + 0.1, w: 2.3, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: "666666" });
    slide.addText(k.value, { x: 0.5, y: y + 0.4, w: 2.3, h: 0.35, fontSize: 20, fontFace: "Arial", color: blue, bold: true });
  });
  
  // 右侧趋势图
  slide.addShape("rect", { x: 3.2, y: 1.5, w: 6.3, h: 3.5, fill: { color: "FAFAFA" }, line: { color: "DDDDDD", width: 0.5 } });
  
  // 简化趋势线
  const points = [[3.5, 4.2], [4.5, 3.8], [5.5, 3.2], [6.5, 2.6], [7.5, 2.0], [8.5, 1.5], [9.2, 1.2]];
  points.forEach((p, i) => {
    if (i > 0) {
      slide.addShape("line", { x: points[i-1][0], y: points[i-1][1], w: p[0] - points[i-1][0], h: p[1] - points[i-1][1], line: { color: blue, width: 2 } });
    }
  });
  
  // X轴标签
  const years = ["2020", "2021", "2022", "2023", "2024", "2025E"];
  years.forEach((yr, i) => {
    slide.addText(yr, { x: 3.3 + i * 1.0, y: 4.6, w: 0.9, h: 0.25, fontSize: 8, fontFace: "Arial", color: "666666", align: "center" });
  });
  
  return slide;
}
```

---

## E4. 价值链分析页

**特征**：横向流程+上方活动+下方支持活动

```javascript
function createValueChainSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "0369A1";
  const lightBlue = "E3F2FD";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: blue }, line: { color: blue } });
  slide.addText("价值链分析 | VALUE CHAIN ANALYSIS", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF" });
  
  // 主要活动
  const mainActivities = ["采购", "生产", "物流", "营销", "销售", "服务"];
  mainActivities.forEach((a, i) => {
    const x = 0.3 + i * 1.55;
    slide.addShape("roundRect", { x: x, y: 1.3, w: 1.35, h: 0.7, fill: { color: lightBlue }, line: { color: blue, width: 0.5 }, rectRadius: 0.05 });
    slide.addText(a, { x: x, y: 1.45, w: 1.35, h: 0.4, fontSize: 9, fontFace: "Microsoft YaHei", color: blue, align: "center", bold: true });
    
    if (i < 5) {
      slide.addText("→", { x: x + 1.35, y: 1.45, w: 0.2, h: 0.4, fontSize: 12, fontFace: "Arial", color: blue, align: "center" });
    }
  });
  
  // 中心双线
  slide.addShape("line", { x: 0.3, y: 2.2, w: 9.4, h: 0, line: { color: blue, width: 1 } });
  slide.addShape("line", { x: 0.3, y: 2.5, w: 9.4, h: 0, line: { color: blue, width: 1 } });
  slide.addText("支持活动", { x: 0.3, y: 2.25, w: 1.5, h: 0.2, fontSize: 7, fontFace: "Microsoft YaHei", color: "666666" });
  
  // 支持活动
  const supportActivities = ["基础设施", "人力资源", "技术开发", "采购管理"];
  supportActivities.forEach((a, i) => {
    const x = 2.0 + i * 2.0;
    slide.addShape("rect", { x: x, y: 2.65, w: 1.8, h: 0.5, fill: { color: "F5F5F5" }, line: { color: "CCCCCC", width: 0.5 } });
    slide.addText(a, { x: x, y: 2.75, w: 1.8, h: 0.3, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "center" });
  });
  
  // 底部利润
  slide.addShape("rect", { x: 0.3, y: 3.4, w: 9.4, h: 0.5, fill: { color: blue }, line: { color: blue } });
  slide.addText("利润 | PROFIT", { x: 0.3, y: 3.5, w: 9.4, h: 0.35, fontSize: 11, fontFace: "Arial", color: "FFFFFF", align: "center", bold: true });
  
  return slide;
}
```

---

# 风格F：消费者橙（Bain消费者研究风格）

> 主色 `#E65100`，橙色+珊瑚色配色，消费者行为研究

## F1. 消费者旅程漏斗页

**特征**：漏斗形状从上到下，消费者触点+转化率

```javascript
function createConsumerJourneyFunnelSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const orange = "E65100";
  const lightOrange = "FFF3E0";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: lightOrange }, line: { color: orange, width: 0.5 } });
  slide.addText("消费者旅程 | CONSUMER JOURNEY", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: orange });
  
  // 漏斗阶段
  const stages = [
    { name: "认知", rate: "100%", width: 8.0 },
    { name: "兴趣", rate: "65%", width: 6.5 },
    { name: "考虑", rate: "40%", width: 5.0 },
    { name: "购买", rate: "25%", width: 3.5 },
    { name: "忠诚", rate: "15%", width: 2.5 }
  ];
  
  stages.forEach((s, i) => {
    const x = (10 - s.width) / 2;
    const y = 0.8 + i * 0.65;
    slide.addShape("rect", { x: x, y: y, w: s.width, h: 0.55, fill: { color: lightOrange }, line: { color: orange, width: 1 } });
    slide.addText(s.name, { x: x + 0.2, y: y + 0.1, w: s.width * 0.5, h: 0.35, fontSize: 12, fontFace: "Microsoft YaHei", color: orange, bold: true });
    slide.addText(s.rate, { x: x + s.width - 0.8, y: y + 0.1, w: 0.7, h: 0.35, fontSize: 11, fontFace: "Arial", color: orange, align: "right" });
  });
  
  return slide;
}
```

---

## F2. 行为细分漏斗页

**特征**：多层级漏斗，每层有细分标签

```javascript
function createBehaviorFunnelSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const orange = "E65100";
  const lightOrange = "FFF8E1";
  
  // 标题
  slide.addText("行为细分模型", { x: 0.4, y: 0.7, w: 4, h: 0.5, fontSize: 22, fontFace: "Microsoft YaHei", color: orange, bold: true });
  
  // 漏斗层级
  const layers = [
    { label: "全部用户", sub: "100%", color: "FFECB3" },
    { label: "活跃用户", sub: "68%", color: "FFE082" },
    { label: "核心用户", sub: "35%", color: "FFCA28" },
    { label: "超级用户", sub: "12%", color: "FFA000" }
  ];
  
  layers.forEach((l, i) => {
    const y = 1.4 + i * 0.85;
    const w = 9 - i * 1.5;
    const x = (10 - w) / 2;
    
    slide.addShape("rect", { x: x, y: y, w: w, h: 0.7, fill: { color: l.color }, line: { color: orange, width: 0.5 } });
    slide.addText(l.label, { x: x + 0.2, y: y + 0.15, w: w * 0.6, h: 0.4, fontSize: 13, fontFace: "Microsoft YaHei", color: "333333", bold: true });
    slide.addText(l.sub, { x: x + w - 1.0, y: y + 0.15, w: 0.8, h: 0.4, fontSize: 14, fontFace: "Arial", color: orange, bold: true, align: "right" });
  });
  
  return slide;
}
```

---

## F3. 消费者需求金字塔页

**特征**：金字塔层级结构，从基础到高级需求

```javascript
function createNeedsPyramidSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const orange = "E65100";
  const colors = ["FFECB3", "FFCA28", "FFA000", "FF6F00"];
  
  // 标题
  slide.addText("消费者需求层次", { x: 0.4, y: 0.6, w: 5, h: 0.5, fontSize: 22, fontFace: "Microsoft YaHei", color: orange, bold: true });
  
  // 金字塔层级（从下到上）
  const levels = [
    { name: "自我实现", items: ["个性化", "品牌认同"] },
    { name: "尊重需求", items: ["社会地位", "成就感"] },
    { name: "社交需求", items: ["归属感", "人际关系"] },
    { name: "安全需求", items: ["产品安全", "售后服务"] },
    { name: "基础需求", items: ["功能实用", "价格合理"] }
  ];
  
  levels.forEach((l, i) => {
    const y = 4.2 - i * 0.7;
    const w = 1.8 + i * 0.5;
    const x = (10 - w) / 2;
    
    slide.addShape("rect", { x: x, y: y, w: w, h: 0.65, fill: { color: colors[i] }, line: { color: orange, width: 0.5 } });
    slide.addText(l.name, { x: x, y: y + 0.15, w: w, h: 0.35, fontSize: 10, fontFace: "Microsoft YaHei", color: "333333", align: "center", bold: true });
  });
  
  return slide;
}
```

---

## F4. 行为经济学卡片页

**特征**：多列卡片布局，每张卡片一个原理+解释

```javascript
function createBehavioralCardsSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const orange = "E65100";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: orange }, line: { color: orange } });
  slide.addText("行为经济学原理 | BEHAVIORAL ECONOMICS", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: "FFFFFF" });
  
  // 卡片数据
  const cards = [
    { principle: "锚定效应", desc: "消费者对最初接触的价格印象深刻，以此为基准做决策" },
    { principle: "损失厌恶", desc: "对损失的敏感度高于同等收益，更愿意避免损失" },
    { principle: "默认选项", desc: "人们倾向于保持默认设置，利用默认选项引导选择" },
    { principle: "社会认同", desc: "参考他人行为做决策，特别是相似群体" }
  ];
  
  cards.forEach((c, i) => {
    const x = 0.3 + i * 2.4;
    slide.addShape("rect", { x: x, y: 0.8, w: 2.2, h: 3.0, fill: { color: "FAFAFA" }, line: { color: "DDDDDD", width: 0.5 } });
    slide.addShape("rect", { x: x, y: 0.8, w: 2.2, h: 0.5, fill: { color: orange }, line: { color: orange } });
    slide.addText(c.principle, { x: x, y: 0.85, w: 2.2, h: 0.4, fontSize: 11, fontFace: "Microsoft YaHei", color: "FFFFFF", align: "center", bold: true });
    slide.addText(c.desc, { x: x + 0.1, y: 1.5, w: 2.0, h: 2.0, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "left", valign: "top" });
  });
  
  return slide;
}
```

---

# 风格G：数据科技蓝（科技/数据报告风格）

> 主色 `#1A237E`，深蓝+浅蓝配色，数据仪表板风格

## G1. KPI仪表板页

**特征**：多个KPI卡片，每个卡片包含数字+变化趋势+迷你图表

```javascript
function createKPIDashboardSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "1A237E";
  const lightBlue = "E8EAF6";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: lightBlue }, line: { color: blue, width: 0.5 } });
  slide.addText("关键绩效指标 | KPI DASHBOARD", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: blue });
  
  // KPI数据
  const kpis = [
    { label: "总营收", value: "¥2.8亿", change: "+23%", up: true },
    { label: "活跃用户", value: "156K", change: "+15%", up: true },
    { label: "转化率", value: "3.2%", change: "-0.5%", up: false },
    { label: "客单价", value: "¥580", change: "+8%", up: true }
  ];
  
  kpis.forEach((k, i) => {
    const x = 0.3 + i * 2.4;
    slide.addShape("rect", { x: x, y: 0.8, w: 2.2, h: 2.0, fill: { color: "FAFAFA" }, line: { color: "EEEEEE", width: 0.5 } });
    slide.addText(k.label, { x: x + 0.1, y: 0.9, w: 2.0, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: "666666" });
    slide.addText(k.value, { x: x + 0.1, y: 1.2, w: 2.0, h: 0.5, fontSize: 20, fontFace: "Arial", color: blue, bold: true });
    
    const changeColor = k.up ? "4CAF50" : "F44336";
    slide.addText(k.change, { x: x + 0.1, y: 1.8, w: 2.0, h: 0.3, fontSize: 11, fontFace: "Arial", color: changeColor, bold: true });
  });
  
  // 底部趋势图区域
  slide.addShape("rect", { x: 0.3, y: 3.0, w: 9.4, h: 1.8, fill: { color: lightBlue }, line: { color: blue, width: 0.3 } });
  slide.addText("月度营收趋势", { x: 0.5, y: 3.1, w: 2, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: blue });
  
  // 简化柱状图
  const months = ["1月", "2月", "3月", "4月", "5月", "6月"];
  const values = [35, 42, 38, 55, 48, 62];
  months.forEach((m, i) => {
    const barH = values[i] * 0.025;
    const x = 0.8 + i * 1.4;
    slide.addShape("rect", { x: x, y: 4.2 - barH, w: 0.8, h: barH, fill: { color: blue }, line: { color: blue } });
    slide.addText(m, { x: x, y: 4.3, w: 0.8, h: 0.25, fontSize: 7, fontFace: "Arial", color: "666666", align: "center" });
  });
  
  return slide;
}
```

---

## G2. 信息流时间线页

**特征**：横向时间轴，节点+说明文字

```javascript
function createInfoTimelineSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "1A237E";
  const lightBlue = "E8EAF6";
  
  // 标题
  slide.addText("信息流时间线", { x: 0.4, y: 0.7, w: 4, h: 0.5, fontSize: 22, fontFace: "Microsoft YaHei", color: blue, bold: true });
  
  // 时间轴线
  slide.addShape("line", { x: 0.5, y: 2.8, w: 9.0, h: 0, line: { color: blue, width: 2 } });
  
  // 时间节点
  const nodes = [
    { date: "Q1", title: "产品上线", desc: "MVP版本发布" },
    { date: "Q2", title: "用户增长", desc: "突破10万用户" },
    { date: "Q3", title: "功能迭代", desc: "V2.0发布" },
    { date: "Q4", title: "市场扩张", desc: "拓展新区域" }
  ];
  
  nodes.forEach((n, i) => {
    const x = 0.8 + i * 2.3;
    
    // 节点圆点
    slide.addShape("oval", { x: x, y: 2.7, w: 0.2, h: 0.2, fill: { color: blue }, line: { color: blue } });
    
    // 节点说明（上方）
    slide.addShape("rect", { x: x - 0.4, y: 1.3, w: 1.8, h: 1.2, fill: { color: lightBlue }, line: { color: blue, width: 0.3 } });
    slide.addText(n.date, { x: x - 0.4, y: 1.4, w: 1.8, h: 0.25, fontSize: 9, fontFace: "Arial", color: blue, align: "center", bold: true });
    slide.addText(n.title, { x: x - 0.3, y: 1.65, w: 1.6, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: "333333", align: "center", bold: true });
    slide.addText(n.desc, { x: x - 0.3, y: 1.95, w: 1.6, h: 0.35, fontSize: 8, fontFace: "Microsoft YaHei", color: "666666", align: "center" });
  });
  
  return slide;
}
```

---

## G3. 阶梯式增长图页

**特征**：阶梯形柱状图，展示阶段性增长

```javascript
function createStepGrowthSlide(pres) {
  const slide = pres.addSlide();
  slide.background = { color: "FFFFFF" };
  
  const blue = "1A237E";
  const lightBlue = "C5CAE9";
  
  // 标题
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.5, fill: { color: lightBlue }, line: { color: blue, width: 0.5 } });
  slide.addText("阶梯式增长模型 | STEP GROWTH MODEL", { x: 0.2, y: 0.1, w: 9, h: 0.3, fontSize: 9, fontFace: "Arial", color: blue });
  
  // 阶梯数据
  const steps = [
    { label: "阶段1\n探索期", value: 20 },
    { label: "阶段2\n成长期", value: 45 },
    { label: "阶段3\n扩张期", value: 70 },
    { label: "阶段4\n成熟期", value: 95 }
  ];
  
  steps.forEach((s, i) => {
    const x = 0.5 + i * 2.3;
    const h = s.value * 0.035;
    
    // 阶梯柱
    slide.addShape("rect", { x: x, y: 4.3 - h, w: 1.8, h: h, fill: { color: blue }, line: { color: blue } });
    
    // 标签
    slide.addText(s.label, { x: x, y: 4.4, w: 1.8, h: 0.5, fontSize: 9, fontFace: "Microsoft YaHei", color: "333333", align: "center" });
    
    // 数值
    slide.addText(s.value + "%", { x: x, y: 4.3 - h - 0.35, w: 1.8, h: 0.3, fontSize: 14, fontFace: "Arial", color: blue, align: "center", bold: true });
  });
  
  // 底部说明
  slide.addText("通过阶段性增长实现可持续业务扩张", { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: 10, fontFace: "Microsoft YaHei", color: "666666", align: "center" });
  
  return slide;
}
```

---

## 辅助函数（渐变色 + 线条层级 + 智能图标）

```javascript
// ============================================
// 渐变色系统 - officegen版本
// 注意：PptxGenJS不支持渐变，本技能使用officegen实现渐变
// ============================================

/**
 * 创建officegen渐变色配置
 * @param {string} color1 - 起始颜色（6位hex，不带#）
 * @param {string} color2 - 结束颜色（6位hex，不带#）
 * @param {number} angle - 渐变角度（可选，默认90垂直）
 * @returns {object} - officegen渐变填充对象
 */
function createGradient(color1, color2, angle = 90) {
  return {
    type: "gradient",
    color: [
      { position: 0, color: color1 },
      { position: 100, color: color2 }
    ],
    angle: angle  // 角度：0-360
  };
}

/**
 * 创建3色渐变
 */
function createGradient3(color1, color2, color3, angle = 90) {
  return {
    type: "gradient",
    color: [
      { position: 0, color: color1 },
      { position: 50, color: color2 },
      { position: 100, color: color3 }
    ],
    angle: angle
  };
}

// 预定义渐变色（基于各风格主题）
const GRADIENTS = {
  // 风格A：咨询青绿色系
  teal: {
    light: createGradient("B2DEDD", "00A69C", 90),    // 浅→深青
    deep: createGradient("00A69C", "007A6A", 180),     // 深青
    accent: createGradient("00A69C", "2D8A7A", 45),   // 斜向强调
    three: createGradient3("B2DEDD", "6BC9C3", "00A69C", 90), // 3色渐变
  },
  
  // 风格B：职场汇报紫色系
  purple: {
    light: createGradient("D1C4E9", "7B5EA7", 90),
    deep: createGradient("7B5EA7", "4527A0", 180),
    accent: createGradient("9575CD", "7B5EA7", 45),
    three: createGradient3("D1C4E9", "9575CD", "7B5EA7", 90),
  },
  
  // 风格C：商业绿色系
  green: {
    light: createGradient("C8E6C9", "2D8A6A", 90),
    deep: createGradient("2D8A6A", "1B5E4A", 180),
    accent: createGradient("4CAF50", "2D8A6A", 45),
    three: createGradient3("C8E6C9", "66BB6A", "2D8A6A", 90),
  },
  
  // 风格D：贝恩红系
  red: {
    light: createGradient("FFCDD2", "C41E3A", 90),
    deep: createGradient("C41E3A", "8B0000", 180),
    accent: createGradient("E53935", "C41E3A", 45),
    three: createGradient3("FFCDD2", "EF5350", "C41E3A", 90),
  },
  
  // 风格E：埃森哲蓝色系
  blue: {
    light: createGradient("BBDEFB", "0369A1", 90),
    deep: createGradient("0369A1", "01579B", 180),
    accent: createGradient("0288D1", "0369A1", 45),
    three: createGradient3("BBDEFB", "64B5F6", "0369A1", 90),
  },
  
  // 风格F：消费者橙色系
  orange: {
    light: createGradient("FFE0B2", "E65100", 90),
    deep: createGradient("E65100", "BF360C", 180),
    accent: createGradient("FF9800", "E65100", 45),
    three: createGradient3("FFE0B2", "FFB74D", "E65100", 90),
  },
  
  // 风格G：数据科技蓝色系
  techBlue: {
    light: createGradient("C5CAE9", "1A237E", 90),
    deep: createGradient("1A237E", "0D1442", 180),
    accent: createGradient("3949AB", "1A237E", 45),
    three: createGradient3("C5CAE9", "7986CB", "1A237E", 90),
  },
  
  // 通用渐变
  neutral: {
    gray: createGradient("F5F5F5", "E0E0E0", 90),
    dark: createGradient("424242", "212121", 180),
    gold: createGradient("FFD54F", "FF8F00", 45),
    goldThree: createGradient3("FFE082", "FFD54F", "FF8F00", 45),
  }
};

// ============================================
// 线条粗细层级系统 - 根据内容重要程度区分
// ============================================
const LINE_WIDTH = {
  // 主标题/重点卡片 - 最粗，强调重要性
  primary: 2.0,      // 2.0 - 主标题边框、重要卡片
  primaryMedium: 1.5, // 1.5 - 次级重点
  
  // 内容区块 - 中等粗细
  content: 1.0,       // 1.0 - 内容卡片、一般区块
  contentThin: 0.8,   // 0.8 - 内容次级分割
  
  // 装饰/细节 - 最细
  decoration: 0.5,    // 0.5 - 装饰线、分隔线
  hairline: 0.25,    // 0.25 - 极细辅助线
  
  // 特殊效果
  dashed: 0.5,        // 0.5 - 虚线边框
};

// 线条粗细速查表
const LINE = {
  // 标题级 - 最醒目
  title: (color = "00A69C") => ({ color, width: LINE_WIDTH.primary, dashType: "solid" }),
  titleMedium: (color = "00A69C") => ({ color, width: LINE_WIDTH.primaryMedium, dashType: "solid" }),
  
  // 内容级 - 清晰可见
  content: (color = "DDDDDD") => ({ color, width: LINE_WIDTH.content, dashType: "solid" }),
  contentDash: (color = "DDDDDD") => ({ color, width: LINE_WIDTH.dashed, dashType: "dash" }),
  
  // 装饰级 - 轻微点缀
  decoration: (color = "EEEEEE") => ({ color, width: LINE_WIDTH.decoration, dashType: "solid" }),
  decorationDash: (color = "EEEEEE") => ({ color, width: LINE_WIDTH.decoration, dashType: "dash" }),
  
  // 极细级 - 几乎看不见，仅用于微调
  hairline: (color = "F5F5F5") => ({ color, width: LINE_WIDTH.hairline, dashType: "solid" }),
};

// 使用示例:
// slide.addShape("rect", { x, y, w, h, line: LINE.title(theme.accent) });
// slide.addShape("rect", { x, y, w, h, line: LINE.content(theme.border) });
// slide.addShape("line", { x1, y1, x2, y2, line: LINE.decoration() });

// ============================================
// 智能图标库 - Unicode符号（专业简洁风格）
// ============================================
const ICONS = {
  // 商业类
  business: "◎", strategy: "◉", growth: "↗", target: "⊙", 
  money: "￥", profit: "＋", revenue: "＝", market: "◈",
  
  // 用户类  
  user: "○", users: "◎", customer: "◇", team: "▣", group: "△",
  person: "●", crowd: "▲",
  
  // 产品类
  product: "□", service: "◇", innovation: "✦", quality: "☆",
  feature: "◆", launch: "✦",
  
  // 数据类
  data: "▦", analytics: "▧", chart: "▤", trend: "↗",
  statistics: "▩", metric: "▨",
  
  // 流程类
  process: "▷", workflow: "⇒", step: "→", cycle: "↻",
  sequence: "─", flow: "→",
  
  // 科技类
  tech: "✎", digital: "✱", cloud: "☁", ai: "◈",
  system: "◎", network: "◉",
  
  // 营销类
  marketing: "◎", brand: "◈", channel: "▷", promotion: "✦",
  advertising: "▢", campaign: "✦",
  
  // 运营类
  operation: "▣", manage: "◆", plan: "▤", result: "✓",
  task: "○", milestone: "●",
  
  // 通用类
  star: "★", fire: "✦", new: "NEW", top: "▲", 
  warning: "⚠", info: "ℹ", check: "✓", cross: "✗",
  right: "→", left: "←", up: "↑", down: "↓",
  link: "↔", external: "↗",
};

// ============================================
// 智能图标匹配 - 根据关键词自动选择图标
// ============================================
const KEYWORD_ICONS = {
  // 增长/业绩相关
  "增长": "↗", "业绩": "◎", "收入": "￥", "营收": "＝",
  "利润": "＋", "盈利": "＋", "KPI": "▨", "目标": "⊙",
  "达成": "✓", "完成": "✓", "超额": "★",
  
  // 用户相关
  "用户": "○", "客户": "◇", "会员": "◎", "团队": "▣",
  "员工": "●", "人才": "★", "人才": "★",
  
  // 产品相关
  "产品": "□", "服务": "◇", "功能": "◆", "创新": "✦",
  "发布": "✦", "上线": "✓", "迭代": "↻",
  
  // 数据相关
  "数据": "▦", "分析": "▧", "趋势": "↗", "统计": "▩",
  "报告": "▤", "指标": "▨", "调研": "◎",
  
  // 流程相关
  "流程": "▷", "步骤": "→", "阶段": "○", "计划": "▤",
  "执行": "▷", "落地": "✓", "复盘": "▣",
  
  // 市场相关
  "市场": "◈", "竞争": "◇", "份额": "▣", "品牌": "◈",
  "营销": "◎", "推广": "✦", "渠道": "▷",
  
  // 风险/问题
  "风险": "⚠", "问题": "⚠", "挑战": "◇", "困难": "△",
  "解决方案": "✓", "策略": "◉",
};

/**
 * 根据关键词智能匹配图标
 * @param {string} text - 输入文本（标题、标签等）
 * @returns {string} - 匹配的图标符号
 */
function getSmartIcon(text) {
  if (!text) return "○";
  const keywords = Object.keys(KEYWORD_ICONS);
  for (const kw of keywords) {
    if (text.includes(kw)) {
      return KEYWORD_ICONS[kw];
    }
  }
  return "○"; // 默认图标
}

/**
 * 在指定位置添加图标
 * @param {object} slide - 幻灯片对象
 * @param {string} iconKey - ICONS中的键名，或关键词（会自动匹配）
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} size - 图标大小（默认0.35）
 * @param {string} color - 颜色（可选）
 * @param {boolean} autoMatch - 是否自动匹配关键词（默认true）
 */
function addIcon(slide, iconKey, x, y, size = 0.35, color = "333333", autoMatch = true) {
  let icon = ICONS[iconKey];
  // 如果没找到或启用了自动匹配
  if (!icon || autoMatch) {
    icon = getSmartIcon(iconKey);
  }
  slide.addText(icon, {
    x: x, y: y, w: size, h: size,
    fontSize: size * 32,  // 简洁符号需要更大字号
    color: color
  });
}

/**
 * 创建带图标的卡片（通用）- 使用层级线条系统
 * @param {object} slide - 幻灯片对象
 * @param {object} opts - 选项 {x, y, w, h, iconKey, title, desc, primaryColor, importance}
 *        importance: "high" | "medium" | "low" 控制边框粗细
 */
function createIconCard(slide, opts) {
  const { x, y, w, h, iconKey, title, desc, primaryColor, importance = "medium" } = opts;
  
  // 根据重要性选择边框粗细
  const borderWidth = importance === "high" ? LINE_WIDTH.primary : 
                      importance === "medium" ? LINE_WIDTH.content : 
                      LINE_WIDTH.decoration;
  const borderColor = primaryColor || "00A69C";
  
  // 卡片背景 - 边框粗细区分重要性
  slide.addShape("rect", {
    x: x, y: y, w: w, h: h,
    fill: { color: "FAFAFA" },
    line: { color: borderColor, width: borderWidth }
  });
  
  // 图标区域（圆形背景）- 线条更细
  const iconSize = 0.5;
  slide.addShape("oval", {
    x: x + (w - iconSize) / 2, y: y + 0.15,
    w: iconSize, h: iconSize,
    fill: { color: primaryColor || "00A69C" },
    line: { color: primaryColor || "00A69C", width: LINE_WIDTH.contentThin }
  });
  
  // 自动匹配图标
  const icon = ICONS[iconKey] || getSmartIcon(title || iconKey);
  slide.addText(icon, {
    x: x + (w - iconSize) / 2, y: y + 0.15,
    w: iconSize, h: iconSize,
    fontSize: 16,
    color: "FFFFFF",
    align: "center", valign: "middle"
  });
  
  // 标题
  slide.addText(title, {
    x: x + 0.1, y: y + iconSize + 0.2,
    w: w - 0.2, h: 0.35,
    fontSize: 12, fontFace: "Microsoft YaHei",
    color: "333333", bold: true, align: "center"
  });
  
  // 描述
  if (desc) {
    slide.addText(desc, {
      x: x + 0.1, y: y + iconSize + 0.55,
      w: w - 0.2, h: h - iconSize - 0.7,
      fontSize: 9, fontFace: "Microsoft YaHei",
      color: "666666", align: "center", valign: "top"
    });
  }
}

/**
 * 创建带图标的标题行 - 使用层级线条和智能图标
 * @param {object} slide - 幻灯片对象
 * @param {object} opts - {x, y, w, iconKey, title, subtitle, primaryColor, importance}
 */
function addIconTitleBar(slide, opts) {
  const { x, y, w, iconKey, title, subtitle, primaryColor, importance = "medium" } = opts;
  const color = primaryColor || "00A69C";
  
  // 根据重要性选择边框粗细
  const borderW = importance === "high" ? LINE_WIDTH.primaryMedium : LINE_WIDTH.content;
  
  // 背景条 - 标题级使用粗边框
  slide.addShape("rect", {
    x: x, y: y, w: w, h: 0.5,
    fill: { color: "F5F5F5" },
    line: { color: color, width: borderW }
  });
  
  // 自动匹配图标
  const icon = ICONS[iconKey] || getSmartIcon(title);
  slide.addText(icon, {
    x: x + 0.1, y: y + 0.08,
    w: 0.35, h: 0.35,
    fontSize: 14,
    color: color
  });
  
  // 标题
  slide.addText(title, {
    x: x + 0.45, y: y + 0.1,
    w: w * 0.5, h: 0.25,
    fontSize: 11, fontFace: "Microsoft YaHei",
    color: color, bold: true
  });
  
  // 副标题
  if (subtitle) {
    slide.addText(subtitle, {
      x: x + 0.45, y: y + 0.3,
      w: w * 0.5, h: 0.15,
      fontSize: 7, fontFace: "Arial",
      color: "666666"
    });
  }
}
```

---

## 辅助函数（风格A 共用）

```javascript
function addConsultHeader(slide, pres, titleText) {
  slide.addShape("rect", {
    x: 0, y: 0, w: 10, h: 0.55,
    fill: { color: "FFFFFF" },
    line: { color: "E0E0E0", width: 0.4 }
  });
  slide.addText(titleText, {
    x: 0.2, y: 0.08, w: 8.5, h: 0.38,
    fontSize: 8, fontFace: "Arial",
    color: "444444", wrap: true
  });
  slide.addText("世达ppt  shidappt", {
    x: 8.5, y: 0.12, w: 1.4, h: 0.3,
    fontSize: 5.5, fontFace: "Arial",
    color: "666666", align: "right"
  });
}

function addPageBadge(slide, pres, pageNum) {
  slide.addShape("rect", {
    x: 9.55, y: 5.2, w: 0.35, h: 0.25,
    fill: { color: "00A69C" }, line: { color: "00A69C" }
  });
  slide.addText(String(pageNum).padStart(2, "0"), {
    x: 9.55, y: 5.2, w: 0.35, h: 0.25,
    fontSize: 9, fontFace: "Arial",
    color: "FFFFFF", bold: true,
    align: "center", valign: "middle"
  });
}
```

---

**Author:** forrestneo | 756782794@qq.com
