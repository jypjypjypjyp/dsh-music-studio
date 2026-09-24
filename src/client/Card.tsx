/**
 * play_score 的卡片：长在对话的工具行里。
 *
 * 乐谱来自工具结果的 meta（宿主半的 presentationMeta 投影过来的规范化乐谱）。
 * 卡片只做四件事：画卷帘图、播放、导出、把宿主报的钳位警告显示出来。
 * 作曲不在这里 —— 那是模型在对话里干的活。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
  IconRefreshOutline16,
  IconStopFill16,
  Input,
  StateDot,
  Tag,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ScorePlayer } from './audio.js'
import { drawPlayhead, drawRoll, readTheme, type RollGeo } from './roll.js'
import { onThemeChange, pickTrackColors } from './theme.js'
import { countEvents, fmtDur, usedTimbres, type Score } from '../shared/score-info.js'
import { beatsOf, durationOf, encodeWavAsync, renderOffline } from '../engine.js'
import css from './card.module.css'

interface Meta { score: Score; warn?: string[] }

/** 从工具结果的 meta 里取出乐谱；运行中的调用、旧日志、垃圾 meta 都返回 null。 */
function readMeta(block: unknown): Meta | null {
  if (block === null || typeof block !== 'object') return null
  if (!('meta' in block)) return null
  const meta = (block as { meta?: unknown }).meta
  if (meta === null || typeof meta !== 'object') return null
  const score = (meta as { score?: unknown }).score
  if (score === null || score === undefined || typeof score !== 'object') return null
  const warn = (meta as { warn?: unknown }).warn
  return { score: score as Score, warn: Array.isArray(warn) ? warn.filter((w) => typeof w === 'string') : [] }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 800)
}

function fname(score: Score, ext: string): string {
  const t = (score.title || 'music-studio').replace(/[\\/:*?"<>|]/g, '').slice(0, 20) || 'music-studio'
  return `${t}-${new Date().toISOString().slice(0, 10)}.${ext}`
}

export function XianwaiCard(props: ToolCallViewProps) {
  const block = (props as { block?: unknown }).block
  const meta = useMemo(() => readMeta(block), [block])
  const score = meta?.score ?? null

  const [beat, setBeat] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [volume, setVolume] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const rollRef = useRef<HTMLCanvasElement | null>(null)
  const overRef = useRef<HTMLCanvasElement | null>(null)
  const geoRef = useRef<RollGeo | null>(null)
  const playerRef = useRef<ScorePlayer | null>(null)

  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)

  /* ── 画一遍卷帘图（尺寸变、主题变、乐谱变都要重画） ────────────────── */
  const paint = useCallback(() => {
    const cv = rollRef.current
    const root = rootRef.current
    if (cv === null || root === null) return
    const ctx = cv.getContext('2d')
    if (ctx === null) return
    const th = readTheme(root)
    th.colors = pickTrackColors(root)
    geoRef.current = drawRoll(cv, ctx, dpr, score, th)
    drawPlayhead(overRef.current as HTMLCanvasElement, dpr, geoRef.current, playerRef.current?.beat ?? 0,
      getComputedStyle(root).getPropertyValue('--dsw-alias-brand-primary').trim() || th.fg)
  }, [score, dpr])

  useEffect(() => {
    paint()
    const root = rootRef.current
    if (root === null) return
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => paint())
    ro?.observe(root)
    const offTheme = onThemeChange(root, paint)
    return () => { ro?.disconnect(); offTheme() }
  }, [paint])

  /* ── 播放器生命周期 ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (score === null) return
    const player = new ScorePlayer(score)
    playerRef.current = player
    const off = player.subscribe((b) => {
      setBeat(b)
      setPlaying(player.isPlaying)
      const root = rootRef.current
      if (root !== null) {
        drawPlayhead(overRef.current as HTMLCanvasElement, dpr, geoRef.current, b,
          getComputedStyle(root).getPropertyValue('--dsw-alias-brand-primary').trim() || 'currentColor')
      }
    })
    return () => { off(); player.dispose(); playerRef.current = null }
  }, [score, dpr])

  /* 时长与总拍数从乐谱直接算 —— 不能读 playerRef：
     ref 不参与渲染，播放器还没创建时这里会算出 0，且之后没有 re-render 去纠正它。
     （这个 bug 是 live 测试抓出来的：总计显示 0:00。）
     口径与引擎一致：旋律看小节与拍号，音效看最后一层的收尾。 */
  const totalSec = useMemo(() => (score === null ? 0 : durationOf(score)), [score])
  const totalBeats = useMemo(() => {
    if (score === null) return 0
    const beatSec = 60 / score.bpm
    return score.mode === 'sfx' ? durationOf(score) / beatSec : score.bars * beatsOf(score)
  }, [score])

  const toggle = () => {
    const p = playerRef.current
    if (p === null) return
    if (p.isPlaying) p.pause()
    else p.play(beat >= p.totalBeats - 0.01 ? 0 : beat)
  }

  const seek = (clientX: number, el: HTMLElement) => {
    const p = playerRef.current
    if (p === null || score === null) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)))
    const target = ratio * p.totalBeats
    p.play(target)
    setBeat(target)
  }

  /* ── 导出 WAV ────────────────────────────────────────────────────────
     导出前主动暂停播放：导出要在主线程上把几十兆音频转成 PCM，重活期间播放只会断续。
     与其让主人听到半死不活的流、以为程序坏了，不如明说暂停，导完从原位置续上。
     进度只报「已用秒数」而不做假百分比 —— OfflineAudioContext 没有进度回调，
     而且实测它比实时还慢（60 秒曲要 75 秒），硬编一个百分比是骗人。 */
  const exportWav = async () => {
    if (score === null) return
    const p = playerRef.current
    const wasPlaying = p?.isPlaying ?? false
    const resumeAt = p?.beat ?? 0
    if (wasPlaying) p?.pause()
    setBusy('渲染中… 0s')
    const tStart = performance.now()
    const timer = setInterval(() => {
      setBusy(`渲染中… ${Math.round((performance.now() - tStart) / 1000)}s`)
    }, 500)
    try {
      const buf = await renderOffline(score, { sampleRate: 44100, tail: score.mode === 'sfx' ? 2.6 : 2 })
      clearInterval(timer)
      const renderSec = ((performance.now() - tStart) / 1000).toFixed(1)
      const wav = await encodeWavAsync(buf, (done: number, total: number) => {
        setBusy(`转码 ${Math.round((done / total) * 100)}%`)
      })
      download(new Blob([wav as BlobPart], { type: 'audio/wav' }), fname(score, 'wav'))
      setNotice(`已导出 WAV · ${(wav.length / 1024 / 1024).toFixed(2)} MB · ${buf.duration.toFixed(1)} 秒 · 渲染用时 ${renderSec}s`)
    } catch (e) {
      setNotice(`WAV 导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearInterval(timer)
      setBusy(null)
      if (wasPlaying) p?.play(resumeAt)
    }
  }

  /* ── 没有乐谱可放 ──────────────────────────────────────────────────── */
  const rootRefCb = useCallback((node: HTMLDivElement | null) => { rootRef.current = node }, [])

  if (meta === null || score === null) {
    return (
      <div className={css.root} ref={rootRefCb}>
        <div className={css.head}>
          <StateDot state="idle" />
          <span className={css.title}>这张谱读不出来</span>
        </div>
        <span className={css.note}>可能是旧日志里的记录，或者乐谱没有通过校验。</span>
      </div>
    )
  }

  const events = countEvents(score)
  const timbres = usedTimbres(score)
  const ratio = totalBeats > 0 ? Math.min(1, Math.max(0, beat / totalBeats)) : 0
  const elapsedSec = ratio * totalSec

  return (
    <div className={css.root} ref={rootRefCb}>
      <div className={css.head}>
        <StateDot state={playing ? 'ongoing' : 'done'} />
        <span className={css.title}>{score.title || '无题'}</span>
        <div className={css.meta}>
          <Tag tone="quiet">{score.bpm} BPM</Tag>
          <Tag tone="quiet">{score.meter}</Tag>
          {score.mode === 'sfx'
            ? <Tag tone="quiet">{score.layers.length} 层</Tag>
            : <Tag tone="quiet">{score.bars} 小节</Tag>}
          <Tag tone="quiet">{events} 个音</Tag>
          <Tag tone="quiet">{fmtDur(totalSec)}</Tag>
          {timbres.length > 0 && <Tag tone="quiet">{timbres.slice(0, 4).join(' / ')}</Tag>}
        </div>
      </div>

      <div className={css.rollWrap}>
        <canvas ref={rollRef} className={css.roll} role="img" aria-label="乐谱卷帘图" />
        <canvas ref={overRef} className={css.overlay} aria-hidden="true" />
      </div>

      <div className={css.transport}>
        <Tooltip label={playing ? '暂停' : '播放'}>
          <Button variant="toolbar" size="sm"
            icon={playing ? <IconPauseOutline16 /> : <IconPlayOutline16 />}
            onClick={toggle} aria-label={playing ? '暂停' : '播放'} />
        </Tooltip>
        <Tooltip label="停止">
          <Button variant="toolbar" size="sm" icon={<IconStopFill16 />} aria-label="停止"
            onClick={() => { playerRef.current?.stop(); setBeat(0); setPlaying(false) }} />
        </Tooltip>
        <Tooltip label="循环播放">
          <Button variant={loop ? 'primary' : 'toolbar'} size="sm" icon={<IconRefreshOutline16 />}
            aria-label="循环播放" aria-pressed={loop}
            onClick={() => { const next = !loop; setLoop(next); playerRef.current?.setLoop(next) }} />
        </Tooltip>

        <div className={css.track} role="slider" tabIndex={0}
          aria-label="播放进度" aria-valuemin={0} aria-valuemax={Math.round(totalBeats)} aria-valuenow={Math.round(beat)}
          onClick={(e) => seek(e.clientX, e.currentTarget)}
          onKeyDown={(e) => {
            const p = playerRef.current
            if (p === null) return
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const target = Math.min(p.totalBeats, Math.max(0, beat + (e.key === 'ArrowRight' ? 1 : -1)))
              p.play(target); setBeat(target)
            }
          }}>
          <div className={css.trackFill} style={{ width: `${ratio * 100}%` }} />
        </div>

        <span className={css.time}>{fmtDur(elapsedSec)} / {fmtDur(totalSec)}</span>

        <Tooltip label="试听音量">
          <Input className={css.vol} type="range" min={0} max={100} value={Math.round(volume * 100)}
            aria-label="试听音量" title="只影响试听。导出的 WAV 恒按满档渲染。"
            onChange={(e) => { const v = Number(e.currentTarget.value) / 100; setVolume(v); playerRef.current?.setVolume(v) }} />
        </Tooltip>
      </div>

      <div className={css.exports}>
        <Button variant="ghost" size="sm" icon={<IconDownloadOutline16 />}
          disabled={busy !== null} onClick={() => { void exportWav() }}>
          {busy ?? '下载 WAV'}
        </Button>
        <Button variant="ghost" size="sm" icon={<IconDownloadOutline16 />}
          onClick={() => download(new Blob([JSON.stringify(score, null, 2)], { type: 'application/json' }), fname(score, 'json'))}>
          导出乐谱 JSON
        </Button>
        <Tooltip label="复制乐谱 JSON">
          <Button variant="ghost" size="sm" icon={<IconCopyOutline16 />} aria-label="复制乐谱 JSON"
            onClick={() => { void writeClipboard(JSON.stringify(score)) }} />
        </Tooltip>
      </div>

      {meta.warn !== undefined && meta.warn.length > 0 && (
        <div className={css.warn}>
          {meta.warn.map((w, i) => (
            <span key={i} className={css.warnRow}>
              <Tag tone="warning">钳位</Tag>{w}
            </span>
          ))}
        </div>
      )}
      {notice !== null && <span className={css.note}>{notice}</span>}
    </div>
  )
}
