# 五线谱懒加载渲染方案（去除 64 小节硬截断）

> 文档版本：v1.0
> 制定日期：2026-09-12
> 适用范围：`src/components/sheet-music/ScoreView.tsx` 及其测试
> 状态：待执行 — 本文档是可直接交给执行 agent 的实现规格，执行完成后由另一位 reviewer
> （本会话）负责代码审查与 git 提交/PR。
> 背景：见 [`doc/ARCHITECTURE.md`](ARCHITECTURE.md) 的 "Staff-notation view — scope"
> （v0.8.0 / v0.9.0 签署记录），本方案会在其后追加一条新的签署记录，不得改写历史记录。

## 0. 问题复现（已验证，无需重新调查）

用 `DJ Okawari - Flower Dance.mid`（78 BPM，4/4 拍，时长 323.08 秒）验证：

- 每小节 = 4 拍 × 60/78 秒 ≈ 3.077 秒
- 全曲所需小节数 = ceil(323.08 / 3.077) ≈ **105 小节**
- [`ScoreView.tsx:44`](../src/components/sheet-music/ScoreView.tsx#L44) 的
  `const MAX_MEASURES = 64;` 会在 `buildScoreModel`
  （[ScoreView.tsx:245-292](../src/components/sheet-music/ScoreView.tsx#L245-L292)）里通过
  `Math.min(MAX_MEASURES, neededMeasures)` 截断模型本身 —— 超过 64 小节的音符**根本不会被
  建模**，更谈不上渲染。64 小节 ≈ 197 秒，只覆盖全曲的 61%，这正是"后半段没有五线谱"的原因。
  与复弹/循环无关：MIDI 是单条连续音轨，没有 repeat 标记。
- `renderScore`（[ScoreView.tsx:423-540](../src/components/sheet-music/ScoreView.tsx#L423-L540)）
  一次性把模型里的**全部**小节同步画进一个 SVG；`MAX_MEASURES` 这个上限真正的作用是**限制这次
  同步渲染的工作量**，防止极长曲目卡住渲染线程 —— 这是它存在的唯一理由，不是有意的"只看一部分"
  产品设计。

## 1. 目标与不可突破的约束

**目标**：五线谱视图对任意长度的已导入 MIDI 曲目都能展示完整乐谱，不再有固定小节数上限；
渲染工作量按需增量进行（真正的懒加载），而不是简单把 `MAX_MEASURES` 调大到一个新的固定数字。

**约束（来自 CLAUDE.md 与 doc/ARCHITECTURE.md，不得违反）**：

- **不新增权威数据源。** `Performance` / `song.notes` 仍是唯一权威模型；懒加载状态（已渲染到第几
  行）只是 `ScoreView` 内部的渲染层状态，绝不能回写到 store 或被其它模块读取。
- **Display-only 不变。** 不新增编辑、拖拽、导出；不影响 `practice-engine` / `playback-engine` /
  评分逻辑 —— 它们已经读取完整的 `song.notes`，与五线谱渲染范围无关，这次改动完全在
  `components/sheet-music/` 内部。
- **单一时钟不变。** 播放进度仍然只来自 `useAppStore` 的 `currentTime`（Tone.Transport 驱动），
  懒加载逻辑只是"根据这个时间还需要多画哪些行"，绝不能引入自己的计时器。
- **具名常量，不散落魔法数字**（CLAUDE.md 明确要求）：所有新的批次大小/预渲染行数/安全上限都要
  是顶部具名常量，风格与现有 `MIN_MEASURE_WIDTH` / `MAX_MEASURES_PER_ROW` 一致。
- **不做"半成品"。** 本方案必须作为一个完整改动落地并通过全部验收标准（第 6 节），不能只实现到
  一半就合并——如果要拆给多个 agent 并行/接力执行，见第 5 节的阶段划分，但阶段划分是为了方便分批
  review，最终必须整体自洽、测试全绿。

## 2. 现状代码结构（执行前必读）

`ScoreView.tsx` 当前的数据流：

```
song.notes
  → buildScoreModel(song)          // 純データ：量化 + 分小节，一次性算出 measures[]（当前被 MAX_MEASURES 截断）
  → packMeasureRows(measures, w)   // 純データ：把小节打包成"系统行"（一行 ≤4 小节，按宽度撑满）
  → renderScore(VF, host, model,…) // 副作用：一次性把所有行画进一个 <svg>，返回 RenderedScore { notes[] }
  → updateScoreHighlight(...)      // 每次 currentTime 变化时，遍历 RenderedScore.notes 打高亮 class + scrollIntoView
```

`buildScoreModel` 和 `packMeasureRows` 都是纯函数、无 VexFlow 调用，即使算出几百个小节也很便宜。
真正昂贵、需要限制的只有 `renderScore` 里对 VexFlow 的调用（`new VF.Stave`、`Formatter.FormatAndDraw`
等）。所以懒加载的落点是：**模型和行布局始终算全量；只有"画到 VexFlow 里"这一步按需分批**。

## 3. 设计方案

### 3.1 模型层：去掉硬截断，只保留一个安全阀

- 删除 `buildScoreModel` 里 `measureCount = Math.min(MAX_MEASURES, neededMeasures)` 这个用户可见
  的截断行为。
- 保留一个**极高的安全阀常量**（防止损坏文件/异常极端 MIDI 产生数十万小节拖垮浏览器），例如：

  ```ts
  /**
   * Absolute safety valve, not a UX limit — buildScoreModel/packMeasureRows are
   * cheap pure functions, but an absurd or corrupt MIDI (e.g. a bad tempo map
   * yielding near-zero measure length) must not be allowed to generate an
   * unbounded array. Real songs never get near this.
   */
  const MODEL_MEASURE_SAFETY_CAP = 4000;
  ```

  `measureCount = Math.min(MODEL_MEASURE_SAFETY_CAP, neededMeasures)`；`ScoreModel.truncated` 语义
  改为"命中了安全阀"，文案相应改为例如
  `Showing the first ${MODEL_MEASURE_SAFETY_CAP} bars (this file is unusually long).`
  正常曲目（几百小节以内）永远不会触发。
- `ScoreModel` 新增每个 measure 对应的**行号**信息，供 3.3 节的播放跟随逻辑使用而不依赖"已渲染
  的行"。具体做法：`buildScoreModel` 之后、渲染之前，先跑一遍 `packMeasureRows(measures, …)`
  （已经存在，只是现在只在 `renderScore` 里调一次）——把它提升为 `ScoreView` 组件级的 `useMemo`，
  和 `model` 一起算出来、一起作为 `renderScore`/渲染层的输入，这样行布局本身不再是 `renderScore`
  的内部细节，而是和 `model` 同级的、组件可以查询的数据。

### 3.2 渲染层：从"一次性画全部"改成"可增量画到第 N 行"

把 `renderScore` 拆成：

- `createScoreRenderer(VF, host, rows: MeasureRow[], ink): ScoreRenderer` —— 创建 `VF.Renderer`、
  画一次五线谱的静态外壳（不含任何小节内容），并返回一个句柄：

  ```ts
  interface ScoreRenderer {
    /** Highest row index (inclusive) already drawn; -1 initially. */
    lastRenderedRow: number;
    /** All rows that exist in this score, for lookahead/limit checks. */
    totalRows: number;
    notes: RenderedScoreNote[]; // 追加式增长，永不清空/替换
    /** Draw any undrawn rows up to and including targetRow (clamped). Idempotent. */
    renderUpTo(targetRow: number): void;
  }
  ```

- `renderUpTo(targetRow)` 内部：对 `lastRenderedRow+1 .. min(targetRow, totalRows-1)` 逐行调用现有
  的单行绘制逻辑（`renderScore` 里 `for (let row = 0; row < rows.length; row += 1) {...}` 循环体，
  原样搬过去，包括系统行的 clef/时间签名/StaveConnector/`drawVoice`），并把新画出来的
  `RenderedScoreNote[]` `push` 进 `notes`（不是重建数组）。
  - **渲染器尺寸**：初始化时就用**全部行数**算出的 `totalHeight`/`width` 一次性 `renderer.resize()`
    （宽度本来就取决于最密的一行，高度是 `rows.length * rowHeight`，这两个值在拿到 `rows` 之后就
    已知，不需要在增量绘制时反复 resize）。也就是说画布尺寸是"全量"的，只是内容按需填充 ——
    这样可以完全避免"resize 是否会清空已画内容"这个不确定性，不需要额外验证或兜底逻辑。
  - 未绘制的行在 SVG 里就是空白（对应的 `<Stave>` 还没 `draw()`），不需要占位符元素——因为整个
    SVG 一开始就已经是最终大小，滚动条/布局从第一帧起就是"最终态"，只是画面内容逐步出现。这比
    "占位 div + 动态改高度"简单得多，也没有滚动跳动的风险。

### 3.3 触发增量绘制的两个信号

在 `ScoreView` 组件里，`createScoreRenderer` 之后接两个独立触发源，任一触发都调用
`renderer.renderUpTo(targetRow)`：

**a. 滚动触发（用户手动往下翻看谱面）**

- 在 `host`（`hostRef` 指向的 VexFlow 容器；它本身在 `ScoreSurface` 提供的 `overflow-y:auto`
  视口内，见 ARCHITECTURE.md）内部，用一个 `IntersectionObserver` 观察当前"已绘制内容的下边缘"
  （可以是 host 元素本身，用 `rootMargin` 判断是否接近底部，不需要额外占位元素，因为 host 尺寸从
  一开始就是最终尺寸——改用**滚动容器的 scroll 事件 + 阈值判断**更直接：监听 `ScoreSurface` 的
  滚动容器的 `scroll`，当 `scrollTop + clientHeight` 超过
  `(renderer.lastRenderedRow + 1) * rowHeight - LOOKAHEAD_PX` 时触发下一批）。
  实现时两种技术（`IntersectionObserver` 用一个真实存在于 DOM 中、位于"下一批行"起始 y 坐标处的
  1px 哨兵元素，或滚动容器的 `scroll` 事件 + 阈值）都能满足需求；**优先选滚动事件方案**，因为
  `IntersectionObserver` 在 jsdom 测试环境里完全不存在，需要额外写一个可手动触发的 stub
  （见第 4 节），而滚动事件在 jsdom 里可以直接用 `fireEvent.scroll` 触发，测试更简单、更贴近现有
  代码库的测试风格（`ScoreView.test.tsx` 现有测试都不 mock 观察者相关 API）。
  - 常量：`const SCROLL_LOOKAHEAD_PX = 600;`（提前一屏左右开始画下一批，避免用户看到空白后才补画）。
- 每次触发画 `ROWS_PER_BATCH`（常量，建议 `4`）行。

**b. 播放跟随触发（曲子在播放，即使用户没有手动滚动）**

- 现有的 `currentTime` 效果（[ScoreView.tsx:623-633](../src/components/sheet-music/ScoreView.tsx#L623-L633)）
  已经在每次播放时间变化时跑一遍高亮逻辑。在调用 `updateScoreHighlight` **之前**，先算出
  `currentTime` 落在模型的第几个 measure、进而第几行（用 3.1 节新增的"measure → row"映射，
  纯数据查找，不依赖已渲染内容），如果
  `targetRow + PLAYBACK_LOOKAHEAD_ROWS > renderer.lastRenderedRow`，先
  `renderer.renderUpTo(targetRow + PLAYBACK_LOOKAHEAD_ROWS)` 补画，再打高亮/`scrollIntoView`。
  - 常量：`const PLAYBACK_LOOKAHEAD_ROWS = 2;`（播放头前方至少保持 2 行已经画好，滚动到该行时
    不会撞见空白）。
  - 这一步保证："即使用户从来没有手动往下滚动，只是让它自动播放到底"，也能看到播放头所在位置的
    谱面，不依赖滚动触发。

### 3.4 初始渲染批次

- 首次 `createScoreRenderer` 之后，立即 `renderUpTo(INITIAL_RENDERED_ROWS - 1)`
  （`const INITIAL_RENDERED_ROWS = 6;`，约等于填满一个中等高度视口 + 一点缓冲），而不是画全部
  —— 这是"真正懒加载"和"只是把上限调大"的关键区别：即使是一首 105 小节的曲子，首次挂载只做 6
  行左右的 VexFlow 排版工作，其余的在用户滚动/播放推进时才做。

### 3.5 清理旧的截断 UI

- 删除 `MAX_MEASURES = 64` 及其在 `buildScoreModel`/JSX 里的用法
  （[ScoreView.tsx:660-662](../src/components/sheet-music/ScoreView.tsx#L660-L662) 的
  `{model?.truncated && <p>Showing the first {MAX_MEASURES} bars.</p>}`）。
- 用 3.1 节的 `MODEL_MEASURE_SAFETY_CAP` 替换其语义，文案改为反映"安全阀"而不是"正常上限"
  （见 3.1 节文案示例）。正常曲目不会看到这行提示。

## 4. 测试计划（`ScoreView.test.tsx`）

现有测试文件结构不变，只调整/新增以下用例：

1. **删除**现有的 "flags truncation when the piece exceeds the measure cap" 用例（80 小节曲子 /
   64 上限的场景不再存在）。
2. **新增**：`src/test/setup.ts` 不需要改动（懒加载改用滚动事件，不依赖
   `IntersectionObserver`）——如果实现时确实选择了 `IntersectionObserver` 方案，则必须在
   `src/test/setup.ts` 里补一个可手动触发的 stub（参考现有 `ResizeObserverStub` 的写法，但要额外
   暴露一个方式让测试拿到注册的 callback 并手动调用，例如把最近一次的 `{target, callback}` 记录到
   `globalThis.__intersectionObserverInstances`）。**默认按 3.3a 节的建议走 scroll 事件方案，避免
   这个额外的测试基础设施改动**。
3. **新增**：`renders only an initial batch of rows on mount, not the whole long song` —— 用一个
   构造出 ~100 小节的 `midiSong(many)`（复用现有 80 小节测试的构造模式，行数再拉长一些），断言
   `host.querySelectorAll('.score-note')`（或数每一行的 stave 元素）的数量明显少于全曲音符数，
   证明初始只画了 `INITIAL_RENDERED_ROWS` 附近的内容。
4. **新增**：`renders more rows as the score viewport scrolls down` —— 对同一个长曲子，用
   `fireEvent.scroll(scrollContainer, { target: { scrollTop: <大值> } })` 模拟往下滚动，
   `await waitFor` 断言已渲染的 `.score-note` 数量增加，并且最终（多次滚动到底）覆盖到曲子最后一
   个音符对应的 `endTime`。
5. **新增**：`keeps drawing ahead of playback even without manual scrolling` —— mock 出的 store
   加上 `currentTime`/`transportState`（现有测试 mock 只有 `song`，需要按
   [ScoreView.tsx:543-547](../src/components/sheet-music/ScoreView.tsx#L543-L547) 里读取的字段扩展
   `state`），把 `currentTime` 设置成对应曲子后半段的一个时间点（不滚动），断言此时该时间点对应
   小节的音符已经出现在 `.score-note` 里（说明播放跟随触发生效，不依赖滚动）。
6. 其余现有用例（scope-gate 三个、"renders a stave…"、"does not throw…no notes"）保持不变，仅在
   断言路径涉及 `MAX_MEASURES`/`truncated` 文案的地方按 3.1/3.5 节更新为新的安全阀文案（正常场景
   下不会触发，所以大概率不需要改动这些用例本身）。
7. 跑 `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build` 全绿，这是 CLAUDE.md
   "Definition of done" 的硬性要求，执行 agent 完成后必须自行跑过一遍再交回。

## 5. 建议的执行阶段划分（用于拆分 PR / 分批 review，不代表可以分批合并到 main）

如果要拆给多个 agent 接力或并行打磨，建议按以下切面划分 diff，方便 reviewer（本会话）逐块过：

1. **模型层**：3.1 节（去掉 `MAX_MEASURES` 截断、加安全阀常量、`packMeasureRows` 提升为组件级
   `useMemo`、measure→row 映射）。此阶段单独跑测试时，`renderScore` 暂时还是"画全部"，属于中间
   状态，**不单独合并**，只作为下一阶段的基础 diff。
2. **渲染层拆分**：3.2 节（`createScoreRenderer` + `renderUpTo`），先只接"挂载时画全部
   `totalRows`"（即行为上等价于阶段 1 之前，只是内部结构变了），验证重构没有破坏现有渲染/高亮/
   `scrollIntoView` 行为，跑一遍现有测试（除已知要删除的截断用例）全绿。
3. **懒加载触发**：3.3、3.4 节（滚动触发 + 播放跟随触发 + 初始批次），加上第 4 节的新测试。
4. **收尾**：3.5 节清理旧 UI 文案，第 6 节文档更新，跑一遍 `npm run build` + 手动用
   `DJ Okawari - Flower Dance.mid`（或类似长度的曲子）在浏览器里验证。

即使分阶段实现，**最终提交给我 review 的必须是完整覆盖 1-4 阶段、测试全绿的一个改动**，不接受
只做到阶段 2 就交付。

## 6. 验收标准

- [ ] `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- [ ] 用真实的 `DJ Okawari - Flower Dance.mid`（105 小节 / 323 秒）手动验证：
  - 曲子加载后立刻只看到前几行谱面（可用浏览器 devtools 数 `.score-note` 或系统行数量，验证不是
    一次性画了 105 小节）。
  - 手动把 Score 视口滚动到底，能看到最后一小节的音符，不再出现"后半段空白"。
  - 点击播放让它一路播到结尾（或跳到接近结尾的时间点），播放头高亮和自动滚动在后半段依然正常
    工作，没有出现"播放头跑到还没画出来的空白区域"的情况。
- [ ] 曲子长度恢复到旧测试用的 2 小节量级时（现有 `defaultNotes()` fixture），视觉和交互与改动前
  完全一致（懒加载在短曲子上应该是"一次性就画完了"，用户感知不到差异）。
- [ ] `doc/ARCHITECTURE.md` 的 "Staff-notation view — scope" 追加一条新的、带日期的签署记录，说明
  `MAX_MEASURES` 硬截断被替换为按行懒加载 + 安全阀（不得删除/改写 v0.8.0/v0.9.0 的历史记录）。
- [ ] `CHANGELOG.md` 在 "Unreleased"（或按维护者当时的版本节奏新开一节）里加一条面向用户的条目：
  长曲目（超过原来 64 小节上限）现在可以显示完整乐谱。
- [ ] 确认 `README.md` 是否提及过 64 小节/截断相关的已知限制（截至本方案撰写时未发现），若有则一并
  更新。

## 7. Reviewer（本会话）职责，供执行 agent 参照

执行 agent 完成实现后，由发起本方案的会话负责：

- 走读 diff，重点核对第 1 节列出的约束（不新增权威状态、display-only、单一时钟、具名常量）确实
  被遵守。
- 确认第 6 节验收标准逐项打勾，必要时要求补测试或补手动验证证据。
- 负责 `git add` / commit message / 是否开 PR 等版本控制动作；执行 agent 不需要自行决定提交策略。
