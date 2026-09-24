#!/usr/bin/env node
/**
 * 判据 4：SKILL.md 的音色/拍号/律动清单 == 引擎里的真相。
 * 手写清单会悄悄过期；这条把它变成可证伪的约束。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMBRE_TIERS, METERS, GROOVES } from '../src/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(HERE, '../SKILL.md'), 'utf8');

let fail = 0;
const check = (name, cond, detail) => {
  cond ? console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''))
       : (fail++, console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')));
};

// 音色清单：`## 四、音色清单` 之后、下一个二级标题之前，每行 `- \`name\``
const sec = md.split('## 四、音色清单')[1]?.split('\n## ')[0] ?? '';
const listed = [...sec.matchAll(/^-\s+`([a-z0-9_]+)`/gm)].map((m) => m[1]);
const engine = [...TIMBRE_TIERS.pro];

check('找得到「音色清单」一节', sec.length > 0);
check('清单数量 == 专业档 32', listed.length === engine.length, `${listed.length} vs ${engine.length}`);
const missing = engine.filter((n) => !listed.includes(n));
const extra = listed.filter((n) => !engine.includes(n));
check('没有漏列', missing.length === 0, missing.join(',') || '无');
check('没有多列（不存在的音色）', extra.length === 0, extra.join(',') || '无');

// 拍号与律动也必须全覆盖，同样防手写过期
const meters = Object.keys(METERS).filter((m) => md.includes('`' + m + '`'));
check('拍号全覆盖', meters.length === Object.keys(METERS).length, `${meters.length}/${Object.keys(METERS).length}`);
const groves = Object.keys(GROOVES).filter((g) => md.includes('`' + g + '`'));
check('律动全覆盖', groves.length === Object.keys(GROOVES).length, `${groves.length}/${Object.keys(GROOVES).length}`);

// frontmatter 契约（index.ts 的 bundledSkillProvider 靠它解析）
check('frontmatter 有 name: music-studio', /^---\n[\s\S]*?name:\s*music-studio\s*\n/.test(md));
check('frontmatter 有 description', /^---\n[\s\S]*?\ndescription:\s*\S/.test(md));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
