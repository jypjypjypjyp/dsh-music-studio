#!/usr/bin/env node
/**
 * 判据 3：乐谱校验的三条分支按预期工作 —— 合法谱通过、可救的越界被钳位且明说、
 * 结构错退回可读原因。
 *
 * 测的是真正会跑的那份代码：引擎读 src/engine.js（与 index.html 逐字节一致），
 * 读数工具读构建产物 lib/shared/score-info.js（宿主实际加载的那份）。
 */
import { normalizeScore, durationOf, TIMBRE_TIERS } from '../src/engine.js';
import { countEvents, usedTimbres, isRenderable } from '../lib/shared/score-info.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  cond ? (pass++, console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : '')))
       : (fail++, console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')));
};

const PRO = 'pro';   // 宿主半一律按专业档校验：接受音色库全集，不给档位提示

/* ── 分支 1：合法谱通过 ──────────────────────────────────────────────── */
const good = {
  title: '雨夜', mood: '湿冷', mode: 'melody', meter: '4/4', bpm: 96, bars: 4,
  tracks: [
    { name: '低音', wave: 'piano', gain: 0.2, notes: [['C2', 0, 4, 0.5], ['G2', 4, 4, 0.4]] },
    { name: '旋律', wave: 'choir', gain: 0.15, notes: [['E5', 0, 2, 0.7], ['D5', 2, 2, 0.6]] },
  ],
  percussion: [['kick', 0, 0.8], ['hat', 2, 0.3]],
  fx: { reverb: 0.4 },
};
const r1 = normalizeScore(good, undefined, PRO, undefined, 'straight');
check('合法谱：出得来乐谱', r1.score !== null);
check('合法谱：没有警告', r1.warn.length === 0, r1.warn.join('；') || '无');
check('合法谱：音符数对得上', countEvents(r1.score) === 6, String(countEvents(r1.score)));
check('合法谱：时长是正数', durationOf(r1.score) > 0, durationOf(r1.score).toFixed(2) + 's');
check('合法谱：音色登记正确', usedTimbres(r1.score).join(',') === 'piano,choir', usedTimbres(r1.score).join(','));
check('合法谱：音高被转成 midi', typeof r1.score.tracks[0].notes[0].midi === 'number');

/* ── 分支 2：可救的越界被钳位，且明说钳了什么 ─────────────────────────── */
const wild = {
  mode: 'melody', meter: '4/4', bpm: 9999, bars: 4,
  tracks: [{ name: '怪', wave: '不存在的音色', gain: 99, notes: [['C2', 0, 4, 9]] }],
  percussion: [],
};
const r2 = normalizeScore(wild, undefined, PRO, undefined, 'straight');
check('可救：仍然出得来乐谱', r2.score !== null);
check('可救：BPM 被钳进 40..200', r2.score.bpm >= 40 && r2.score.bpm <= 200, String(r2.score.bpm));
check('可救：未知音色被换成 triangle', r2.score.tracks[0].wave === 'triangle', r2.score.tracks[0].wave);
check('可救：明说了未知音色这件事', r2.warn.some((w) => w.includes('不在音色库')), r2.warn.join('；'));

/* ── 分支 3：结构错不可救；且不抛异常 ─────────────────────────────────
   注意引擎的真实行为：对「tracks 不是数组」它**不返回 null**，而是返回一张
   没有音轨的空谱 + 警告。所以能不能交给卡片，只能靠 isRenderable 这条判据。 */
const broken = normalizeScore({ mode: 'melody', tracks: '这不是数组' }, undefined, PRO, undefined, 'straight');
check('结构错：引擎给的是空谱而不是 null（记录下来，别误以为 engine 会返回 null）',
  broken.score !== null && countEvents(broken.score) === 0, `score=${broken.score === null ? 'null' : '空谱'}`);
check('结构错：给了可读原因', broken.warn.length > 0, broken.warn.join('；'));
check('结构错：被 isRenderable 拦下', isRenderable(broken.score) === false);
const notObj = normalizeScore(null, undefined, PRO, undefined, 'straight');
check('null 输入：不抛异常', notObj.score === null && notObj.warn.length > 0, notObj.warn.join('；'));
const emptyTracks = normalizeScore({ mode: 'melody', tracks: [], percussion: [] }, undefined, PRO, undefined, 'straight');
check('空音轨谱：也被 isRenderable 拦下', isRenderable(emptyTracks.score) === false);
check('合法谱：isRenderable 放行', isRenderable(r1.score) === true);

/* ── 专业档就是全集 ─────────────────────────────────────────────────── */
check('专业档 = 32 个音色', TIMBRE_TIERS.pro.length === 32, String(TIMBRE_TIERS.pro.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
