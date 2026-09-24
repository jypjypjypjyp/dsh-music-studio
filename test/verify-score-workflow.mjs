#!/usr/bin/env node
/**
 * 判据 10：长篇乐谱工作流（score_new / score_read / score_edit / score_export）。
 *
 * 为什么单独立一条：这条守的是「长曲编曲质量」——一次成谱时模型必须把整首曲子
 * 写在一个输出里，越写越凑合；改成「一次只填某段某乐器一格」之后，模型每次的
 * 输出面变小、每格还有体检兜着。**这里测的就是那套体检与合成**：
 * 骨架校验、进度视图、调外音、钳位、复读硬门、相对拍位换算、导出裁剪。
 *
 * 测的是**工具与草稿模块**（不是引擎），也就是卡片真正读到的那份数据。
 */
import { apply } from '../lib/index.js';
import {
  parseKey, outOfKey, fingerprint, sameCell, vetNotes,
} from '../lib/check.js';
import {
  applyEdit, assemble, createDraft, exportable, missingCells, nextCellOf, renderProgress, validateSkeleton,
} from '../lib/draft.js';
import { countEvents } from '../lib/shared/score-info.js';

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? (pass++, console.log('  PASS  ' + n + (d ? '  (' + d + ')' : '')))
    : (fail++, console.log('  FAIL  ' + n + (d ? '  (' + d + ')' : '')));
};

/* ══ C 组：判据（src/check.ts）═══════════════════════════════════════ */

check('C1 parseKey 认大调：C → 根音 C、非小调',
  JSON.stringify(parseKey('C')) === JSON.stringify({ root: 0, minor: false }), JSON.stringify(parseKey('C')));
check('C2 parseKey 认小调：F#m → 根音 F#、小调',
  JSON.stringify(parseKey('F#m')) === JSON.stringify({ root: 6, minor: true }), JSON.stringify(parseKey('F#m')));
check('C3 parseKey 认不出：Sora → null', parseKey('Sora') === null, String(parseKey('Sora')));
check('C4 C 大调下挑出 F#4',
  outOfKey([{ midi: 66, start: 0, dur: 1, vel: 0.8 }], 'C', () => 1).map((x) => x.name).join(',') === 'F#4',
  JSON.stringify(outOfKey([{ midi: 66, start: 0, dur: 1, vel: 0.8 }], 'C', () => 1)));
check('C5 C 大调下 Bb4 也算调外',
  outOfKey([{ midi: 70, start: 0, dur: 1, vel: 0.8 }], 'C', () => 1).length === 1);
check('C6 A 小调（自然小调）允许 G4',
  outOfKey([{ midi: 67, start: 0, dur: 1, vel: 0.8 }], 'Am', () => 1).length === 0);
check('C7 同音高同时值同起点 → 指纹相同（力度不影响指纹）',
  fingerprint([{ midi: 60, start: 0, dur: 1, vel: 0.8 }]) === fingerprint([{ midi: 60, start: 0, dur: 1, vel: 0.4 }]));
check('C8 只有力度不同 → 仍算重复',
  sameCell([{ midi: 60, start: 0, dur: 1, vel: 0.8 }], [{ midi: 60, start: 0, dur: 1, vel: 0.3 }]) === true);
check('C9 时值不同 → 不算重复',
  sameCell([{ midi: 60, start: 0, dur: 1, vel: 0.8 }], [{ midi: 60, start: 0, dur: 2, vel: 0.8 }]) === false);
check('C9b 两格都空 → 不算重复',
  sameCell([], []) === false);

const v = vetNotes([['C4', 0, 1, 0.8], ['C4', 4, 1, 0.8], ['ZZ', 0, 1, 0.8]], 4);
check('C10 段内合法音留下', v.notes.length === 1, `notes=${v.notes.length}`);
check('C11 两个坏音都被丢弃（起点越界 + 认不出）', v.dropped === 2, `dropped=${v.dropped}`);

const c2 = vetNotes([['C4', 0, 99, 3]], 4);
check('C12 时值钳到 16、力度钳到 1，且两件都明说',
  c2.notes[0].dur === 16 && c2.notes[0].vel === 1 && c2.clamps.length === 2, c2.clamps.join('；'));

const c3 = vetNotes([['C0', 0, 1, 0.8]], 4);
check('C13 音高越界钳位（C0 → 低限）并明说',
  c3.notes[0].midi === 24 && c3.clamps.length === 1, c3.clamps.join('；'));

/* ══ D 组：草稿（src/draft.ts）═══════════════════════════════════════ */

const okSkel = {
  title: '雨夜', mood: '湿冷', meter: '4/4', bpm: 96, bars: 16, groove: 'straight', key: 'C',
  chords: 'C Am F G', chordsEvery: 1,
  tracks: [{ name: '低音', wave: 'bass', gain: 0.22 }, { name: '旋律', wave: 'shakuhachi', gain: 0.18 }],
  sections: [
    { label: '起', role: '主题', fromBar: 1, toBar: 8 },
    { label: '承', role: '展开', fromBar: 9, toBar: 16 },
  ],
};
const withSections = (sections, extra = {}) => ({ ...okSkel, sections, ...extra });

check('D1 完整骨架通过', validateSkeleton(okSkel).skeleton !== null, validateSkeleton(okSkel).reason);
check('D2 段表不连续被拒',
  validateSkeleton(withSections([{ label: '起', role: '主题', fromBar: 1, toBar: 8 }, { label: '承', role: '展开', fromBar: 10, toBar: 16 }])).skeleton === null);
check('D3 末段没盖到 bars 被拒',
  validateSkeleton(withSections([{ label: '起', role: '主题', fromBar: 1, toBar: 8 }])).skeleton === null);
check('D4 单段 ≤16 小节通过、17 小节被拒',
  validateSkeleton(withSections([{ label: '起', role: '主题', fromBar: 1, toBar: 16 }], { bars: 16 })).skeleton !== null
    && validateSkeleton(withSections([{ label: '起', role: '主题', fromBar: 1, toBar: 17 }], { bars: 17 })).skeleton === null);
check('D5 音色名不认识被拒',
  validateSkeleton({ ...okSkel, tracks: [{ name: '怪', wave: 'kazoo', gain: 0.2 }] }).skeleton === null);
check('D6 调性认不出被拒', validateSkeleton({ ...okSkel, key: 'Sora' }).skeleton === null);
check('D7 重名乐器被拒',
  validateSkeleton({ ...okSkel, tracks: [{ name: '低音', wave: 'bass', gain: 0.2 }, { name: '低音', wave: 'pad', gain: 0.2 }] }).skeleton === null);
/* 7/8 的小节数上限是 138（引擎口径 ceil(240×4/7)）；段表用 9 段（每段 ≤16 小节）盖满 140 小节，
   这样被拒只可能是因为小节数，而不是段表 —— 判据隔离。 */
const s78 = {
  ...okSkel, meter: '7/8', bars: 140,
  sections: [
    ...Array.from({ length: 8 }, (_, i) => ({ label: 'x', role: 'r', fromBar: i * 16 + 1, toBar: i * 16 + 16 })),
    { label: 'z', role: 'r', fromBar: 129, toBar: 140 },
  ],
};
check('D8 小节数超出拍号上限被拒（7/8 上限 138，且原因指向它）',
  validateSkeleton(s78).skeleton === null && /138/.test(validateSkeleton(s78).reason), validateSkeleton(s78).reason);

const d = createDraft(validateSkeleton(okSkel).skeleton);
check('D9 新草稿：6 格全缺（3 列 × 2 段）、下一步是第 1 段的「低音」',
  missingCells(d).length === 6 && nextCellOf(d).section === 1 && nextCellOf(d).track === '低音',
  missingCells(d).join('、'));
const view0 = renderProgress(d);
check('D10 进度视图含乐器清单与段表', /低音\(bass\)/.test(view0) && /1-8/.test(view0));
check('D11 一格没写时进度视图不写体检行', !/体检/.test(view0));

/* 实测抓到的：和弦那行漏了数字前的空格，写成「每2 小节一个」。 */
const dChord = createDraft(validateSkeleton({ ...okSkel, chordsEvery: 2 }).skeleton);
check('D11b 和弦行写「每 2 小节一个」（数字前后都要空格）',
  /每 2 小节一个/.test(renderProgress(dChord)), (renderProgress(dChord).match(/和弦：[^\n]*/) || [''])[0]);
check('D11c 每小节一个时不写数字', /每小节一个/.test(renderProgress(d)), (renderProgress(d).match(/和弦：[^\n]*/) || [''])[0]);

const e1 = applyEdit(d, { section: 1, track: '低音', notes: [['C2', 0, 4, 0.7], ['G2', 4, 4, 0.6]] });
check('D12 落格成功且回执含体检行', e1.ok && /体检/.test(e1.reply), e1.reply.split('\n')[0]);
check('D13 落格后下一步推进到第 1 段的「旋律」', nextCellOf(d).track === '旋律');
check('D14 进度视图出现 ✓ 与下一步', /✓2/.test(renderProgress(d)) && /下一步：第 1 段的「旋律」/.test(renderProgress(d)));
check('D15 未知名乐器不带 wave 被拒', applyEdit(d, { section: 1, track: '竖琴' }).ok === false);
check('D16 两种形态都缺 / 都给 → 被拒',
  applyEdit(d, { section: 1 }).ok === false && applyEdit(d, { section: 1, track: '低音', percussion: [['kick', 0, 0.8]] }).ok === false);
const e2 = applyEdit(d, { section: 1, track: '竖琴', wave: 'harp', notes: [['C4', 0, 2, 0.5]] });
check('D17 未知名乐器带 wave = 新增乐器', e2.ok === true && /新增乐器/.test(e2.reply), e2.reply.split('\n').slice(-1)[0]);
check('D18 新增乐器后进度表多一列（4 列 × 2 段）、缺格数变成 6', missingCells(d).length === 6, missingCells(d).join('、'));

const dup = applyEdit(d, { section: 2, track: '低音', notes: [['C2', 0, 4, 0.7], ['G2', 4, 4, 0.6]] });
check('D19 与第 1 段低音逐音一致 → 退回', dup.ok === false && /第 1 段/.test(dup.reply), dup.reply.split('\n')[0]);
check('D20 被退回的一格不留痕（没落进草稿、计数器没动）',
  missingCells(d).length === 6 && d.clamps.length === 0 && missingCells(d).includes('第 2 段「低音」'));

applyEdit(d, { section: 1, percussion: [['kick', 0, 0.8]] });
const dupDrum = applyEdit(d, { section: 2, percussion: [['kick', 0, 0.8]] });
check('D21 鼓格重复不退回（鼓组循环是正常的）', dupDrum.ok === true, dupDrum.reply.split('\n')[0]);

applyEdit(d, { section: 2, track: '旋律', notes: [['G4', 0, 2, 0.8]] });
const partial = assemble(d, { trim: true });
check('D22 绝对拍位换算：第 2 段第 0 拍 → 第 9 小节起始拍（32）',
  partial.score.tracks.find((t) => t.name === '旋律').notes[0].start === 32,
  String(partial.score.tracks.find((t) => t.name === '旋律').notes[0].start));
check('D23 音符总数 = 各格之和（2+1+1+1+1）', countEvents(partial.score) === 6, String(countEvents(partial.score)));
check('D24 缺格被点名（段1旋律、段2低音、段2竖琴）', partial.missing.length === 3, partial.missing.join('、'));
check('D25 引擎规范化确实跑过（音轨带 wave/gain）',
  partial.score.tracks.every((t) => typeof t.wave === 'string' && typeof t.gain === 'number'));

const skel32 = {
  ...okSkel, bars: 32,
  sections: [
    { label: '起', role: '主题', fromBar: 1, toBar: 8 },
    { label: '承', role: '展开', fromBar: 9, toBar: 16 },
    { label: '转', role: '高潮', fromBar: 17, toBar: 24 },
    { label: '合', role: '回归', fromBar: 25, toBar: 32 },
  ],
};
const d32 = createDraft(validateSkeleton(skel32).skeleton);
check('D26 32 小节草稿：12 格全缺', missingCells(d32).length === 12, String(missingCells(d32).length));
applyEdit(d32, { section: 1, track: '低音', notes: [['C2', 0, 4, 0.7]] });
const trimmed = assemble(d32, { trim: true });
check('D27 trim：只写第 1 段 → 节拍裁到 8 小节', trimmed.score.bars === 8, String(trimmed.score.bars));
check('D28 trim：段表只剩第 1 段', trimmed.score.sections.length === 1, JSON.stringify(trimmed.score.sections));
check('D29 trim：已写小节数 = 8', trimmed.writtenBars === 8, String(trimmed.writtenBars));
const full = assemble(d32, { trim: false });
check('D30 不 trim：整曲 32 小节、段表 4 段', full.score.bars === 32 && full.score.sections.length === 4);
check('D31 只写一格也能导出（可渲染）', exportable(trimmed) === true);

const dEmpty = createDraft(validateSkeleton(skel32).skeleton);
check('D32 一格没写 → 不可导出', exportable(assemble(dEmpty, { trim: true })) === false);

/* ══ T 组：工具接线（src/tool.ts + src/index.ts）════════════════════ */

const tools = [];
apply({
  systemPrompt: { section: () => {}, getSectionOrder: () => 100 },
  inject: (deps, cb) => {
    if (deps.includes('tools')) {
      cb({
        tools: { register: (t) => { tools.push(t); return () => {}; } },
        effect: (fn) => {
          const it = fn();
          if (it?.next) { let r = it.next(); let g = 0; while (!r.done && g++ < 20) r = it.next(); }
        },
      });
    }
    if (deps.includes('skills')) cb({ skills: { registerProvider: () => {} } });
  },
});
const byName = (n) => tools.find((t) => t.name === n);

check('T1 play_score 仍是第一个注册的工具（现有判定脚本按 tools[0] 取它）',
  tools[0]?.name === 'play_score', tools.map((t) => t.name).join(','));
check('T2 五个工具都注册上了',
  ['play_score', 'score_new', 'score_read', 'score_edit', 'score_export'].every((n) => byName(n) !== undefined),
  tools.map((t) => t.name).join(','));
check('T3 回执类工具不出卡（没有 presentationMeta）',
  ['score_new', 'score_read', 'score_edit'].every((n) => byName(n).output.presentationMeta === undefined));

const execA = { agent: { id: 'sess-A' } };
const execZ = { agent: { id: 'sess-Z' } };
const execNone = { agent: { id: 'sess-NONE' } };

const out1 = await byName('score_new').execute(okSkel, execA);
check('T4 score_new 返回进度视图（含乐器清单与下一步）',
  typeof out1 === 'string' && /低音\(bass\)/.test(out1) && /下一步：第 1 段的「低音」/.test(out1), String(out1).split('\n')[0]);
check('T5 骨架不成立时退回可读原因，不抛异常',
  /骨架不成立/.test(await byName('score_new').execute({ ...okSkel, key: 'Sora' }, execA)));
check('T6 无草稿的会话：read / edit / export 都明说重建',
  /没有正在进行的乐谱/.test(await byName('score_read').execute({}, execNone))
  && /没有正在进行的乐谱/.test(await byName('score_edit').execute({ section: 1, track: '低音', notes: [] }, execNone))
  && /没有正在进行的乐谱/.test((await byName('score_export').execute({}, execNone)).summary));
check('T7 会话隔离：sess-Z 看不到 sess-A 的草稿',
  /没有正在进行的乐谱/.test(await byName('score_read').execute({}, execZ))
  && /低音/.test(await byName('score_read').execute({}, execA)));

const out2 = await byName('score_edit').execute({ section: 1, track: '低音', notes: [['C2', 0, 4, 0.7]] }, execA);
check('T8 edit 回执带体检行与进度行', typeof out2 === 'string' && /体检/.test(out2) && /进度：/.test(out2), String(out2).split('\n')[0]);
check('T9 read 能看到刚写的那一格（✓ 计数）', /✓1/.test(await byName('score_read').execute({}, execA)));

await byName('score_new').execute(okSkel, execZ);
const emptyExport = await byName('score_export').execute({}, execZ);
check('T10 一格没写的草稿导出被拒（可读原因）', /先 score_edit/.test(emptyExport.summary), emptyExport.summary);

const out3 = await byName('score_export').execute({}, execA);
check('T11 export 小结含「已写」与「还差 N 格」',
  /已写 8\/16 小节/.test(out3.summary) && /还差 5 格/.test(out3.summary), out3.summary.split('\n')[1]);
check('T12 export 的 value 带完整乐谱且裁到已写范围',
  out3.score.tracks.length > 0 && out3.score.bars === 8, `bars=${out3.score.bars}`);
check('T13 export 的 render 只回一行小结（大 JSON 不进模型上下文）',
  byName('score_export').output.render({}, out3)[0].text === out3.summary && out3.summary.length < 400,
  String(out3.summary.length));
check('T14 export 的 meta 带乐谱与钳位警告',
  byName('score_export').output.presentationMeta({}, out3).score.tracks.length > 0
  && Array.isArray(byName('score_export').output.presentationMeta({}, out3).warn));

const legacy = await byName('play_score').execute({
  score: { mode: 'melody', meter: '4/4', bpm: 96, bars: 1, title: '短曲',
    tracks: [{ name: 'a', wave: 'marimba', gain: 0.2, notes: [['C4', 0, 1, 0.8]] }], percussion: [] },
}, execA);
check('T15 老路径不回归：play_score 照旧返回一行小结',
  typeof legacy === 'string' && /BPM/.test(legacy), String(legacy).slice(0, 60));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
