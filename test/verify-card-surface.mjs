#!/usr/bin/env node
/**
 * 判据 5：卡片表面检查。
 *
 * 5a 用到的每个 primitives 导出名都必须在本机运行时名单里。
 *    为什么需要：客户端半编译期对着 npm 上的类型写代码，运行时却拿到一份**固定的**
 *    模块表。类型里有、运行时不存在的导出会安静地变成 undefined（已实测
 *    LinkIcon、ReferenceIcon 在 0.1.7 被改名，Checkbox 等是 0.1.7 才新增的）。
 * 5b 值导入只来自 5 个平台模块（跨插件的 @deepseek-ai 值导入一律禁止）。
 * 5c 客户端源码与样式表里不得出现字面颜色（音轨配色表 theme.ts 是唯一豁免，
 *    那是 index.html 里用量化判据算过的一张表，不是随手挑的）。
 * 5d 样式表里只允许布局属性 —— 这条守的是「不自己写 style」这条硬要求。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src/client');
const EXPORTS = JSON.parse(readFileSync(resolve(HERE, '../../docs/dsh-plugin-research/platform-module-exports.json'), 'utf8'));

let fail = 0;
const check = (name, cond, detail) => {
  cond ? console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''))
       : (fail++, console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')));
};

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|css)$/.test(p) && !p.endsWith('.d.ts')) files.push(p);
  }
})(SRC);

// 研究产物的顶层键是短名（primitives / slots / store / dockkit），不是包名
const primitiveNames = new Set(EXPORTS['primitives'] ?? []);
check('拿到了本机 primitives 运行时导出名单', primitiveNames.size > 100, String(primitiveNames.size));

const PLATFORM = [
  'react', 'react/jsx-runtime', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives',
];

const unknown = [];
const strayImports = [];
const literalColors = [];

for (const file of files) {
  const short = file.slice(SRC.length + 1);
  const text = readFileSync(file, 'utf8');

  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    // 5a
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name && !primitiveNames.has(name)) unknown.push(`${short}: ${name}`);
      }
    }
    // 5b：值导入（import type 不算）
    for (const m of text.matchAll(/^\s*import\s+(?!type\b)([^'"]*?)from\s+'(@deepseek-ai\/[^']+)'/gm)) {
      if (!PLATFORM.includes(m[2])) strayImports.push(`${short}: ${m[2]}`);
    }
  }

  // 5c：字面颜色
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)) {
    literalColors.push(`${short}: ${m[0]}`);
  }
}

check('用到的 primitives 导出都在本机运行时名单里', unknown.length === 0, unknown.join('; ') || '无');
check('没有跨插件的 @deepseek-ai 值导入', strayImports.length === 0, strayImports.join('; ') || '无');
check('没有字面颜色（theme.ts 的配色表是唯一豁免）',
  literalColors.filter((s) => !s.startsWith('theme.ts')).length === 0,
  literalColors.join('; ') || '无');

// 5d：样式表的红线就是设计文档里写的那两条 ——
//     ① 布局属性可以带普通值（flex/gap/padding/宽高…）
//     ② 视觉属性**只允许**取 --dsw-* 语义令牌，一个字面值都不许有
//     （不是「只许写布局属性」：color: var(--dsw-...) 正是官方规定的做法。）
const LAYOUT_PROPS = /^(display|flex|flex-direction|flex-wrap|flex-grow|flex-shrink|flex-basis|align-items|align-self|justify-content|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|padding|padding-[a-z]+|margin|margin-[a-z]+|position|top|right|bottom|left|inset|overflow|overflow-[xy]|z-index|border-radius|box-sizing|pointer-events|cursor|text-overflow|white-space|font-variant-numeric|opacity|grid|grid-[a-z-]+|order|aspect-ratio|resize|user-select|list-style)$/;
const TOKEN_VALUE = /var\(--dsw-[a-z0-9-]+/;
const cssFile = files.find((f) => f.endsWith('.css'));
check('找得到唯一的样式表', cssFile !== undefined, cssFile ? cssFile.slice(SRC.length + 1) : '无');

if (cssFile !== undefined) {
  const css = readFileSync(cssFile, 'utf8');
  const literalVisual = [];
  const unknownProps = [];
  for (const block of css.matchAll(/\{([^}]*)\}/g)) {
    for (const decl of block[1].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      if (prop === '' || prop.startsWith('/*')) continue;
      const value = decl.slice(i + 1).trim();
      if (LAYOUT_PROPS.test(prop)) continue;
      // 非布局属性：值必须是 DSH 令牌，否则就是自己造视觉
      if (TOKEN_VALUE.test(value)) continue;
      literalVisual.push(`${prop}: ${value}`);
      unknownProps.push(prop);
    }
  }
  check('视觉值全部取自 --dsw-* 令牌（无任何字面视觉值）',
    literalVisual.length === 0, literalVisual.join('; ') || '无');
  check('样式表里没有引入第二套视觉体系（无 Tailwind/组件库类名）',
    !/@tailwind|\.tw-|@import\s+'https?:/.test(css), '已检查');
}

/* ── 5e 卡槽认领哪些工具名 ─────────────────────────────────────────────
   长篇工作流把「整曲/样张」交给 score_export，短曲交给 play_score ——
   两个名字必须都指向同一个卡片组件，否则长曲的卡片会退回通用工具行。 */
const clientIndex = readFileSync(join(SRC, 'index.tsx'), 'utf8');
check('5e 卡槽同时认领 play_score 与 score_export',
  /CARD_TOOLS\s*=\s*\[[^\]]*'play_score'[^\]]*'score_export'[^\]]*\]/.test(clientIndex),
  '已检查 CARD_TOOLS');
check('5f 两个名字都用同一个卡片组件',
  (clientIndex.match(/ctx\.slots\.register\(/g) ?? []).length === 1 && /XianwaiCard/.test(clientIndex));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
