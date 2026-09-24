/**
 * 明暗判定与音轨配色。
 *
 * 为什么不能直接用 DSH 令牌画音轨：DSH 只有 `--dsw-alias-state-*` 那几个语义色，
 * 没有「8 个可互相区分的分类色」。而卷帘图上轨道必须一眼分得开，所以配色表
 * 沿用 index.html 里那张**用量化判据算出来的**表（CIE Lab ΔE76 两两最小 25.4/25.1、
 * 相对底色最低对比度 4.65:1/3.70:1，由 tools/audit-palette.py 出数）。
 * 自己另发明一套只会更差。
 *
 * 明暗不猜：量 `--dsw-alias-bg-base` 的亮度（令牌定义在 body 上，会继承到卡片根元素，
 * 所以从卡片根读得到）。不依赖任何主题服务 API，也不管 DSH 把主题标志挂在 class
 * 还是 data 属性上 —— 属性名会变，颜色不会。
 */
import { isDarkColor } from '../shared/color.js'

const TRACK_COLORS: Record<'dark' | 'light', string[]> = {
  dark: ['#84ac90', '#ac6b5f', '#7183b8', '#c2a24a', '#b07ba8', '#8fae5f', '#5fa8b8', '#d07a45'],
  light: ['#42806b', '#94544d', '#455a91', '#654c20', '#7d4a72', '#556b2f', '#2f6b7d', '#a85f28'],
}

export function isDark(root: HTMLElement): boolean {
  const verdict = isDarkColor(getComputedStyle(root).getPropertyValue('--dsw-alias-bg-base'))
  if (verdict !== null) return verdict
  // 令牌读不到时退回系统偏好（正常情况下走不到这里）
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false
}

export function pickTrackColors(root: HTMLElement): string[] {
  return TRACK_COLORS[isDark(root) ? 'dark' : 'light']
}

/**
 * 主题变了要把画布重画一遍 —— canvas 的像素不会自己跟着 CSS 变量变。
 * 三条路都铺上，因为不知道 DSH 用哪种方式切主题：
 * 属性变化（MutationObserver）、系统偏好变化、以及「只换了 CSS 变量值」的情况
 * （那种情况观察不到，只能一秒读一次计算样式兜底，代价可忽略）。
 */
export function onThemeChange(root: HTMLElement, cb: () => void): () => void {
  const observer = new MutationObserver(cb)
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  media?.addEventListener('change', cb)
  let last = isDark(root)
  const timer = setInterval(() => {
    const now = isDark(root)
    if (now !== last) { last = now; cb() }
  }, 1000)
  return () => {
    observer.disconnect()
    media?.removeEventListener('change', cb)
    clearInterval(timer)
  }
}
