/**
 * 播放器：把 index.html 里的滚动排程逐行搬进一个类。
 *
 * 搬运时只改了三件事：模块级状态 → 实例字段；`analyser` 去掉（本版不做频谱）；
 * 每帧的 DOM 更新 → 一个 onTick 回调。**其余原样**，包括下面这些注释里
 * 的实测数据 —— 那是这段代码最值钱的部分，不是装饰。
 */
import { buildBus, scheduleRange, clamp, HEADROOM, beatsOf, durationOf } from '../engine.js'
import type { Score } from '../shared/score-info.js'

export class ScorePlayer {
  private readonly score: Score
  private onTick?: (beat: number) => void

  private ac: AudioContext | null = null
  private live: {
    bus: any; beatSec: number; totalBeats: number; fromBeat: number; t0First: number
    batches: Array<{ gain: any; nodes: any[]; cleanupAt: number }>
    horizonBeat: number; horizonTime: number
  } | null = null
  private playing = false
  private looping = false
  private volume = 1
  private posBeat = 0
  private schedTimer = 0
  private rafId = 0

  constructor(score: Score) { this.score = score }

  static supported(): boolean {
    return typeof window !== 'undefined' || typeof globalThis.AudioContext !== 'undefined'
  }

  subscribe(cb: (beat: number) => void): () => void {
    this.onTick = cb
    return () => { this.onTick = undefined }
  }

  get isPlaying(): boolean { return this.playing }
  /** 拍位。钳到非负 —— 音频上下文被浏览器挂起时 currentTime 停在 0，
      算出来的 elapsed 会是负数，直接显示出去就是「-1:00」这种脏数字。 */
  get beat(): number { return Math.max(0, this.posBeat) }
  get isLooping(): boolean { return this.looping }

  private ensureAudio(): AudioContext {
    if (this.ac === null) {
      const Ctor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext
      this.ac = new Ctor()
    }
    if (this.ac !== null && this.ac.state === 'suspended') void this.ac.resume()
    return this.ac as AudioContext
  }

  /** 数一遍这张谱要建多少个音源节点（与 scheduleRange 的遍历口径一致）。 */
  private countSources(): number {
    const s = this.score
    if (!s) return 0
    if (s.mode === 'sfx') return s.layers.length
    let n = 0
    for (const t of s.tracks) n += t.notes.length
    return n + s.percussion.length
  }

  /** 同上，但只数 [fromBeat, toBeat) 这一段 —— 滚动排程按窗口预留排程时间用。 */
  private countSourcesInRange(fromBeat: number, toBeat: number): number {
    const s = this.score
    if (!s) return 0
    const beatSec = 60 / s.bpm
    let n = 0
    if (s.mode === 'sfx') {
      const fromSec = fromBeat * beatSec
      const toSec = toBeat * beatSec
      for (const L of s.layers) if (L.start < toSec && L.start + L.dur + L.decay > fromSec) n++
      return n
    }
    for (const t of s.tracks) for (const x of t.notes) if (x.start < toBeat && x.start + x.dur > fromBeat) n++
    for (const p of s.percussion) if (p.beat >= fromBeat && p.beat < toBeat) n++
    return n
  }

  /**
   * 实时播放的预排窗口该留多长。
   *
   * 为什么需要它：一批音是在主线程上一次同步建完的（几百个振荡器/滤波器/增益），
   * 而 t0 在建图**之前**就定了。若建图比预留量还久，排在开头的那些音的 start 时刻
   * 已经落入过去，Web Audio 会把它们一并钳到「现在」同时炸响——开头挤成一坨。
   *
   * 所以不写死常数：先在本机量一下「裸建一个节点要多久」，再按音源数折算该推后多少。
   * 慢机器自动多留、快机器不白等。**系数 K 是实测出来的**，不是估的：
   * 真机上量得实付成本 44–49 µs/音源，而裸建节点 7.3 µs/个，
   * 即 K = 实付/裸建 ≈ 6.1–6.8（多出来的部分是写 AudioParam 自动化曲线的开销）；
   * 音源数逼近上限（6800）时实付涨到约 90 µs/音源，说明略超线性。故取 K=12 留余量。
   */
  private static readonly PREROLL_K = 12      // 实付成本 ÷ 裸建节点成本，实测 6.1–6.8，极端档更高
  private static readonly PREROLL_MIN = 0.12  // 秒
  private static readonly PREROLL_MAX = 2.0

  private preRollSeconds(nOverride?: number): number {
    const ctx = this.ac
    const n = nOverride === undefined ? this.countSources() : nOverride
    if (!ctx || !n) return ScorePlayer.PREROLL_MIN
    const PROBE = 32
    // 探两次取快的：首次会被 JIT 冷启动污染（实测首探 0.0396ms/节点，次探 0.0073ms）。
    let perNodeMs = Infinity
    try {
      for (let round = 0; round < 2; round++) {
        let sink: any = null
        try {
          const t = performance.now()
          sink = ctx.createGain()
          for (let i = 0; i < PROBE; i++) {
            const o = ctx.createOscillator()
            const f = ctx.createBiquadFilter()
            const g = ctx.createGain()
            o.connect(f); f.connect(g); g.connect(sink)
          }
          const ms = (performance.now() - t) / PROBE / 3   // 每个节点
          if (ms < perNodeMs) perNodeMs = ms
        } finally { try { if (sink) sink.disconnect() } catch { /* 忽略 */ } }
      }
      if (!isFinite(perNodeMs) || perNodeMs <= 0) return 0.35
      return clamp(ScorePlayer.PREROLL_MIN + (n * perNodeMs * ScorePlayer.PREROLL_K) / 1000,
        ScorePlayer.PREROLL_MIN, ScorePlayer.PREROLL_MAX)
    } catch {
      return 0.35   // 量不出来就退回一个够用的值
    }
  }

  private static readonly SCHED_WINDOW = 20   // 秒：一次往未来排多少音乐
  private static readonly SCHED_HORIZON = 8   // 秒：未来剩余不足这么多就补排
  private static readonly BATCH_TAIL = 2.5    // 秒：一批排完后多留这么久再断开，等混响尾巴收干净

  play(fromBeat: number): void {
    const s = this.score
    if (!s) return
    this.stopAudio()
    const ctx = this.ensureAudio()
    const beatSec = 60 / s.bpm
    const totalBeats = s.mode === 'sfx' ? durationOf(s) / beatSec : s.bars * beatsOf(s)
    // 只按**第一个窗口**的规模预留排程时间：建图量已经与曲长无关了。
    const firstN = this.countSourcesInRange(fromBeat, fromBeat + ScorePlayer.SCHED_WINDOW / beatSec)
    const t0 = ctx.currentTime + this.preRollSeconds(firstN)
    this.live = {
      bus: buildBus(ctx, ctx.destination, { volume: this.volume }, s),
      beatSec, totalBeats, fromBeat, t0First: t0,
      batches: [], horizonBeat: fromBeat, horizonTime: t0,
    }
    this.playing = true
    this.pump()                                     // 先把第一个窗口排上
    this.schedTimer = setInterval(() => this.pump(), 500) as unknown as number  // rAF 在后台标签页会停，这个兜底
    this.onTick?.(this.posBeat)
    cancelAnimationFrame(this.rafId)
    this.tick()
  }

  /** 排一批：从 horizonBeat 起、最多 SCHED_WINDOW 秒的音乐。循环时到曲末自动回绕。 */
  private scheduleChunk(): void {
    const L = this.live
    const s = this.score
    if (!L) return
    const total = L.totalBeats
    const wBeats = Math.max(0.25, ScorePlayer.SCHED_WINDOW / L.beatSec)
    const until = L.horizonBeat + wBeats
    let cur = L.horizonBeat
    while (cur < until && (this.looping || cur < total)) {
      const loopIdx = Math.floor(cur / total)          // 已经绕了几圈
      const segEnd = Math.min(until, (loopIdx + 1) * total)
      const nodes: any[] = []
      const g = (this.ac as AudioContext).createGain()
      g.connect(L.bus.master)
      const end = scheduleRange(this.ac as AudioContext, g, s, {
        t0: L.t0First + (cur - L.fromBeat) * L.beatSec,
        fromBeat: cur - loopIdx * total,
        toBeat: segEnd - loopIdx * total,
        // 只有「起播那一批」允许把跨过起点的长音切一半接着响；后续批不许重排它。
        midNote: cur === L.fromBeat,
        nodes,
      })
      L.batches.push({ gain: g, nodes, cleanupAt: end + ScorePlayer.BATCH_TAIL })
      cur = segEnd
    }
    L.horizonBeat = cur
    L.horizonTime = L.t0First + (cur - L.fromBeat) * L.beatSec
  }

  /** 补排 + 清理已播完的批。tick 每帧调一次，另有 500ms 定时器兜底。 */
  private pump(): void {
    const L = this.live
    if (!L || !this.playing || !this.ac || !(L.totalBeats > 0)) return
    let guard = 0
    while (L.horizonTime - this.ac.currentTime < ScorePlayer.SCHED_HORIZON
      && (this.looping || L.horizonBeat < L.totalBeats) && guard++ < 64) {
      this.scheduleChunk()
    }
    const now = this.ac.currentTime
    for (let i = L.batches.length - 1; i >= 0; i--) {
      const bt = L.batches[i]
      if (now > bt.cleanupAt) {
        for (const n of bt.nodes) { try { n.stop(0) } catch { /* 忽略 */ } try { n.disconnect() } catch { /* 忽略 */ } }
        try { bt.gain.disconnect() } catch { /* 忽略 */ }
        L.batches.splice(i, 1)
      }
    }
  }

  private currentBeat(): number {
    const L = this.live
    if (!L || !this.ac) return this.posBeat
    const totalDur = L.totalBeats * L.beatSec
    const elapsed = this.ac.currentTime - L.t0First
    // 起播点可能是中途，所以相位要把起始拍补回来，
    // 否则「中途起播 + 循环」会在回环点跳拍。
    if (this.looping) return ((L.fromBeat * L.beatSec + elapsed) % totalDur) / L.beatSec
    return elapsed / L.beatSec + L.fromBeat
  }

  private tick = (): void => {
    if (!this.playing) return
    const s = this.score
    const beat = this.currentBeat()
    const totalBeats = s.mode === 'sfx' ? durationOf(s) / (60 / s.bpm) : s.bars * beatsOf(s)
    this.pump()
    if (beat >= totalBeats + 0.02 && !this.looping) {
      this.posBeat = totalBeats
      this.stop()
      return
    }
    this.posBeat = Math.min(Math.max(0, beat), totalBeats)
    this.onTick?.(this.posBeat)
    this.rafId = requestAnimationFrame(this.tick)
  }

  private stopAudio(): void {
    const L = this.live
    if (L) {
      for (const bt of L.batches) {
        for (const n of bt.nodes) { try { n.stop(0) } catch { /* 忽略 */ } }
        try { bt.gain.disconnect() } catch { /* 忽略 */ }
      }
      try { L.bus.master.disconnect() } catch { /* 忽略 */ }
      try { L.bus.limiter.disconnect() } catch { /* 忽略 */ }
    }
    if (this.schedTimer) { clearInterval(this.schedTimer); this.schedTimer = 0 }
    this.live = null
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.stopAudio()
    this.playing = false
    this.posBeat = 0
    this.onTick?.(this.posBeat)
  }

  pause(): void {
    cancelAnimationFrame(this.rafId)
    this.stopAudio()
    this.playing = false
    this.onTick?.(this.posBeat)
  }

  setLoop(next: boolean): void {
    this.looping = next
    // 开→要让它把回环那一段排上；关→排到曲末就自然停手，都是 pump 的活。
    if (this.playing) this.pump()
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.live && this.ac) {
      try { this.live.bus.master.gain.setTargetAtTime(v * HEADROOM, this.ac.currentTime, 0.02) } catch { /* 忽略 */ }
    }
  }

  /** 总拍数（供进度条换算）。 */
  get totalBeats(): number {
    const s = this.score
    return s.mode === 'sfx' ? durationOf(s) / (60 / s.bpm) : s.bars * beatsOf(s)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.stopAudio()
    this.playing = false
    this.onTick = undefined
    try { void this.ac?.close() } catch { /* 忽略 */ }
    this.ac = null
  }
}
