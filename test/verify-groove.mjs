#!/usr/bin/env node
/**
 * 判据 9：律动真的会生效。
 *
 * 为什么单独立一条：这条守的是一个**静默失效**——引擎的 normalizeScore 只从第 5 个
 * 参数读律动，**不看乐谱自带的 `groove` 字段**。工具不显式把它取出来传进去的话，
 * 模型照着 skill 写 `"groove": "swing8_2"` 会被完全忽略：音符不挪、也没任何提示，
 * 听感上就是「说好的摇摆没了」。静态检查和类型检查都看不出来，只有实测能抓。
 *
 * 测的是**工具**（不是引擎）：走 apply → 注册的 play_score → presentationMeta，
 * 也就是卡片真正读到的那份数据。
 */
import { apply } from '../lib/index.js';

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? (pass++, console.log('  PASS  ' + n + (d ? '  (' + d + ')' : '')))
    : (fail++, console.log('  FAIL  ' + n + (d ? '  (' + d + ')' : '')));
};

/* ── 用桩 ctx 把工具抓出来（与 verify-host-load.mjs 同一套做法）──────── */
const tools = [];
apply({
  systemPrompt: { section: () => {}, getSectionOrder: () => 100 },
  inject: (deps, cb) => {
    if (deps.includes('tools')) {
      cb({ tools: { register: (t) => { tools.push(t); return () => {}; } },
        effect: (fn) => { const it = fn(); if (it?.next) { let r = it.next(); let g = 0; while (!r.done && g++ < 20) r = it.next(); } } });
    }
    if (deps.includes('skills')) cb({ skills: { registerProvider: () => {} } });
  },
});
const tool = tools[0];
check('抓到了 play_score 工具', tool?.name === 'play_score', String(tool?.name));

/** 一张四拍全在正拍与半拍上的谱：摇摆只应该挪动 .5 上的那些音。 */
const scoreWith = (groove) => ({
  mode: 'melody', meter: '4/4', bpm: 96, bars: 1,
  tracks: [{ name: 'a', wave: 'marimba', gain: 0.2,
    notes: [['C4', 0, 0.5, 0.8], ['C4', 0.5, 0.5, 0.8], ['C4', 1, 0.5, 0.8], ['C4', 1.5, 0.5, 0.8]] }],
  percussion: [],
  ...(groove === undefined ? {} : { groove }),
});

const startsOf = (args) => {
  const meta = tool.output.presentationMeta(args);
  return { starts: meta.score.tracks[0].notes.map((n) => n.start), groove: meta.score.groove, warn: meta.warn ?? [] };
};

/* ── 1. 写明摇摆 → 音符必须被挪 ──────────────────────────────────────── */
const swung = startsOf({ score: scoreWith('swing8_2') });
check('乐谱写 groove=swing8_2：半拍上的音真的被挪了',
  swung.starts.some((s) => Math.abs(s - 0.6666666) < 1e-4),
  swung.starts.join(', '));
check('写明摇摆：score.groove 记的是 swing8_2',
  swung.groove === 'swing8_2', String(swung.groove));
check('写明摇摆：正拍上的音不动', Math.abs(swung.starts[0] - 0) < 1e-9 && Math.abs(swung.starts[2] - 1) < 1e-9,
  `${swung.starts[0]}, ${swung.starts[2]}`);

/* ── 2. 写直拍 → 一个字都不许动 ─────────────────────────────────────── */
const straight = startsOf({ score: scoreWith('straight') });
check('乐谱写 groove=straight：音符原样不动',
  JSON.stringify(straight.starts) === JSON.stringify([0, 0.5, 1, 1.5]), straight.starts.join(', '));
check('写直拍：score.groove 记的是 straight', straight.groove === 'straight', String(straight.groove));

/* ── 3. 不写 → 按直拍，且不报警 ─────────────────────────────────────── */
const absent = startsOf({ score: scoreWith(undefined) });
check('不写 groove：按直拍处理',
  JSON.stringify(absent.starts) === JSON.stringify([0, 0.5, 1, 1.5]), absent.starts.join(', '));
check('不写 groove：不发警告', absent.warn.length === 0, absent.warn.join('；') || '无');

/* ── 4. 写错名字 → 不静默吞掉，要说出来 ─────────────────────────────── */
const typo = startsOf({ score: scoreWith('swing_8_2') });
check('律动名写错：不发散、按直拍处理',
  JSON.stringify(typo.starts) === JSON.stringify([0, 0.5, 1, 1.5]), typo.starts.join(', '));
check('律动名写错：**明说**了这个名字不认识（不许静默忽略）',
  typo.warn.some((w) => w.includes('swing_8_2')), typo.warn.join('；') || '无警告');

/* ── 5. 半速感也要真的生效（不是只有摇摆这一条路）───────────────────── */
const half = startsOf({ score: { ...scoreWith('halftime'), percussion: [['snare', 1, 0.5]] } });
check('乐谱写 groove=halftime：score.groove 记的是 halftime', half.groove === 'halftime', String(half.groove));

/* ── 6. execute 的小结也要能反映律动 ───────────────────────────────── */
const out = await tool.execute({ score: scoreWith('swing8_2') }, {});
check('execute 正常返回小结', typeof out === 'string' && out.includes('BPM'), String(out).slice(0, 60));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
