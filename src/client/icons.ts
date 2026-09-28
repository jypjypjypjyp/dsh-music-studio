/**
 * 图标名的版本兼容层。
 *
 * 同一批图标在 dsh 的两个版本里叫法不同，而且**取错名字不会报错**：
 *   0.1.5：IconPlayOutline16 / IconStopFill16 ……（名字里带 16px 尺寸）
 *   0.1.7：IconPlayOutline（裸名）、IconPlayOutlineRegular / Medium / Artwork（16 后缀全删了）
 * 拿不到就是 `undefined`，React 拿到 undefined 的组件类型会在**渲染时**抛错：
 * 整张卡片当场消失，除了浏览器控制台什么都不剩 —— 这就是「0.1.7 上播放卡片不见了」的真因。
 *
 * 所以这里不写死名字，而是按存在性取：新版写法优先，旧版写法兜底。
 * 两个版本各自的名单记在 docs/dsh-plugin-research/platform-module-exports.json
 * （primitives = 新版，primitivesLegacy = 0.1.5），verify-card-surface.mjs 会核对这张表。
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

/** 两个版本都没有时的兜底：宁可这一格空着，也不要让整张卡片崩掉。 */
const EMPTY: ComponentType = () => null

/** 按顺序取第一个真正存在的导出。 */
function pick(...names: string[]): ComponentType {
  const bag = primitives as unknown as Record<string, unknown>
  for (const name of names) {
    const found = bag[name]
    if (typeof found === 'function' || (found !== null && typeof found === 'object')) {
      return found as ComponentType
    }
  }
  return EMPTY
}

export const IconPlay = pick('IconPlayOutlineRegular', 'IconPlayOutline', 'IconPlayOutline16')
export const IconPause = pick('IconPauseOutlineRegular', 'IconPauseOutline', 'IconPauseOutline16')
export const IconStop = pick('IconStopFillRegular', 'IconStopFill', 'IconStopFill16')
export const IconLoop = pick('IconRefreshOutlineRegular', 'IconRefreshOutline', 'IconRefreshOutline16')
export const IconDownload = pick('IconDownloadOutlineRegular', 'IconDownloadOutline', 'IconDownloadOutline16')
export const IconCopy = pick('IconCopyOutlineRegular', 'IconCopyOutline', 'IconCopyOutline16')
