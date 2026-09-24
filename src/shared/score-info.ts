/**
 * 乐谱读数：宿主半（写工具小结）与卡片（写标题行）共用同一份口径，
 * 避免两处各算一遍、数字对不上。
 */
export interface Note { midi: number; start: number; dur: number; vel: number }
export interface Track { name: string; wave: string; gain: number; notes: Note[] }
export interface PercEvent { kind: string; beat: number; vel: number }
/** 音效层的形状 —— 与引擎 normalizeScore 的 sfx 分支逐个字段对齐。 */
export interface Layer {
  src: 'noise' | 'tone'
  wave: string
  type: string
  f0: number
  f1: number
  q: number
  start: number
  dur: number
  attack: number
  decay: number
  gain: number
  pan: number
}
export interface Section { label: string; role: string; fromBar: number; toBar: number }
export interface Score {
  title: string; mood: string; mode: 'melody' | 'sfx'; bpm: number; bars: number;
  meter: string; tracks: Track[]; percussion: PercEvent[];
  layers: Layer[]; sections?: Section[];
  fx?: { reverb?: number }; groove?: string;
}

/** 音符 + 打击乐的总事件数（与 index.html 的 countEvents 同口径）。 */
export function countEvents(score: Score): number {
  if (score.mode === 'sfx') return score.layers.length
  let n = score.percussion.length
  for (const t of score.tracks) n += t.notes.length
  return n
}

/** 秒 → m:ss。 */
export function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 这张谱实际用到的音色名（去重、保序）。 */
export function usedTimbres(score: Score): string[] {
  const out: string[] = []
  for (const t of score.tracks) if (!out.includes(t.wave)) out.push(t.wave)
  for (const l of score.layers) {
    if (typeof l.wave === 'string' && l.wave && !out.includes(l.wave)) out.push(l.wave)
  }
  return out
}

/**
 * 一张谱能不能交给卡片 —— 全插件只有这一条判据：**至少有一个可发声事件**。
 *
 * 为什么不能只看 normalizeScore 是否返回 null：实测引擎对「tracks 不是数组」
 * 这类结构错不会返回 null，而是返回一张**没有音轨的空谱**加一句警告。空谱交给
 * 卡片就是一张点了没反应的卡，所以这里必须再卡一道。
 */
export function isRenderable(score: Score | null | undefined): boolean {
  if (score === null || score === undefined) return false
  return countEvents(score) > 0
}
