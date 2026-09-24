#!/usr/bin/env node
/**
 * 判据 1：src/engine.js 必须与 index.html 的引擎块**逐字节相同**（除末尾导出段）。
 * 这条成立时，跑在 index.html 上的 141 项引擎验收就自动覆盖了插件里的引擎，
 * 不需要再跑第二遍。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEngineBlock, buildModule, sourceAvailable } from '../scripts/extract-engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// 独立发布版没有引擎真源：这条判据在这里无法执行，如实说出来，别假装通过。
// 在主仓库（弦外）里它照常硬校验，那才是这条判据真正该发挥作用的地方。
if (!sourceAvailable()) {
  console.log('  SKIP  找不到引擎真源 index.html —— 本仓库是插件的独立发布版。');
  console.log('        这条判据在弦外主仓库里执行（那里两个文件都在），此处无法校验。');
  console.log('        已发布的 src/engine.js 与主仓库引擎逐字节一致，由主仓库的构建守着。');
  process.exit(0);
}

const html = readFileSync(resolve(HERE, '../../index.html'), 'utf8');
const engine = readFileSync(resolve(HERE, '../src/engine.js'), 'utf8');

const expected = buildModule(extractEngineBlock(html));
if (engine === expected) {
  console.log('  PASS  引擎块逐字节一致，且导出清单齐全');
  process.exit(0);
}

const block = extractEngineBlock(html).trimEnd();
console.log('  FAIL  src/engine.js 与 index.html 的引擎块不一致');
console.log(`        引擎块 ${block.length} 字节 / 实际 ${engine.length} 字节`);
console.log(`        前缀比对：${engine.startsWith(block) ? '前缀相同，差异在导出段' : '前缀就不同'}`);
console.log('        修法：跑 node scripts/extract-engine.mjs 重新生成');
process.exit(1);
