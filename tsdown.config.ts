/**
 * 两套构建：
 *  - 宿主半：ESM，跑在 Node 里，必须自包含（外部插件的 Node 半不得在运行时
 *    依赖 DSH 的模块图，所以 engine.js 与 shared/* 全部打进去）。
 *  - 客户端半：CJS 惰性工厂，交给浏览器的 __ModuleLoader__。
 *
 * 配方照抄 @changfenhuang/dsh-genui/tsdown.config.ts（它是 DSH 官方
 * packages/client/tsdown.client.ts 的可用替身，官方那份没有对外发布）。
 */
import type { UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const ID = '@jypjypjypjyp/dsh-music-studio'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * CSS Modules 内联：把 .module.css 编成「类名映射 + 一段注入 style 标签的代码」。
 *
 * 为什么必须自己写这一步：DSH 的 Web loader 是按**脚本**取插件的，没有 CSS 通道；
 * 样式必须在模块物化时自己注入。标签要带 data-plugin / data-plugin-css ——
 * 热替换就是靠这两个属性找到并移除旧样式表的（配方与 genui 一致）。
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      const stableId = relative(PROJECT_ROOT, abs).replaceAll('\\', '/')
      return CSS_VIRTUAL_PREFIX + stableId + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const stableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolvePath(PROJECT_ROOT, stableId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: stableId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      // 类名顺序固定：按 UTF-16 比较本地名（localeCompare 会随系统语言变），构建才可复现
      const entries = Object.entries(cssExports ?? {})
        .map(([local, exp]) => [local, exp.name] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      const tagId = `${ID}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(Object.fromEntries(entries))};`,
      ].join('\n')
    },
  }
}

/**
 * 平台模块表里我们真正「值导入」的那几个 —— 只有这些可以外置。
 * 其余平台模块（dsh-client-ui-slots / dsh-client-store / dsh-client-ui-dockkit）
 * 通过 ctx.slots 这类**服务**拿到，根本不需要导入；
 * @deepseek-ai/cordis 只做 `import type`（编译期抹掉，不产生运行时请求）。
 */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** 纯净闸门：外置清单之外的 @deepseek-ai/* 值导入一律构建失败。 */
function purityGate(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" 不在模块表里 —— 跨插件的值导入被禁止，`
        + '要协作请走 cordis 服务；只做类型导入时请写 import type。',
      )
    },
  }
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  minify: true,
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [purityGate(), cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const hostConfig: UserConfig = {
  name: ID,
  // shared/score-info 单独出一个入口，好让 Node 侧的判据脚本能 import 到
  // 真正会被宿主加载的那份 JS（而不是靠 Node 的 TS 支持去读源码）。
  entry: {
    index: 'src/index.ts',
    'shared/score-info': 'src/shared/score-info.ts',
    'shared/color': 'src/shared/color.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: '[name].js' },
}

export default [hostConfig, clientConfig]
