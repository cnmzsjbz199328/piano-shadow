# Piano Shadow 前端 UI 审查

审查日期：2026-09-07

## 总结

当前前端功能结构完整，但视觉上更接近“开发者工具面板”，还没有形成现代音乐练习产品所需要的简洁、聚焦和连续的练习体验。

用户对“设计繁杂、老套、不够简约美观”的感受成立。最明显的问题集中在 Practice 页面：播放控制、模式、Piano Roll、虚拟键盘、MIDI、实时反馈和调试开关同时展开，且大多采用相似的面板样式，导致主任务不够突出。

建议采用“克制中性、低信息密度、边框优先”的深色设计方向，参考 Linear 风格，并将 Practice 页面重新组织成一个连续的练习工作区。

## 现状证据

### 视觉结构

- 全局使用深色模式和多层深色表面：`--bg`、`--bg-elevated`、`--bg-elevated-2`、`--bg-elevated-3`。[index.css](../../src/index.css)
- 页面大量依赖 `.panel`、边框和圆角来区分模块，Practice 页面中模式、播放、Piano Roll、键盘、MIDI 和调试设置被拆成多个独立区域。[PracticePage.tsx](../../src/pages/PracticePage.tsx)
- 导航将 Home、Practice、Results、Experiments、Microphone Lab 作为平级入口展示。[App.tsx](../../src/App.tsx)
- Piano Roll 的图例和缩放控制、播放控制、状态徽标等元素都处于同一视觉层级，增加了界面噪音。[PianoRoll.tsx](../../src/components/piano-roll/PianoRoll.tsx)
- 当前按钮、标签、复选框和面板都采用相近的视觉重量，主操作“开始练习”没有形成足够清晰的焦点。[TransportControls.tsx](../../src/components/transport/TransportControls.tsx)

### 虚拟键盘范围

当前默认配置为：

```ts
lowMidi = 48;
highMidi = 84;
```

这对应 C3–C6，包含 37 个键：

- 22 个白键
- 15 个黑键
- 总范围为 37 个半音

标准钢琴为 A0–C8：

- 起始 MIDI：21
- 结束 MIDI：108
- 52 个白键
- 36 个黑键
- 总计 88 个键

因此当前虚拟键盘确实不是全尺寸键盘。[PianoKeyboard.tsx](../../src/components/piano/PianoKeyboard.tsx)

当前电脑键盘输入还额外限制在约 17 个音符，并通过 Z/X 切换八度。这是输入映射限制，与视觉键盘是否显示 88 键是两个独立问题。

## 主要问题及影响

| 优先级 | 问题 | 影响 |
| --- | --- | --- |
| P0 | Practice 页面信息同时展开 | 用户难以快速找到“开始练习”和当前练习状态 |
| P0 | 虚拟键盘只有 37 键 | 无法覆盖完整钢琴音域，和产品定位不一致 |
| P1 | 面板数量多且样式重复 | 页面显得繁杂、传统、缺少现代产品感 |
| P1 | 主次操作视觉差异不足 | 播放、开始录制、连接 MIDI 等操作竞争注意力 |
| P1 | Piano Roll 与键盘被割裂 | 用户难以将时间轴、音高和实际键位理解为同一工作区 |
| P2 | 实验功能与主流程平级 | Experiments 和 Microphone Lab 让产品主线显得不够聚焦 |
| P2 | 键盘缺少完整音域提示 | 用户看不出当前显示范围和八度位置 |

## 推荐设计方向

### Practice 页面

1. 顶部保留歌曲名称和练习模式选择。
2. 将 Play、Pause、Stop、Restart、进度和速度收敛成一条紧凑工具栏。
3. 让 Piano Roll 成为页面主体，而不是普通卡片之一。
4. 将虚拟键盘放在底部，横跨主要内容区域，默认显示 A0–C8 的 88 键。
5. 在移动端允许横向滚动，并提供明确的当前音域/八度提示。
6. 将 MIDI 连接、实时反馈和调试信息放入低权重侧栏或可折叠区域。

### 视觉系统

- 保留深色模式，但降低各层背景之间的差异。
- 使用低饱和中性灰作为主色，使用单一靛蓝作为主要强调色。
- 使用细边框和留白建立层次，减少阴影、厚重卡片和过多圆角。
- 保留 `--correct`、`--wrong`、`--missed`、`--extra` 四种结果色，并只在反馈场景中使用。
- 将按钮分为明确的 primary、secondary、quiet 三个层级。
- 统一间距、字号、圆角和控件高度，减少页面中的零散 inline style。

### 全尺寸键盘

建议将默认范围改为：

```tsx
lowMidi = 21;
highMidi = 108;
```

在当前白键宽度 26px 的情况下，88 键键盘宽度约为 1352px，因此需要：

- 桌面端：完整显示或横向滚动
- 小屏端：横向滚动，并保持黑键与白键比例
- 增加 A0、C4、C8 等关键音名标识
- 保留现有的按键高亮、触控和键盘输入行为

## 参考图对应关系

- [Practice workspace](./practice-workspace.png)：主推荐方向。重点是 Piano Roll + 全尺寸键盘组成连续工作区。
- [Home page](./home-page.png)：重点是单一 MIDI 导入入口，Demo 和最近练习降级为次要内容。
- [Results page](./results-page.png)：重点是评分摘要、参考与实际演奏对比，以及清晰的下一步操作。

## 建议实施顺序

### 第一阶段：视觉基础

- 重做 `src/index.css` 的设计 tokens。
- 统一面板、按钮、输入控件、徽标和状态颜色。
- 降低导航与实验入口的视觉权重。

### 第二阶段：Practice 工作区

- 重组 Transport、Piano Roll、键盘和侧栏的视觉关系。
- 将主要操作集中到顶部或底部工具栏。
- 增加全尺寸键盘和横向滚动体验。

### 第三阶段：Home 与 Results

- Home 突出 MIDI 导入和 Demo 入口。
- Results 突出总分、维度分数和再次练习。
- 统一三类页面的留白、层级和交互状态。

## 审查结论

本轮不需要改变练习引擎、播放引擎或路由结构。主要工作是视觉系统重做、Practice 页面层级优化，以及将虚拟键盘恢复为标准 88 键范围。

已有的 [NEXT_ROUND_REQUIREMENTS.md](../NEXT_ROUND_REQUIREMENTS.md) 对“克制中性、Linear 风格、低信息密度、边框优先”的现代化方向已有较完整定义，本审查与该方向一致。
