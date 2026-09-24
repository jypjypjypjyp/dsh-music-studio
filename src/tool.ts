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
import { GROOVES, normalizeScore, durationOf } from './engine.js'
import { countEvents, fmtDur, usedTimbres, isRenderable, type Score } from './shared/score-info.js'

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
