/**
 * 弦外 · 客户端半：把 play_score 的调用结果渲染成对话里的卡片。
 *
 * 为什么用 `tool.call.toolview`：这是 DSH 为「某个工具的调用结果长什么样」预留的
 * 官方座位，按工具的线上名字（wire tool name）分发；没被认领的名字自动退回通用
 * 工具行。自家工具用它属于纯增量，不会抢别人的位子。
 *
 * 该座位由 conversation.chat.node 声明，所以必须用 slots.inject（等声明）而不是
 * 直接 slots.register —— 对未声明的槽位直接 register 会在加载时抛错。
 *
 * 已核实：那个「用 Markdown 围栏画内联 UI」的 registerFenceRenderer 扩展点在本机
 * 不存在（primitives 0.1.5-rc.2 与 0.1.7-rc.1 都没有），所以围栏那条路走不通。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { XianwaiCard } from './Card.js'

export const inject = ['slots']

export function apply(ctx: Context): () => void {
  console.info('[music-studio] client active')
  const dispose = ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'play_score' },
    XianwaiCard,
  ))
  return () => dispose()
}
