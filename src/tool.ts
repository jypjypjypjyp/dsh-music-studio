/**
 * play_score 工具：模型写出乐谱 JSON → 这里校验/钳位 → 规范化后的乐谱进
 * 结果的 meta → 浏览器卡片读 meta 播放。
 *
 * 零运行时 harness 导入：外部插件的 Node 半不得依赖 DSH 的模块图，
 * 所以所有 @deepseek-ai/* 都是 `import type`（编译期抹掉）。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  GenericCallView, GenericResultView, ToolDefinition, ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { GROOVES, METERS, normalizeScore, durationOf } from './engine.js'
import { countEvents, fmtDur, usedTimbres, isRenderable, type Score } from './shared/score-info.js'
import {
  applyEdit, assemble, createDraft, exportHeadline, exportVerdict, exportable,
  renderProgress, validateSkeleton, type Draft,
} from './draft.js'

/** 宿主半一律按专业档校验：接受音色库全集，不因档位口径丢数据。 */
const TIER = 'pro'

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    score: {
      type: 'object',
      description: [
        '完整乐谱 JSON（格式与规则见 music-studio skill）。传 JSON 对象，不要传字符串。',
        '旋律：{title, mood, mode:"melody", meter, bpm, bars, tracks:[{name, wave, gain, notes:[[pitch, startBeat, durBeats, velocity]]}], percussion:[[kind, beat, velocity]], fx:{reverb}}。',
        '音效：{title, mood, mode:"sfx", bpm, layers:[{src, wave, type, f0, f1, q, start, dur, attack, decay, gain, pan}]}。',
      ].join(' '),
    },
  },
  required: ['score'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'string',
  description: '一行中文小结：曲名 / 小节 / 音符数 / 时长 / 用到的音色 / 被钳位的项。',
}

/** 从原始调用参数里取乐谱；重放旧日志时参数可能不完整，所以防御式读。 */
function scoreOf(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return null
  return (args as { score?: unknown }).score ?? null
}

/** 卡片标题：能读出曲名就用曲名。纯函数（presenter 会在重放时被调用）。 */
function cardTitle(args: unknown): string {
  const raw = scoreOf(args)
  if (raw !== null && typeof raw === 'object') {
    const title = (raw as { title?: unknown }).title
    if (typeof title === 'string' && title.trim()) return `演奏《${title.trim()}》`
  }
  return '演奏'
}

/**
 * 从乐谱里取律动档位。
 *
 * **必须显式取出来传给引擎**：normalizeScore 的律动只认第 5 个参数，
 * 根本不看乐谱自带的 `groove` 字段。不取的话模型照着 skill 写
 * `"groove": "swing8_2"` 会被完全忽略 —— 音符不挪、也没有任何提示，
 * 听感上就是「说好的摇摆没了」。这个静默失效是实测才抓出来的。
 */
function grooveOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const g = (raw as { groove?: unknown }).groove
  if (typeof g !== 'string') return undefined
  const name = g.trim()
  return name === '' ? undefined : name
}

/**
 * 校验一遍并给出结论，execute 与 presentationMeta 共用同一条判据。
 *
 * 律动名认不出时**补一条警告**：引擎那边是 `GROOVES[groove] || {}`，也就是静默按
 * 直拍处理。既然这条线上的静默忽略正是当初失效的原因，就不该再留一个同样的坑。
 */
function vet(args: unknown): { score: Score | null; warn: string[] } {
  const raw = scoreOf(args)
  const wanted = grooveOf(raw)
  const { score, warn } = normalizeScore(raw, undefined, TIER, undefined, wanted)
  if (wanted !== undefined && !Object.prototype.hasOwnProperty.call(GROOVES, wanted)) {
    warn.push(`律动 ${wanted} 不在清单里（${Object.keys(GROOVES).join(' / ')}），已按直拍处理`)
  }
  if (!isRenderable(score as Score | null)) return { score: null, warn }
  return { score: score as Score, warn }
}

export function createPlayScoreTool(): ToolDefinition {
  return {
    name: 'play_score',
    description:
      '把一份乐谱 JSON 交给对话里的内联播放卡片：校验并规范化后，用户会看到乐谱卷帘图和播放条，可以试听、导出 WAV 与乐谱 JSON。'
      + '写谱的格式与创作规则见 music-studio skill。返回的一行小结会说清这张谱的规模，以及有哪些越界项被自动钳位——'
      + '小结里有钳位提示，说明原谱有不合法处。乐谱不可用时会退回可读原因，请改好再交一次。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA as never,
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return [{ type: 'text', text: String(value) }]
      },
      presentationMeta(args: unknown): JsonValue {
        // 卡片从这里读乐谱。重新校验一次（presenter 可能在重放旧参数时被调用）。
        const { score, warn } = vet(args)
        if (score === null) return null as unknown as JsonValue
        return { score, warn } as unknown as JsonValue
      },
    },
    async execute(args: unknown, _exec: ToolRunContext): Promise<unknown> {
      const { score, warn } = vet(args)
      if (score === null) {
        // 不抛异常：抛异常会让整轮工具调用失败，而这里想要的是「让模型自己改一版」。
        const reason = warn.length > 0 ? warn.join('；') : '没有任何可发声内容'
        return `play_score：乐谱不可用 —— ${reason}。请修正结构后重新调用（格式见 music-studio skill）。`
      }
      const events = countEvents(score)
      const tail = warn.length === 0 ? '没有越界项。' : `自动钳位/纠正了：${warn.join('；')}。`
      return `已交给播放卡片：《${score.title || '无题'}》 · ${score.bars} 小节 · ${events} 个音 · `
        + `${fmtDur(durationOf(score))} · ${score.bpm} BPM · 音色 ${usedTimbres(score).join('/') || '无'}。${tail}`
    },
    presentCall(args: unknown): GenericCallView | undefined {
      return { card: 'generic', title: cardTitle(args), kind: 'other' }
    },
    presentResult(args: unknown): GenericResultView | undefined {
      return { card: 'generic', title: cardTitle(args) }
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════
   长篇工作流：score_new / score_read / score_edit / score_export
   ══════════════════════════════════════════════════════════════════════

   短曲（≤16 小节）走 play_score 一次成谱，这四条是给长曲的：曲子太长时
   模型写在一个输出里必然越写越凑合（没骨架、没检查点、手力被摊薄），
   改成「骨架先定死 → 一次只填某段某乐器一格 → 每格立刻体检 → 合成一张谱」。

   草稿按会话隔离放在内存里：宿主重启就丢，届时工具会明说让模型重交 ——
   这条取舍是明说的，不是没想过。
   ══════════════════════════════════════════════════════════════════════ */

/** 会话 → 草稿。键取 `exec.agent.id`（会话 id）；取不到时退回单一槽位。 */
const DRAFTS = new Map<string, Draft>()
const DRAFT_FALLBACK = '(无会话)'

function draftKeyOf(exec: unknown): string {
  const id = (exec as { agent?: { id?: unknown } } | null)?.agent?.id
  return typeof id === 'string' && id !== '' ? id : DRAFT_FALLBACK
}

const NO_DRAFT = '没有正在进行的乐谱（宿主可能重启过）。请用 score_new 重新建谱，再按格补写。'

/** 进度/回执类工具的返回值：一行中文小结（模型看这个，卡片不出）。 */
const WORKFLOW_OUTPUT = {
  type: 'string',
  description: '给模型看的中文回执：本格的体检、全曲进度、下一步该写哪一格。',
}

function textRender(value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: String(value) }]
}

const SCORE_NEW_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '中文曲名' },
    mood: { type: 'string', description: '中文意象描述（一两个词或一句话）' },
    meter: { type: 'string', description: `拍号，取值：${Object.keys(METERS).join(' / ')}；不写按 4/4` },
    bpm: { type: 'number', description: '速度，40–200 的整数' },
    bars: { type: 'number', description: '全曲小节数（上限随拍号变化，见 music-studio skill 的拍号表）' },
    groove: { type: 'string', description: `律动档位：${Object.keys(GROOVES).join(' / ')}；不写就是直拍` },
    key: { type: 'string', description: '调性：A–G 加可选 # 或 b，小调末尾加 m，例如 C、F#、Bbm' },
    chords: { type: 'string', description: '和弦循环，空格分隔，例如 "C Am F G"；不写就不提示和弦' },
    chordsEvery: { type: 'number', description: '每个和弦占几小节（1–8，默认 1）' },
    tracks: {
      type: 'array',
      description: '乐器表（1–8 条）：每格内容都是写给其中某一个乐器的',
    },
    sections: {
      type: 'array',
      description: '段表：从第 1 小节起逐段相接、正好盖满全曲，每段不超过 16 小节',
    },
  },
  required: ['title', 'bars', 'key', 'tracks', 'sections'],
  additionalProperties: false,
}

const SCORE_EDIT_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    section: { type: 'number', description: '第几段（从 1 起，看 score_read 那张表）' },
    track: { type: 'string', description: '乐器名，必须是骨架里的 name（新乐器要同时给 wave）' },
    wave: { type: 'string', description: '仅新增乐器时给：音色名（见 skill 的音色清单）' },
    notes: {
      type: 'array',
      description: '本格音符：[音高, 起始拍, 时值拍, 力度]，起始拍**相对本段第一拍**（0 = 本段第 1 小节第 1 拍）。空数组 = 这一格刻意留白',
    },
    percussion: {
      type: 'array',
      description: '本格鼓点：[鼓件, 拍位, 力度]，拍位同样相对本段。给了它就不要给 track',
    },
  },
  required: ['section'],
  additionalProperties: false,
}

const NO_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

export function createScoreNewTool(): ToolDefinition {
  return {
    name: 'score_new',
    description:
      '给长篇乐谱（超过 16 小节）建骨架：调性、和弦循环、拍号、速度、律动、乐器表、段表。'
      + '建好之后用 score_edit 一格一格填（第 N 段 × 某个乐器），score_read 看进度，score_export 合成交给卡片。'
      + '骨架一旦建好，调性/音色/速度/律动就在格层面锁死了。'
      + '短曲（≤16 小节）直接用 play_score 一次成谱，不要走这条路。',
    parameters: SCORE_NEW_PARAMETERS,
    output: {
      schema: WORKFLOW_OUTPUT as never,
      render(_args: unknown, value: JsonValue): ContentBlock[] { return textRender(value) },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const { skeleton, reason } = validateSkeleton(args)
      if (skeleton === null) return `score_new：骨架不成立 —— ${reason}。改好再交一次。`
      const key = draftKeyOf(exec)
      const old = DRAFTS.get(key)
      DRAFTS.set(key, createDraft(skeleton))
      const head = old === undefined
        ? `已建立《${skeleton.title}》的骨架（${skeleton.bars} 小节 / ${skeleton.sections.length} 段 / ${skeleton.tracks.length} 个乐器）。`
        : `已建立《${skeleton.title}》的骨架，并丢弃了上一份未完成的《${old.skeleton.title}》。`
      return `${head}\n下一步：用 score_edit 逐格写内容（一次只写一格），随时可以 score_read 看进度。\n\n`
        + renderProgress(DRAFTS.get(key) as Draft)
    },
  }
}

export function createScoreReadTool(): ToolDefinition {
  return {
    name: 'score_read',
    description:
      '看当前这份乐谱的进度：每一段里每个乐器填了没有、多少个音、下一步该写哪一格，以及全曲体检总账。'
      + '上下文被压缩后、或不确定写到哪了，用它重新定位。',
    parameters: NO_PARAMETERS,
    output: {
      schema: WORKFLOW_OUTPUT as never,
      render(_args: unknown, value: JsonValue): ContentBlock[] { return textRender(value) },
    },
    async execute(_args: unknown, exec: ToolRunContext): Promise<unknown> {
      const draft = DRAFTS.get(draftKeyOf(exec))
      if (draft === undefined) return `score_read：${NO_DRAFT}`
      return renderProgress(draft)
    },
  }
}

export function createScoreEditTool(): ToolDefinition {
  return {
    name: 'score_edit',
    description:
      '写或改「第 N 段的某个乐器」这一格（整格替换，不动别的格）。'
      + '音符的起始拍**相对本段第一拍**算：0 就是本段第 1 小节第 1 拍。'
      + '写完立刻体检：不在调内的音、被钳位/丢弃的音、以及本格是否与已写的某格逐音一致（一致会被退回重写）。',
    parameters: SCORE_EDIT_PARAMETERS,
    output: {
      schema: WORKFLOW_OUTPUT as never,
      render(_args: unknown, value: JsonValue): ContentBlock[] { return textRender(value) },
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const draft = DRAFTS.get(draftKeyOf(exec))
      if (draft === undefined) return `score_edit：${NO_DRAFT}`
      return applyEdit(draft, args).reply
    },
  }
}

export function createScoreExportTool(): ToolDefinition {
  return {
    name: 'score_export',
    description:
      '把已写的格合成一份完整乐谱，交给对话里的播放卡片（卷帘图 + 播放条 + 导出 WAV 与乐谱 JSON）。'
      + '允许导出已写部分：只写齐第 1 段时导出，那张卡就是样张；写齐后再导出就是整曲。'
      + '还没写齐会点名还差哪些格。',
    parameters: NO_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '给模型看的一行小结' },
          score: { type: 'object', description: '合成后的完整乐谱（卡片读它，模型看不到）' },
          warn: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'score'],
      } as never,
      render(_args: unknown, value: JsonValue): ContentBlock[] {
        return textRender(String((value as { summary?: unknown }).summary ?? ''))
      },
      presentationMeta(_args: unknown, value: JsonValue): JsonValue {
        const v = value as { score?: unknown; warn?: unknown }
        return { score: v.score, warn: Array.isArray(v.warn) ? v.warn : [] } as unknown as JsonValue
      },
    },
    async execute(_args: unknown, exec: ToolRunContext): Promise<unknown> {
      const draft = DRAFTS.get(draftKeyOf(exec))
      if (draft === undefined) {
        return { summary: `score_export：${NO_DRAFT}`, score: {}, warn: [] }
      }
      const a = assemble(draft, { trim: true })
      if (!exportable(a)) {
        return { summary: 'score_export：这份谱还一个音都没有，先 score_edit 写一格再来。', score: {}, warn: [] }
      }
      const lines = [
        `已交给播放卡片：《${draft.skeleton.title}》 · ${exportHeadline(a, draft)}`,
      ]
      if (a.missing.length > 0) {
        lines.push(`还差 ${a.missing.length} 格：${a.missing.join('、')}。`)
        lines.push('如果这是样张，请等主人点头后再继续；否则继续 score_edit 补写剩下的格。')
      }
      lines.push(exportVerdict(a, draft))
      return { summary: lines.join('\n'), score: a.score, warn: a.warn }
    },
  }
}
