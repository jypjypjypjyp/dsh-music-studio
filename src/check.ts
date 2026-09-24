/**
 * 长篇工作流的判据：调性、钳位、重复指纹。
 *
 * 三条判据都只用引擎已有的口径（`pitchToMidi`、`midiToName`、`clamp`）。
 * 插件里**不另写一套音名/音高规则** —— 写第二套就是给自己埋一个「两处口径
 * 不一致」的坑，而且这个坑只在长曲里才发作。
 *
 * 纯函数，不碰草稿、不碰 IO，所以能离线判定。
 */
import { clamp, midiToName, pitchToMidi } from './engine.js'
import type { Note } from './shared/score-info.js'

/** 大调与自然小调的音级（相对根音的半音数）。 */
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
/** 自然音级 → pitch class；升降号另外算。 */
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** 调性名 → 根音与大小调。`C`、`F#m`、`Bb` 认；`Sora` 这类认不出返回 null。 */
export function parseKey(key: string): { root: number; minor: boolean } | null {
  if (typeof key !== 'string') return null
  const m = /^([A-G])([#b]?)(m?)$/.exec(key.trim())
  if (m === null) return null
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return { root: (((LETTER[m[1]] + shift) % 12) + 12) % 12, minor: m[3] === 'm' }
}

/** 调性包含哪些 pitch class。认不出调性时返回 null（调用方自行决定怎么处理）。 */
export function scaleOf(key: string): Set<number> | null {
  const k = parseKey(key)
  if (k === null) return null
  return new Set((k.minor ? MINOR : MAJOR).map((d) => (k.root + d) % 12))
}

export interface OutOfKey { name: string; bar: number }

/**
 * 不在调内的音（最多前 3 个）。
 *
 * `barOf` 由调用方给：段内相对拍 → 小节号的换算只有草稿层知道，
 * 这里不猜段边界。
 */
export function outOfKey(notes: Note[], key: string, barOf: (startBeat: number) => number): OutOfKey[] {
  const scale = scaleOf(key)
  if (scale === null) return []
  const out: OutOfKey[] = []
  for (const n of notes) {
    const midi = Math.round(n.midi)
    if (scale.has(((midi % 12) + 12) % 12)) continue
    out.push({ name: midiToName(midi), bar: barOf(n.start) })
    if (out.length >= 3) break
  }
  return out
}

/**
 * 一格的指纹：把音符按音高/起点/时值排序拼成串。
 *
 * **刻意不看力度** —— 同一句换个力度还是同一句，那才算「复读」；
 * 把力度算进去会让复读检测静默失效。
 */
export function fingerprint(notes: Note[]): string {
  return notes.map((n) => `${Math.round(n.midi)}:${n.start}:${n.dur}`).sort().join('|')
}

/** 两格是不是逐音一致。空内容不算重复（空 vs 空没有意义）。 */
export function sameCell(a: Note[], b: Note[]): boolean {
  return a.length > 0 && a.length === b.length && fingerprint(a) === fingerprint(b)
}

export interface VetResult { notes: Note[]; dropped: number; clamps: string[] }

/** 读数字：认不出的（含 undefined/null/空串）返回默认值。 */
export function numOr(v: unknown, dflt: number): number {  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : dflt
  }
  return dflt
}

/**
 * 读一格的音符：认不出的音名、起点落在本段之外的音**直接丢弃并计数**；
 * 音高/时值/力度越界按引擎口径钳位，**每钳一次记一条**。
 *
 * @param raw 原始音符数组，元素形如 `[音高, 起始拍, 时值拍, 力度]`（起始拍相对本段）
 * @param sectionBeats 本段长度（拍）
 */
export function vetNotes(raw: unknown, sectionBeats: number): VetResult {
  const list = Array.isArray(raw) ? raw : []
  const notes: Note[] = []
  const clamps: string[] = []
  let dropped = 0
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!Array.isArray(item)) { dropped++; continue }
    const rawMidi = pitchToMidi(item[0])
    if (rawMidi === null) { dropped++; continue }
    const start = numOr(item[1], 0)
    if (!(start < sectionBeats)) {
      dropped++
      clamps.push(`第 ${i + 1} 个音的起点 ${start} 拍落在本段（${sectionBeats} 拍）之外，已丢弃`)
      continue
    }
    const midi = Math.round(rawMidi)
    const dur = numOr(item[2], 1)
    const vel = numOr(item[3], 0.75)
    const fixed = { midi: clamp(midi, 24, 100), dur: clamp(dur, 0.05, 16), vel: clamp(vel, 0.05, 1) }
    if (fixed.midi !== midi) {
      clamps.push(`第 ${i + 1} 个音的音高 ${midiToName(midi)} 超出范围，已钳到 ${midiToName(fixed.midi)}`)
    }
    if (fixed.dur !== dur) clamps.push(`第 ${i + 1} 个音的时值 ${dur} 拍超出范围，已钳到 ${fixed.dur} 拍`)
    if (fixed.vel !== vel) clamps.push(`第 ${i + 1} 个音的力度 ${vel} 超出范围，已钳到 ${fixed.vel}`)
    notes.push({ midi: fixed.midi, start: clamp(start, 0, sectionBeats), dur: fixed.dur, vel: fixed.vel })
  }
  return { notes, dropped, clamps }
}
