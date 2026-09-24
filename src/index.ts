/**
 * 弦外 · 宿主半。
 *
 * 常驻提示词段刻意极短：只讲「能力存在」和「完整规范在 skill 里」。
 * 体积留给 skill，免得每次会话都背一大段乐理。
 *
 * `tools` 与 `skills` 故意不写进 inject：cordis 的 inject 是硬激活门，
 * 声明了一个没人提供的服务会让整条 fiber 永远等在原地、apply 根本跑不到。
 * 用可选的 ctx.inject([...], cb) 才对。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPlayScoreTool, createScoreEditTool, createScoreExportTool,
  createScoreNewTool, createScoreReadTool,
} from './tool.js'

export const name = '@jypjypjypjyp/dsh-music-studio'
export const inject = ['systemPrompt']

const SKILL_NAME = 'music-studio'
const SKILL_DESCRIPTION = '弦外作曲规范：乐谱 JSON 结构、32 种音色、拍号与律动规则，短曲交给 play_score 卡片，长曲（>16 小节）用 score_new / score_edit / score_read / score_export 分格写。'

/** 常驻提示词段：只放必须一直在场的契约。 */
export const XIANWAI_SECTION_TEXT = `用户想听音乐、音效，或要改一支曲子时，你用乐谱工具把曲子交给对话里的播放卡片；写谱规范见 music-studio skill。

- **短曲（≤16 小节）**：按 skill 写出完整乐谱 JSON，调 play_score({ score: {...} }) 一次成谱——参数是 JSON 对象，不是字符串。
- **长曲（>16 小节）**：走 score_new → score_edit（一次只写一格：某段 × 某乐器）→ score_read（看进度）→ score_export（合成出卡）。长曲一次成谱必然越写越凑合，分格写并让工具逐格体检才对。
- 卡片负责呈现与播放（卷帘图 + 播放条 + 导出），不负责作曲：作曲是你的活。
- 工具返回的小结里若有「自动钳位」提示，说明原谱有不合法处；乐谱不可用时会退回可读原因，改好再交一次。
- 用户提修改意见时：短曲重写整张谱再交一次；长曲只重写被点名的那一格，再 score_export。`

function bundledSkillProvider(): SkillProvider {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = basename(here) === 'plugin' ? resolve(here, '../../SKILL.md') : resolve(here, '../SKILL.md')
  const raw = readFileSync(path, 'utf8')
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) throw new Error('music-studio SKILL.md 的 frontmatter 格式不对')
  const meta = {
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true } as const,
    source: 'bundled' as const,
    provider: '@jypjypjypjyp/dsh-music-studio',
    path,
    resourceBase: { kind: 'directory' as const, path: dirname(path) },
    rank: 600,
    locator: path,
  }
  return {
    name: '@jypjypjypjyp/dsh-music-studio',
    list: () => Promise.resolve([meta]),
    get: () => Promise.resolve({ ...meta, content: raw.slice(end + 5) }),
  }
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'music-studio:score',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: XIANWAI_SECTION_TEXT,
  })
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(function* () {
      // 顺序有意义：play_score 必须排第一（现有判定脚本按 tools[0] 取它）。
      yield toolsCtx.tools.register(createPlayScoreTool())
      yield toolsCtx.tools.register(createScoreNewTool())
      yield toolsCtx.tools.register(createScoreReadTool())
      yield toolsCtx.tools.register(createScoreEditTool())
      yield toolsCtx.tools.register(createScoreExportTool())
    }, 'music-studio: 乐谱工具')
  })
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => bundledSkillProvider())
  })
}
