# @jypjypjypjyp/dsh-music-studio

在对话里作曲：**模型按内置作曲规范写出乐谱 JSON → `play_score` 工具校验后交给对话里的内联卡片播放与导出**。

卡片只负责呈现与播放（卷帘图 + 播放条 + 导出），作曲是模型在对话里干的活；UI 全部由 `@deepseek-ai/dsh-client-ui-primitives` 的现成控件搭成。

本项目是「弦外」单文件音景工坊的 DSH 插件形态。音频引擎（2012 行纯逻辑、无 DOM 依赖）在**主仓库**构建时从那个单文件网页抽取；**本仓库带着已生成的引擎**，因此可以脱离主仓库独立构建与安装。

## 怎么装

```bash
dsh plugin --profile web add github:jypjypjypjyp/dsh-music-studio
dsh plugin --profile web remove @jypjypjypjyp/dsh-music-studio   # 卸载

# 装完必须重启服务：插件行是启动时装配进 cordis 树的
dsh web
```

本地开发则把上面的 `github:...` 换成插件包路径（`dsh plugin --profile web add ./`，必须在插件包根目录执行）。

改客户端代码不必重启：`pnpm watch`（`tsdown --watch`）重写 `lib/client.js` 后，`@deepseek-ai/dsh-client-hmr` 会把新包热替换进运行中的页面。

## 怎么构建

```bash
pnpm install
pnpm build        # = （有引擎真源就抽取）+ tsdown（宿主半 ESM + 客户端半 CJS 工厂）
pnpm test         # = 构建 + 类型检查 + 7 条判据
```

## 引擎从哪来

`src/engine.js` 是**生成物**，不要直接编辑。它的唯一真源是主仓库的 `index.html`：引擎写在该文件的 `/* ==ENGINE-START== */` 与 `/* ==ENGINE-END== */` 之间（2012 行纯逻辑，不含任何 DOM 引用），由 `scripts/extract-engine.mjs` 抽出并在末尾追加导出语句与一份手写 `.d.ts`。

- **在主仓库里**：`pnpm build` 每次重新抽取，`test/verify-engine-copy.mjs` 守着「生成物与 index.html 的引擎块逐字节相同」。这条成立时，跑在 `index.html` 上的 141 项引擎验收就自动覆盖了插件里的引擎。
- **在本仓库（独立发布版）里**：没有 `index.html`，抽取脚本会**大声跳过**并继续使用已提交的 `src/engine.js`，判据 1 打印 `SKIP` 而不是假装通过。改引擎请回主仓库改。

## 怎么装 / 卸

见上方「怎么装」。本地开发与从 GitHub 安装共用同一条命令，只换依赖来源。

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
| 1 | `test/verify-engine-copy.mjs` | 引擎与 index.html 逐字节一致（主仓库；独立发布版打印 SKIP） |
| 2 | `../verify-engine.mjs` | 现有 141 项引擎验收仍全绿 |
| 3 | `test/verify-score-contract.mjs` | 乐谱校验三分支：合法通过 / 越界钳位且明说 / 结构错退回 |
| 4 | `test/verify-skill-timbres.mjs` | SKILL.md 的音色、拍号、律动清单与引擎一致 |
| 5 | `test/verify-card-surface.mjs` | 只用本机存在的组件；无跨插件值导入；无字面视觉值 |
| 6 | `test/verify-theme-color.mjs` | 明暗判定的颜色解析（DSH 令牌是 8 位带 alpha 的十六进制，只认 3/6 位会永远走兜底） |
| 7 | `test/verify-host-load.mjs` | 宿主半冷加载：`apply` 不抛、注册物形状正确、presenter 是纯函数 |
| 8 | `test/verify-groove.mjs` | 律动真的生效：乐谱写 `swing8_2`，半拍上的音必须被挪；名字写错必须明说不许静默忽略 |
| 9 | `pnpm exec tsc --noEmit` | 对着真实的 DSH 类型校验（工具契约、槽位、组件 props） |
