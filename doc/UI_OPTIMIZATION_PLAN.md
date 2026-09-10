# Piano Shadow UI 优化方案

> 文档版本：v1.0  
> 制定日期：2026-09-10  
> 适用范围：Practice 工作区及其 Score / Library 交互  
> 状态：已实现（v0.9.0，2026-09-10）。见 [`CHANGELOG.md`](../CHANGELOG.md) 与
> [`doc/ARCHITECTURE.md`](ARCHITECTURE.md) 的 "Staff-notation view — scope"。

## 1. 方案摘要

Practice 页面改造成一个连续的练习工作区：

- 五线谱是主要的练习内容，放在键盘上方的主工作区中；五线谱内容在自己的视口内**上下滚动**，不通过压缩键盘来容纳长曲目。
- Library 不再固定堆叠在五线谱下方，而是与五线谱共用同一块主工作区。
- 点击 `Library` 后，主工作区执行一次页面翻转，从 Score 面翻到 Library 面；点击返回或选中曲目后，可翻回 Score 面。
- 虚拟钢琴键盘保持在主工作区底部的独立 Dock 中。Score 与 Library 翻面时，键盘 Dock 不移动、不缩放、不被挤压。
- 播放、暂停、停止、速度和当前曲目等高频操作集中到 Practice 顶部工具栏；调试、设备和低频设置保持次要层级。

本方案是 UI/交互层方案，不改变音符模型、匹配算法、播放时钟或评分规则。

## 2. 已确认的设计前提

以下内容是本轮设计的硬约束，后续实现不能按“屏幕高度不够”而改变其含义：

| 编号 | 已确认前提 | 对设计的影响 |
| --- | --- | --- |
| D-01 | 五线谱可以上下滑动 | Score 使用独立纵向滚动视口；长曲目不需要缩小到不可读，也不需要压缩键盘高度 |
| D-02 | Library 点击后，五线谱页面翻转显示曲目 | Score 与 Library 是同一主工作区的两个互斥表面，不再上下长期同时展开 |
| D-03 | 五线谱与 Library 共同使用空间 | 两个表面使用相同的容器尺寸、内边距和层级，切换时工作区位置稳定 |
| D-04 | 键盘位置不因五线谱长度变化 | 键盘是独立 Dock；Score 的滚动只影响 Score 视口内部 |

## 3. 当前问题与优化目标

### 3.1 当前问题

- `ScoreView` 位于折叠的 `Show notation` 面板，用户进入练习时看不到主要谱面。
- Library 位于页面末尾，长页面中需要额外滚动才能切换曲目。
- 五线谱、Piano Roll、键盘和练习控制之间的主次关系不够明确。
- 面板数量较多且视觉重量接近，用户难以快速判断下一步应做什么。
- 长曲目如果用整体页面增长来承载，会让播放控制和键盘的位置不断远离。

### 3.2 优化目标

1. 用户打开已有曲目后，第一眼能看到曲名、练习状态、主要谱面和键盘。
2. 用户可以在不离开 Practice 页面、不改变键盘位置的情况下切换曲目。
3. 长曲目保持可读性：滚动的是五线谱内容，不是整个练习框架。
4. 高频动作有明确的视觉优先级：开始/暂停、重新开始、速度、切换曲目。
5. Library 翻页有清晰的状态反馈，并兼容键盘操作、屏幕阅读器和减少动态效果设置。
6. 方案可以分阶段实现，每个阶段都有可验证的验收条件。

## 4. 信息架构与页面布局

### 4.1 Practice 页面层级

```text
App Shell
└── Practice Page
    ├── Practice Header
    │   ├── 曲目名称 / 来源 / 当前模式
    │   ├── 主要播放控制：Play / Pause / Stop / Restart
    │   ├── 进度与速度
    │   └── Workspace surface switch：Score / Library
    ├── Practice Workspace
    │   ├── Score Surface（默认正面）
    │   │   ├── Score toolbar：曲名、拍号/速度、显示状态
    │   │   └── Score viewport：五线谱独立上下滚动
    │   └── Library Surface（翻转后的背面）
    │       ├── Library header：My MIDI songs、数量、Import
    │       └── Song list：选择、Practice、Export、Delete
    ├── Optional guidance layer
    │   ├── Piano Roll / Falling Notes
    │   └── Live feedback / Wait Mode
    └── Piano Keyboard Dock（始终位于底部）
```

### 4.2 桌面端建议线框

```text
┌──────────────────────────────────────────────────────────────┐
│ Piano Shadow        曲目名称 · Play Along       [Library]    │
│                      [Play] [Stop] 进度 速度                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  SCORE SURFACE                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Score toolbar · notation status                       │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │                                                        │  │
│  │  treble / bass staves                                  │  │
│  │  ↑                                                    │  │
│  │  │  独立纵向滚动                                       │  │
│  │  ↓                                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Keyboard Dock · 音域提示 · 横向滚动的 88 键键盘              │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 Library 翻面后的内容

```text
┌──────────────────────────────────────────────────────────────┐
│ Piano Shadow        曲目库                          [Back]     │
├──────────────────────────────────────────────────────────────┤
│  LIBRARY SURFACE                                               │
│  My MIDI songs                                      [Import]   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 曲目名称        时长 · 音符数       [Practice] [...]   │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │ 曲目名称        时长 · 音符数       [Practice] [...]   │    │
│  └────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│  Keyboard Dock 保持原位                                        │
└──────────────────────────────────────────────────────────────┘
```

## 5. 核心交互规格

### 5.1 Surface 状态

主工作区只允许一个表面处于可操作状态：

```ts
type PracticeSurface = 'score' | 'library';
```

建议状态规则：

| 场景 | 默认表面 | 行为 |
| --- | --- | --- |
| 已加载曲目进入 Practice | `score` | 直接显示五线谱；不再要求用户展开 `Show notation` |
| 未加载曲目进入 Practice | `library` 或空状态 | 直接引导导入/选择曲目，避免显示空谱面 |
| 点击 `Library` | `library` | 执行翻面，焦点移到 Library 标题或列表第一项 |
| 点击 `Back to score` | `score` | 执行翻回，恢复进入 Library 前的 Score 滚动位置 |
| Library 中点击 `Practice` | `score` | 加载曲目后翻回 Score；新曲目从其上次保存位置或顶部开始 |
| 导入成功 | `library` | 保持在 Library，让用户确认新曲目已加入；提供明确的 `Practice` 操作 |
| 导入失败 | 当前表面不变 | 在当前表面展示可行动错误，不重置正在练习的曲目 |

### 5.2 翻页行为

- 翻页触发控件使用按钮，不依赖点击装饰性区域。
- 建议动效时长为 `350–450ms`，使用平滑的 `ease-in-out`；动效只表达“表面切换”，不模拟过重的真实纸张阴影。
- 翻页期间禁用重复触发，避免两个表面同时可操作。
- 翻页结束后再更新可访问名称和焦点，避免屏幕阅读器读到两个重复列表。
- 设置 `prefers-reduced-motion: reduce` 时取消 3D 翻转，改为即时淡入/淡出或即时切换。
- 翻页失败或浏览器不支持 3D transform 时，仍必须能完成即时切换。
- Score 与 Library 共用同一个外层容器尺寸，切换不应导致键盘或下方区域跳动。

### 5.3 Score 视口

- 五线谱内容区使用独立 `overflow-y: auto` 视口。
- 滚动条属于 Score 视口，不属于整个 Practice 页面；页面主框架在常规桌面高度下保持稳定。
- 五线谱宽度根据当前容器自适应；横向溢出时允许 Score 内部横向滚动，但不改变键盘 Dock 的布局。
- 当前播放位置、活动小节或活动音符需要有轻量视觉提示；滚动不应强制打断用户手动浏览，除非后续明确加入“跟随播放”开关。
- 需要保留用户在翻到 Library 前的 `scrollTop`，翻回 Score 后恢复。
- 五线谱内容高度应由曲目长度决定。当前 `MAX_MEASURES = 16` 的截断属于内容能力限制，应在实现时单独评估，不能用缩小字体替代滚动。
- Score 的空状态、无音符状态和渲染失败状态都必须占据同一表面位置，并提供下一步动作或原因说明。

### 5.4 Library 表面

- 保留现有的选择/Practice、Export、Delete 能力；本轮不改变数据和业务语义。
- 当前曲目使用清晰但克制的选中状态，例如左侧 accent 标记、背景变化和 `Current` 文案。
- 曲目名称过长时截断并提供完整 `title` 或可访问名称；操作按钮不应被名称挤出可视区域。
- 空库状态突出 `Import MIDI` 和内置 Demo 入口。
- 删除操作继续使用确认流程；确认文案说明操作不可撤销。
- Library 列表可在自身区域滚动，但不让整个 Practice 框架随列表长度无限增长。

### 5.5 键盘 Dock

- Dock 是 Score / Library 共同的持久区域，翻页时不参与翻转。
- 88 键横向滚动规则沿用现有设计；键盘不得为了适配 Score 高度而压扁或缩小到难以操作。
- 保留当前音域提示、焦点音符、按下状态和鼠标/触摸/计算机键盘输入提示。
- 桌面端优先保证键盘 Dock 的操作高度；移动端允许用户横向滚动键盘，但不能让页面出现不必要的纵向嵌套滚动。

## 6. 视觉设计方向

### 6.1 层级

采用“一个主舞台、少量辅助层”的原则：

- Primary：当前曲目、播放控制、Score/Library 切换、键盘反馈。
- Secondary：Piano Roll、速度、模式说明、实时反馈摘要。
- Quiet：MIDI 设备、Debug、实验性能力和技术说明。

Score 面和 Library 面应共享同一套 token、边框、圆角和内边距，形成同一个工作区，而不是两个风格不同的页面。

### 6.2 色彩与状态

- 延续深色、低饱和、中性灰的基调，并使用单一 accent 突出当前动作和当前曲目。
- `--correct`、`--wrong`、`--missed`、`--extra` 只用于练习反馈，不用于装饰 Library 或导航。
- Score 的播放头、活动音符和当前表面使用 accent；不要用大量发光、渐变或厚重阴影制造层级。
- 翻页前后按钮标签和图标要表达“去 Library / 回到 Score”，不依赖动画才能理解。

### 6.3 间距和尺寸原则

- Practice 主工作区采用统一的最大宽度和内边距。
- Score 视口、Library 列表和键盘 Dock 的左右边缘对齐。
- 控件高度、按钮密度和标题层级复用现有设计 token；不在单个组件中新增随意的 magic number。
- 以内容可读性为优先：五线谱可以纵向增长，键盘保持可操作尺寸，两个区域各自承担自己的空间约束。

## 7. 响应式方案

| 视口 | 主工作区 | Score | Library | 键盘 |
| --- | --- | --- | --- | --- |
| 桌面（> 900px） | 固定主框架高度，Score/Library 共享舞台 | 独立纵向滚动 | 列表在表面内部滚动 | Dock 保持清晰操作高度，必要时横向滚动 |
| 平板（641–900px） | 减小边距，工具栏允许换行 | 保持纵向滚动，减少每行小节数 | 操作按钮允许第二行排列 | 保持独立 Dock 和横向滚动 |
| 手机（≤ 640px） | 表面占满可用宽度，翻页退化为即时切换 | 独立纵向滚动，避免全页多重滚动 | 行项目改为上下布局，操作按钮满宽或分组 | 保持底部区域，横向滚动并显示音域提示 |

移动端不要求把完整 88 键压缩到屏幕宽度内；可滚动、可操作比“全部同时可见”更重要。

## 8. 无障碍与可用性要求

- Score/Library 切换必须是可聚焦、可按 Enter/Space 操作的真实按钮。
- 使用 `aria-label` 明确当前动作，例如“打开曲目库”“返回五线谱”；不要只提供图标。
- 两个表面不能同时进入 Tab 顺序；非当前表面应从可操作树中隐藏或禁用。
- 翻页结束后将焦点移到当前表面标题或第一项主要控件。
- Score 滚动区域提供可识别的标签，例如 `aria-label="五线谱"`；Library 列表提供明确的区域标题。
- 保持可见 focus 状态；不能只通过颜色表达当前曲目或反馈状态。
- `prefers-reduced-motion` 下不依赖翻转动画传递信息。
- 文字、按钮和反馈颜色继续按可读性标准检查，正文与背景目标对比度不低于 4.5:1。

## 9. 实现拆分与跟踪清单

### P0：主工作区结构

- [x] 将 `ScoreView` 从折叠的 `details` 中提升为 Practice 主工作区默认表面。（`ScoreSurface` + `PracticeWorkspace` 的 score 面）
- [x] 新增 `PracticeSurface` 状态及 Score/Library 切换按钮。（`stores.practiceSurface` + `TransportControls` 顶部工具栏 `.surface-switch`）
- [x] 建立共享舞台容器，保证两个表面尺寸一致。（`.practice-workspace__viewport` 固定 `--workspace-h`，两个 `__face` `position:absolute; inset:0`）
- [x] 将键盘 Dock 放在共享舞台之外，确认翻页和 Score 滚动不影响键盘位置。（E2E 比对 `.keyboard-dock` bounding box）
- [x] 为 Score 建立独立纵向滚动视口，并确认长曲目不会推动整个页面框架增长。（`.score-surface__viewport { overflow:auto }`，`MAX_MEASURES` 16→64）

### P1：翻页与 Library 体验

- [x] 实现 Score → Library → Score 的翻页状态和防重复触发。（`PracticeWorkspace` 的 `isFlipping` + `requestSurface` 门控）
- [x] 翻页后管理焦点、Tab 顺序和可访问名称。（settle 后 focus `[data-workspace-heading]`；非当前/翻转中面 `inert` + `aria-hidden`）
- [x] 增加 `prefers-reduced-motion` 和不支持 3D transform 时的降级路径。（`data-instant`：reduced-motion / `max-width:640px` / 无 preserve-3d → 即时切换）
- [x] 保留 Score 滚动位置；切换曲目时按规则重置或恢复滚动位置。（视口不卸载 → scrollTop 自然保留；`song.id` 变化时归零）
- [x] 将 Import、空库、当前曲目、删除确认和错误状态纳入统一表面布局。（`SongLibrary` 单一 header + 空库 drop zone/demo + `importError` banner + `window.confirm` 删除）

### P1：视觉层级收敛

- [x] 统一 Practice Header、workspace surface、Score toolbar、Library header 和 Keyboard Dock 的 token。（`.workspace-surface__header` 共用；沿用既有 spacing/radius token）
- [x] 降低非主任务面板的视觉重量，保留反馈语义色的含义。（去掉 `.practice-note-focus` 独立条；MIDI/Debug 仍在次级 disclosure；`--correct/--wrong/...` 仅用于反馈）
- [x] 清理会导致主工作区跳动的固定/内联尺寸。（删除 `.notation-panel` / `.library-toolbar` / `.song-library--compact`；工作区固定高度）
- [x] 补充桌面、平板、手机三种宽度下的布局验证。（`--workspace-h` 三档；`@media 900/640`；phone 即时切换 + `.surface-switch` 满宽）

### P2：质量与回归

- [x] 更新 ScoreView、SongLibrary、PracticePage 的组件测试。（`ScoreView` 截断阈值；新增 `SongLibrary.test.tsx`、`PracticeWorkspace.test.tsx`；PracticePage 流程由 store + E2E 覆盖）
- [x] 增加切换表面、恢复 Score 滚动位置、空库和导入失败的测试。（`PracticeWorkspace.test.tsx` 翻页/inert/focus；`useAppStore.test.ts` surface 路由 + 导入失败不动表面）
- [x] 增加 Playwright 场景：加载曲目 → 查看 Score → 打开 Library → 选择曲目 → 返回 Score。（`practice.spec.ts` "the Score/Library flip keeps one operable surface…"）
- [x] 检查键盘输入、MIDI 输入、播放时钟和评分结果未受 UI 重排影响。（既有 189 单测 + 9 E2E 全绿；本轮未触碰 engine/matcher/scoring）
- [x] 运行 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run test:e2e`。（全部通过；`npm run build` 亦通过）

## 10. 验收标准

### 功能验收

- [x] 已加载曲目进入 Practice 后，五线谱默认可见，不需要展开隐藏面板。
- [x] 五线谱可以上下滚动；曲目变长时键盘位置和操作尺寸不发生挤压变化。
- [x] 点击 `Library` 后，Score 区域翻转为 Library；键盘 Dock 保持位置不变。
- [x] 点击返回或从 Library 选择曲目后，可以回到 Score；切换过程不会出现两个表面同时可操作。
- [x] Library 的 Practice、Import、Export、Delete 功能和现有业务语义保持一致。
- [x] 无曲目、空库、导入失败、无音符和谱面渲染失败都有明确状态。

### 视觉验收

- [x] Practice 页面主视觉焦点是“当前曲目 + Score/Library 工作区 + 键盘 Dock”。
- [x] Score 和 Library 使用一致的容器尺寸、间距、边框和背景层级。
- [x] 播放控制、切换控件和当前曲目明显高于 Debug/MIDI/实验性信息。
- [x] 桌面端没有因为长曲目产生不必要的整页纵向滚动；移动端没有不可操作的过窄键盘。

### 无障碍与回归验收

- [x] 仅使用键盘即可完成 Score/Library 切换、选择曲目和返回 Score。
- [x] 屏幕阅读器不会同时读取隐藏表面中的交互内容。
- [x] 减少动态效果设置下仍能完成相同操作。
- [x] 现有自动化测试和核心练习流程全部通过。

## 11. 非目标与边界

本轮方案不包含：

- 改变 `practice-engine`、`playback-engine`、评分规则或 canonical music model。
- 将 Library 改造成独立路由、弹窗或新的顶层导航入口。
- 新增云端同步、账户、协作或曲目管理后端。
- 在本轮引入新的 UI 框架、CSS-in-JS 或网络字体。
- 改变 Piano Roll 的绘制算法；如需要调整，只处理其在辅助层中的布局关系。
- 因为翻页动效而牺牲键盘输入、播放同步或屏幕阅读器操作。

## 12. 决策记录与后续问题

### 已决策

- 五线谱采用纵向滚动，不通过缩小或挤压键盘解决长曲目空间问题。
- Library 与 Score 共享主工作区，并通过页面翻转完成切换。
- 键盘 Dock 独立于翻转表面，始终保持在底部。
- 该方案只调整 UI 信息架构和交互，不改变音乐业务逻辑。

### 实现时需要确认但不阻塞方案

- 桌面端主工作区的具体高度，应根据实际浏览器窗口和键盘 Dock 高度用 CSS token 校准。
- “跟随播放自动滚动”是否默认开启，应在实现后基于实际练习体验决定；第一版建议不强制打断用户手动滚动。
- 是否保留 Piano Roll 作为 Score 下方的可折叠辅助层，应在主工作区落地后依据空间和使用频率复核。

## 13. 关联文件

- `src/pages/PracticePage.tsx`：Practice 工作区入口与布局编排
- `src/components/sheet-music/ScoreView.tsx`：五线谱渲染与 Score 视口
- `src/components/practice/SongLibrary.tsx`：Library 内容与曲目操作
- `src/components/piano/PianoKeyboard.tsx`：键盘 Dock 内容
- `src/index.css`：设计 token、布局、滚动和响应式样式
- `doc/ui-references/UI_REVIEW.md`：上一轮 UI 审查记录
- `doc/NEXT_ROUND_REQUIREMENTS.md`：UI Modernization 阶段的总体约束

