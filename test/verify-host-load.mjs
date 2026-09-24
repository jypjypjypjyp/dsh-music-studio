#!/usr/bin/env node
/**
 * 判据 6（宿主侧）：宿主半能被真的加载、apply 能跑完、注册的东西形状对。
 *
 * 为什么需要：宿主半的问题只有在 DSH 启动时才会暴露，而重启一次要掐断
 * 主人正在用的会话。这个冒烟测试用桩 ctx 把 apply 跑一遍，把「加载就崩」
 * 这类错误提前到重启之前发现。
 *
 * 测的是构建产物 lib/index.js —— 真正会被宿主加载的那份。
 */
import { apply, name, inject } from '../lib/index.js';

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? (pass++, console.log('  PASS  ' + n + (d ? '  (' + d + ')' : '')))
    : (fail++, console.log('  FAIL  ' + n + (d ? '  (' + d + ')' : '')));
};

check('导出 name', name === 'dsh-music-studio', String(name));
check('导出 inject（硬门只声明必然存在的服务）', Array.isArray(inject) && inject.includes('systemPrompt'), JSON.stringify(inject));

/* ── 桩 ctx：记录所有注册动作 ────────────────────────────────────────── */
const sections = [];
const tools = [];
const providers = [];
const ctx = {
  systemPrompt: {
    section(s) { sections.push(s); },
    getSectionOrder(k) { return 100; },
  },
  inject(deps, cb) {
    if (deps.includes('tools')) {
      cb({
        tools: { register: (t) => { tools.push(t); return () => {}; } },
        effect(fn, label) {
          const it = fn();
          if (it && typeof it.next === 'function') {
            let r = it.next();
            let guard = 0;
            while (!r.done && guard++ < 20) r = it.next();
          }
        },
      });
    }
    if (deps.includes('skills')) {
      cb({ skills: { registerProvider: (p) => providers.push(p) } });
    }
  },
};

let threw = null;
try { apply(ctx); } catch (e) { threw = e; }
check('apply 不抛异常', threw === null, threw ? String(threw && threw.message) : '无');

/* ── 注册内容形状 ───────────────────────────────────────────────────── */
check('注册了 1 段常驻提示词', sections.length === 1, String(sections.length));
check('提示词段有 name/order/text',
  sections[0] && typeof sections[0].name === 'string' && typeof sections[0].order === 'number' && typeof sections[0].text === 'string',
  sections[0] ? `${sections[0].name} (${sections[0].text.length} 字)` : '无');
check('提示词段不是一大坨（常驻体积要小）',
  sections[0] && sections[0].text.length < 800, sections[0] ? String(sections[0].text.length) + ' 字' : '无');

check('注册了 1 个工具', tools.length === 1, String(tools.length));
const tool = tools[0] ?? {};
check('工具名是 play_score', tool.name === 'play_score', String(tool.name));
check('工具有描述', typeof tool.description === 'string' && tool.description.length > 30);
check('工具有 JSON Schema 参数（score 必填）',
  tool.parameters && tool.parameters.type === 'object' && Array.isArray(tool.parameters.required)
  && tool.parameters.required.includes('score'), JSON.stringify(tool.parameters?.required));
check('工具有 output.schema', !!tool.output && !!tool.output.schema);
check('工具有 output.render 与 presentationMeta',
  typeof tool.output?.render === 'function' && typeof tool.output?.presentationMeta === 'function');
check('工具有 presentCall / presentResult',
  typeof tool.presentCall === 'function' && typeof tool.presentResult === 'function');

/* ── 提示词展示函数是纯的、能重放 ────────────────────────────────────── */
const goodArgs = { score: { title: '雨夜', mode: 'melody', meter: '4/4', bpm: 96, bars: 4,
  tracks: [{ name: 'a', wave: 'piano', gain: 0.2, notes: [['C4', 0, 4, 0.7]] }], percussion: [] } };
check('presentCall 给出卡片标题', tool.presentCall?.(goodArgs)?.title === '演奏《雨夜》',
  JSON.stringify(tool.presentCall?.(goodArgs)));
check('presentResult 用 generic 卡片', tool.presentResult?.(goodArgs)?.card === 'generic');
check('参数残缺时 presentCall 不抛异常', (() => { try { tool.presentCall?.({}); return true; } catch { return false; } })());
check('参数是垃圾时 presentCall 不抛异常', (() => { try { tool.presentCall?.('不是对象'); return true; } catch { return false; } })());
check('presentationMeta 对垃圾输入返回 null', tool.output.presentationMeta('不是对象') === null);

/* ── execute 三条分支 ───────────────────────────────────────────────── */
const okSummary = await tool.execute(goodArgs, {});
check('execute 合法谱：返回中文小结', typeof okSummary === 'string' && okSummary.includes('雨夜'), String(okSummary).slice(0, 60));
check('execute 合法谱：小结里有规模', typeof okSummary === 'string' && okSummary.includes('BPM'));

const badSummary = await tool.execute({ score: { mode: 'melody', tracks: '不是数组' } }, {});
check('execute 结构错：不抛，返回可读原因', typeof badSummary === 'string' && badSummary.includes('不可用'), String(badSummary).slice(0, 80));

const meta = tool.output.presentationMeta(goodArgs);
check('presentationMeta 交出了乐谱与警告', meta && typeof meta === 'object' && !!meta.score, meta ? Object.keys(meta).join(',') : '无');

/* ── skill provider ─────────────────────────────────────────────────── */
check('注册了 1 个 skill provider', providers.length === 1, String(providers.length));
const provider = providers[0]?.();
const listed = provider ? await provider.list() : [];
check('skill 列表里有 music-studio', listed.some((s) => s.name === 'music-studio'), listed.map((s) => s.name).join(','));
const got = provider ? await provider.get({ name: 'music-studio' }) : null;
check('skill 正文可读且不小', typeof got?.content === 'string' && got.content.length > 2000,
  got?.content ? got.content.length + ' 字' : '无');
check('skill 正文里没有 frontmatter 残留', typeof got?.content === 'string' && !got.content.startsWith('---'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
