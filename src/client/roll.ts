/**
 * 卷帘图与播放头的自绘。
 *
 * 绘制逻辑逐行搬自 index.html 的 drawRoll / drawPlayhead，只改了三处来源：
 * 颜色从 index.html 自己的 CSS 变量改为 DSH 的 `--dsw-alias-*` 语义令牌，
 * 字体从写死的 Songti/等宽改为读主题字体，
 * 以及模块级状态（roll/rctx/geo/state.*）改为函数参数与返回值。
 *
 * 为什么这些视觉判断值得原样保留：小节号抽稀步长、音块透明度＝力度、
 * 同音高多轨分层排布、>48 小节时横向压缩 —— 都是为了让压缩后的图仍然可读，
 * 是调出来的，不是随手写的。
 */
import { beatsOf, durationOf, fmtTime, midiToName } from '../engine.js'
import type { Score } from '../shared/score-info.js'

export interface RollGeo {
  padL: number; padT: number; plotW: number; plotH: number
  totalBeats: number; hi: number; lo: number; rowH: number
  xOfBeat(beat: number): number
}

export interface RollTheme {
  /** 前景（音块/打击乐） */
  fg: string
  /** 次要文字 */
  mute: string
  /** 网格线（弱线/黑键底纹用它的低透明度版本，不再另造一个颜色） */
  line: string
  /** 音轨分类色（8 个，来自 index.html 那张用 ΔE76 算过的表） */
  colors: string[]
  /** 画布字体（读主题字体，不写死） */
  font: string
  mono: string
}

/**
 * 从宿主元素上读 DSH 的语义令牌与主题字体。
 *
 * 所有兜底都用**浏览器已经解析好的继承值**（`cs.color` / `cs.fontFamily`），
 * 不写任何字面颜色 —— 令牌万一读不到，画出来的仍是当前主题的文字色，
 * 而不是我凭空挑的一个灰。
 */
export function readTheme(root: HTMLElement): RollTheme {
  const cs = getComputedStyle(root)
  const inherited = cs.color
  const v = (n: string) => cs.getPropertyValue(n).trim() || inherited
  const family = cs.fontFamily || 'sans-serif'
  return {
    fg: v('--dsw-alias-label-primary'),
    mute: v('--dsw-alias-label-tertiary'),
    line: v('--dsw-alias-border-l2'),
    colors: [],
    font: family,
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  }
}

/** 把一段绘制包在指定透明度里（弱线用的是主网格线的低透明度版本）。 */
function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void): void {
  const prev = ctx.globalAlpha
  ctx.globalAlpha = alpha
  draw()
  ctx.globalAlpha = prev
}

/** 按设备像素比把画布调好，返回 CSS 像素下的宽高。 */
export function fitCanvas(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dpr: number, cssH?: number) {
  const w = cv.clientWidth || 800
  const h = cssH || cv.clientHeight || 180
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h }
}

export function drawRoll(
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  dpr: number,
  s: Score | null,
  th: RollTheme,
): RollGeo | null {
  const { w, h } = fitCanvas(cv, ctx, dpr)
  ctx.clearRect(0, 0, w, h)
  const { fg, mute, line } = th
  if (!s) {
    ctx.fillStyle = mute
    ctx.font = `14px ${th.font}`
    ctx.textAlign = 'center'
    ctx.fillText('尚无乐谱', w / 2, h / 2)
    return null
  }
  const sections = (s as unknown as { sections?: Array<{ label: string; role: string; fromBar: number; toBar: number }> }).sections ?? []
  const hasSec = s.mode === 'melody' && sections.length > 0
  // 有曲式条时把顶部留宽 12px，给段落标签腾位置
  const padL = 46
  const padR = 14
  const padT = hasSec ? 28 : 16
  const padB = 22
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const dur = durationOf(s)
  const beatSec = 60 / s.bpm
  const bpb = beatsOf(s)
  const totalBeats = s.mode === 'sfx' ? dur / beatSec : s.bars * bpb

  // 音高范围
  let lo = 127
  let hi = 0
  if (s.mode === 'melody') for (const t of s.tracks) for (const n of t.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi) }
  if (lo > hi) { lo = 48; hi = 72 }
  lo -= 2
  hi += 2
  const rows = hi - lo + 1
  const percRows = s.mode === 'melody' ? new Set(s.percussion.map((p) => p.kind)).size : 0
  const percH = percRows ? 22 : 0
  const noteAreaH = plotH - percH
  const rowH = noteAreaH / rows

  const xOfBeat = (b: number) => padL + (b / (totalBeats || 1)) * plotW
  const yOfMidi = (m: number) => padT + (hi - m) * rowH + rowH / 2
  const cx = Math.max(0, xOfBeat(Math.min(dur / beatSec, totalBeats)))

  const geo: RollGeo = {
    padL, padT, plotW, plotH, totalBeats, hi, lo, rowH, xOfBeat,
  }

  // 黑键底纹
  ctx.save()
  for (let m = lo; m <= hi; m++) {
    const pcs = ((m % 12) + 12) % 12
    if ([1, 3, 6, 8, 10].includes(pcs)) {
      ctx.fillStyle = line
      withAlpha(ctx, 0.14, () => ctx.fillRect(padL, padT + (hi - m) * rowH, plotW, rowH))
    }
  }
  ctx.restore()

  // 网格：小节与拍
  // 120 小节的曲子若每小节都标号、每拍都画线，会糊成一片。按密度抽稀：
  // 拍线只在足够宽时才画，小节号按 1/2/4/8/16 的步长递进。
  const barCount = totalBeats / bpb
  const pxPerBeat = plotW / Math.max(1, totalBeats)
  const barStep = barCount > 96 ? 16 : barCount > 48 ? 8 : barCount > 24 ? 4 : barCount > 12 ? 2 : 1
  const drawBeats = pxPerBeat >= 4
  for (let b = 0; b <= totalBeats; b++) {
    const isBar = b % bpb === 0
    if (!isBar && !drawBeats) continue
    const x = xOfBeat(b)
    ctx.strokeStyle = line
    ctx.lineWidth = 1
    const strokeLine = () => {
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT); ctx.lineTo(Math.round(x) + 0.5, padT + plotH); ctx.stroke()
    }
    if (isBar) strokeLine()
    else withAlpha(ctx, 0.35, strokeLine)
    if (isBar && b < totalBeats && (b / bpb) % barStep === 0) {
      ctx.fillStyle = mute; ctx.font = `10px ${th.mono}`; ctx.textAlign = 'left'
      ctx.fillText(String(b / bpb + 1), Math.round(x) + 4, padT - 4)
    }
  }

  // 曲式条：长篇的「骨架」在压缩后的卷帘图上比单个音符更可读
  if (hasSec) {
    const bandY = padT - 14
    const bandH = 7
    ctx.save()
    ctx.font = `9.5px ${th.mono}`
    ctx.textAlign = 'left'
    sections.forEach((sec, i) => {
      const x0 = xOfBeat((sec.fromBar - 1) * bpb)
      const x1 = xOfBeat(Math.min(sec.toBar, barCount) * bpb)
      const wpx = Math.max(2, x1 - x0)
      ctx.fillStyle = th.colors.length > 0 ? th.colors[i % th.colors.length] : fg
      ctx.globalAlpha = 0.55
      ctx.fillRect(x0, bandY, wpx, bandH)
      ctx.globalAlpha = 1
      if (wpx > 26) {
        ctx.fillStyle = mute
        ctx.fillText(sec.label + (sec.role ? ' ' + sec.role : ''), x0 + 3, bandY + 6.5)
      }
    })
    ctx.restore()
  }

  // 音名参考（C）
  ctx.fillStyle = mute; ctx.font = `9px ${th.mono}`; ctx.textAlign = 'right'
  for (let m = lo; m <= hi; m++) {
    if (m % 12 === 0) ctx.fillText(midiToName(m), padL - 6, yOfMidi(m) + 3)
  }

  if (s.mode === 'melody') {
    // 音块
    const laneRows = new Map<number, Set<string>>()
    for (const t of s.tracks) for (const n of t.notes) {
      const k = n.midi
      if (!laneRows.has(k)) laneRows.set(k, new Set())
      laneRows.get(k)!.add(t.name)
    }
    s.tracks.forEach((track, ti) => {
      const color = th.colors.length > 0 ? th.colors[ti % th.colors.length] : fg
      for (const n of track.notes) {
        const lanes = laneRows.get(n.midi)!
        const li = Array.from(lanes).indexOf(track.name)
        const ln = lanes.size
        const subH = Math.max(2.5, rowH - 2)
        const hh = subH / ln
        const x0 = xOfBeat(n.start)
        const bw = Math.max(2, xOfBeat(n.start + n.dur) - x0 - 1)
        const yTop = yOfMidi(n.midi) - subH / 2 + li * hh
        ctx.globalAlpha = 0.42 + n.vel * 0.5
        ctx.fillStyle = color
        const r = Math.min(3, hh / 2.2, bw / 2.2)
        ctx.beginPath()
        if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function') {
          ctx.roundRect(x0, yTop + 0.5, bw, Math.max(2, hh - 1), r)
        } else {
          ctx.rect(x0, yTop + 0.5, bw, Math.max(2, hh - 1))
        }
        ctx.fill()
      }
    })
    ctx.globalAlpha = 1

    // 打击乐轨
    if (s.percussion.length) {
      const base = padT + noteAreaH + 4
      ctx.strokeStyle = line
      withAlpha(ctx, 0.35, () => {
        ctx.beginPath()
        ctx.moveTo(padL, base - 2.5); ctx.lineTo(padL + plotW, base - 2.5); ctx.stroke()
      })
      const kinds = [...new Set(s.percussion.map((p) => p.kind))]
      const rowH2 = Math.max(3, (percH - 8) / Math.max(1, kinds.length))
      for (const p of s.percussion) {
        const ki = kinds.indexOf(p.kind)
        const y = base + ki * rowH2
        const x = xOfBeat(p.beat)
        ctx.globalAlpha = 0.3 + p.vel * 0.6
        ctx.fillStyle = fg
        ctx.fillRect(x, y, Math.max(1.6, rowH2 * 0.45), Math.max(1.6, rowH2 - 1.2))
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = mute; ctx.font = `9px ${th.mono}`; ctx.textAlign = 'right'
      ctx.fillText('perc', padL - 6, base + 6)
    }
  } else {
    // 音效：每条音层一格，横轴时间
    const layers = s.layers
    const rowH3 = plotH / Math.max(1, layers.length)
    layers.forEach((L, i) => {
      const color = th.colors.length > 0 ? th.colors[i % th.colors.length] : fg
      const y = padT + i * rowH3
      const x0 = padL + (L.start / (dur || 1)) * plotW
      const x1 = padL + ((L.start + L.dur) / (dur || 1)) * plotW
      const hh = Math.max(4, rowH3 * 0.42)
      ctx.globalAlpha = 0.85
      const grd = ctx.createLinearGradient(x0, 0, Math.max(x1, x0 + 1), 0)
      grd.addColorStop(0, color); grd.addColorStop(Math.min(0.99, L.attack / Math.max(0.001, L.dur)), color)
      grd.addColorStop(1, 'transparent')
      ctx.fillStyle = grd
      ctx.fillRect(x0, y + rowH3 / 2 - hh / 2, Math.max(2, x1 - x0), hh)
      ctx.globalAlpha = 1
      ctx.fillStyle = mute; ctx.font = `9.5px ${th.mono}`; ctx.textAlign = 'right'
      const lbl = (L.src === 'noise' ? 'N' : 'T') + ' ' + Math.round(L.f0) + (Math.abs(L.f1 - L.f0) > 1 ? '→' + Math.round(L.f1) : '')
      ctx.fillText(lbl, padL - 6, y + rowH3 / 2 + 3)
    })
  }

  // 时间刻度
  ctx.fillStyle = mute; ctx.font = `10px ${th.mono}`; ctx.textAlign = 'center'
  const stepSec = dur > 24 ? 8 : dur > 12 ? 4 : dur > 5 ? 2 : 1
  for (let t = 0; t <= dur + 0.001; t += stepSec) {
    const x = padL + (t / (dur || 1)) * plotW
    ctx.fillText(fmtTime(t), x, padT + plotH + 14)
  }
  void cx
  return geo
}

/** 播放头：叠在卷帘图上的独立画布，每帧只重画这一层。 */
export function drawPlayhead(ov: HTMLCanvasElement, dpr: number, geo: RollGeo | null, beat: number, color: string): void {
  const ctx = ov.getContext('2d')
  if (ctx === null) return
  const { w, h } = fitCanvas(ov, ctx, dpr)
  ctx.clearRect(0, 0, w, h)
  if (geo === null) return
  const x = geo.xOfBeat(Math.min(beat, geo.totalBeats))
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.shadowColor = color
  ctx.shadowBlur = 9
  ctx.beginPath()
  ctx.moveTo(x, geo.padT - 4)
  ctx.lineTo(x, geo.padT + geo.plotH + 4)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(x, geo.padT - 6, 2.6, 0, Math.PI * 2); ctx.fill()
}
