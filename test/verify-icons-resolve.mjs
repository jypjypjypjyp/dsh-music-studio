#!/usr/bin/env node
/**
 * 判据 6：图标兼容层在两版运行时上都能解析出图标。
 *
 * 为什么要单独跑逻辑：`icons.ts` 的兜底分支**只有在旧版运行时上才会走到**，
 * 在新版机器上跑再多遍也覆盖不到它。这里用两版**真实导出名单**（记在研究产物里）
 * 各造一个桩模块，把真实源码 `src/client/icons.ts` 挂上去跑，逐条断言：
 *   - 新版世界：每个图标解析到新版写法（`…Regular`）
 *   - 0.1.5 世界：每个图标解析到 0.1.5 写法（`…16`）
 *   - 两版都没有：退化成空组件，**绝不能是 undefined**
 *     （undefined 会被 React 当成非法组件类型，渲染时抛错、整张卡片消失）
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src/client');
const EXPORTS = JSON.parse(readFileSync(resolve(HERE, '../../docs/dsh-plugin-research/platform-module-exports.json'), 'utf8'));

let fail = 0;
const check = (name, cond, detail) => {
  cond ? console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''))
       : (fail++, console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')));
};

/** 一侧的桩：把该版名单里的名字都导出成带标记的函数。 */
function makeWorld(root, tag, names) {
  const pkgDir = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-primitives');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-primitives', version: tag, type: 'module', main: 'index.js' }));
  const body = names.map((n) => `export const ${n} = Object.assign(() => null, { __world: ${JSON.stringify(tag)}, __name: ${JSON.stringify(n)} });`).join('\n');
  writeFileSync(join(pkgDir, 'index.js'), body + '\n');
  copyFileSync(join(SRC, 'icons.ts'), join(root, 'icons.ts'));
  const driver = join(root, 'driver.mjs');
  writeFileSync(driver, `
import * as icons from './icons.ts'
const out = {}
for (const [k, v] of Object.entries(icons)) out[k] = v && v.__name ? v.__name : '__EMPTY__'
console.log(JSON.stringify(out))
`);
  return driver;
}

const nowNames = EXPORTS['primitives'] ?? [];
const oldNames = EXPORTS['primitivesLegacy'] ?? [];
check('拿到了两版名单', nowNames.length > 100 && oldNames.length > 100, `${nowNames.length} / ${oldNames.length}`);

const groups = [...readFileSync(join(SRC, 'icons.ts'), 'utf8').matchAll(/pick\(([^)]*'[^)]*)\)/g)]
  .map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
check('解析出 pick 分组', groups.length > 0, `${groups.length} 组`);

/** 断言每个分组的第一名/兜底名各自属于哪一版。 */
function expect(world, tag, wantSuffix, wantNames) {
  const driver = makeWorld(world, tag, wantNames);
  const out = JSON.parse(execFileSync(process.execPath, [driver], { encoding: 'utf8' }).trim().split('\n').pop());
  const bad = [];
  for (const [icon, name] of Object.entries(out)) {
    if (name === '__EMPTY__') bad.push(`${icon} → 空（该版一个都没命中）`);
  }
  check(`${tag} 世界：每个图标都解析到该版写法（${wantSuffix}）`, bad.length === 0, bad.join('; ') || Object.values(out).join(', '));
  return out;
}

const rootNow = mkdtempSync(join(tmpdir(), 'icons-now-'));
const rootOld = mkdtempSync(join(tmpdir(), 'icons-old-'));
const rootNeither = mkdtempSync(join(tmpdir(), 'icons-none-'));
try {
  const nowOut = expect(rootNow, 'now', 'Regular', nowNames);
  const oldOut = expect(rootOld, 'legacy', '16', oldNames);
  const noneOut = JSON.parse(execFileSync(process.execPath, [makeWorld(rootNeither, 'none', ['SomethingElse'])], { encoding: 'utf8' }).trim().split('\n').pop());
  check('两版都没有时退化成空组件（不是 undefined）',
    Object.values(noneOut).every((v) => v === '__EMPTY__'), Object.values(noneOut).join(', '));

  // 交叉核对：新版世界拿到的是名单里第一个存在的名字，旧版世界拿到的是 0.1.5 的那个名字
  const mismatch = [];
  for (const [icon, got] of Object.entries(nowOut)) {
    const want = groups.find((g) => g.includes(got));
    if (!want) mismatch.push(`${icon}: ${got} 不在 pick 表里`);
    if (!/Regular$/.test(got)) mismatch.push(`${icon}: 新版世界拿到 ${got}（不是 …Regular）`);
  }
  for (const [icon, got] of Object.entries(oldOut)) {
    if (!/16$/.test(got)) mismatch.push(`${icon}: 0.1.5 世界拿到 ${got}（不是 …16）`);
  }
  check('两版各自命中的名字都对得上', mismatch.length === 0, mismatch.join('; ') || '6 组逐一核对');
} finally {
  for (const r of [rootNow, rootOld, rootNeither]) rmSync(r, { recursive: true, force: true });
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
