# 弦外 · DSH 插件

把单文件网页「弦外」（`../index.html`）转写成 DSH 插件：**主人在对话里提需求 → 模型按 skill 写乐谱 → `play_score` 工具校验后交给对话里的内联卡片播放与导出**。

卡片只负责呈现与播放（卷帘图 + 播放条 + 导出），作曲是模型在对话里干的活。

## 怎么构建

```bash
pnpm install
pnpm build        # = 抽引擎 + tsdown（宿主半 ESM + 客户端半 CJS 工厂）
pnpm test         # = 抽引擎 + 构建 + 类型检查 + 5 条判据
```

## 引擎从哪来（重要）

`src/engine.js` 是**生成物**，不要直接编辑：

- 唯一真源是仓库根的 `../index.html`，引擎在 `/* ==ENGINE-START== */` 与 `/* ==ENGINE-END== */` 之间（2012 行纯逻辑，不含任何 DOM 引用）。
- `scripts/extract-engine.mjs` 把它抽出来，末尾追加导出语句与一份手写 `.d.ts`。
- `test/verify-engine-copy.mjs` 守着「生成物与 index.html 的引擎块逐字节相同」。
  这条成立时，跑在 index.html 上的 141 项引擎验收（`node ../verify-engine.mjs`）就自动覆盖了插件里的引擎。

所以改引擎请改 `index.html`，然后 `pnpm build` 重新生成。

## 怎么装 / 卸

```bash
# 在插件包根目录执行（相对路径会被重锚到你的当前目录）
dsh plugin --profile web add ./
dsh plugin --profile web remove dsh-music-studio

# 装完必须重启服务：插件行是启动时装配进 cordis 树的
dsh web
```

改客户端代码不必重启：`pnpm watch`（`tsdown --watch`）重写 `lib/client.js` 后，`@deepseek-ai/dsh-client-hmr` 会把新包热替换进运行中的页面。

## 结构

| 文件 | 职责 |
|---|---|
| `src/engine.js` / `engine.d.ts` | 生成物：index.html 的引擎 + 导出与类型 |
| `src/shared/score-info.ts` | 乐谱读数：`countEvents` / `fmtDur` / `usedTimbres` / `isRenderable` |
| `src/index.ts` | 宿主半：常驻提示词段 + `play_score` 工具 + `music-studio` skill |
| `src/tool.ts` | 工具定义：校验 / 钳位 / 把规范化乐谱投影进结果 meta |
| `SKILL.md` | 作曲手艺：乐谱格式、32 音色、拍号、律动、音乐性、修订流程 |
| `src/client/index.tsx` | 客户端半：注册 `tool.call.toolview`（key = `play_score`） |
| `src/client/Card.tsx` | 卡片：标题行 + 卷帘图 + 播放条 + 导出 |
| `src/client/roll.ts` | 卷帘图与播放头自绘（搬自 index.html 的 `drawRoll`） |
| `src/client/audio.ts` | 播放排程（搬自 index.html 的滚动排程，含实测常数） |
| `src/client/theme.ts` | 明暗判定（量 `--dsw-alias-bg-base` 亮度）+ 音轨配色 |
| `src/client/card.module.css` | **只放布局**；视觉值一律取 `--dsw-*` 令牌 |

## 样式约束（硬要求，有判据守着）

- 控件一律复用 `@deepseek-ai/dsh-client-ui-primitives`，不重造。用到的导出名必须在**本机运行时**的 123 个名单里（`test/verify-card-surface.mjs` 守这条，防版本漂移变成 `undefined`）。
- 自写 CSS 只允许布局属性；一切视觉值必须是 `--dsw-*` 令牌，**不许出现字面颜色/字号/阴影**。
- 唯一豁免是 `theme.ts` 里那张音轨配色表：它来自 index.html，是用 CIE Lab ΔE76 算过的（两两最小 25.4 / 25.1、相对底色最低对比度 4.65:1 / 3.70:1，见 `tools/audit-palette.py`）。DSH 只有 `state-*` 那几个语义色，没有可互相区分的分类色，所以卷帘图的轨道色必须自带。

## 判据一览

| 判据 | 脚本 | 守什么 |
|---|---|---|
| 1 | `test/verify-engine-copy.mjs` | 引擎与 index.html 逐字节一致 |
| 2 | `../verify-engine.mjs` | 现有 141 项引擎验收仍全绿 |
| 3 | `test/verify-score-contract.mjs` | 乐谱校验三分支：合法通过 / 越界钳位且明说 / 结构错退回 |
| 4 | `test/verify-skill-timbres.mjs` | SKILL.md 的音色、拍号、律动清单与引擎一致 |
| 5 | `test/verify-card-surface.mjs` | 只用本机存在的组件；无跨插件值导入；无字面视觉值 |
| 6 | `test/verify-host-load.mjs` | 宿主半冷加载：`apply` 不抛、注册物形状正确、presenter 是纯函数 |
| 7 | `pnpm exec tsc --noEmit` | 对着真实的 DSH 类型校验（工具契约、槽位、组件 props） |
