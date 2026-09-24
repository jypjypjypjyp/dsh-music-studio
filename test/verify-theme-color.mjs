#!/usr/bin/env node
/**
 * 判据 8：明暗判定的颜色解析。
 *
 * 为什么值得单独立一条：这条判据守的是「配色不会配反」。DSH 的主题令牌是
 * **8 位带透明度**的十六进制（深色主题实测 `--dsw-alias-bg-base = #141a2eb3`），
 * 只认 3/6 位的解析器会全都解析失败，于是明暗判定永远走兜底分支 —— 系统偏好
 * 恰好等于 DSH 主题时看起来一切正常，两者不一致时就配反色。
 * 这个 bug 正是 live 测试抓出来的。
 *
 * 用例里的期望值取自真机读到的令牌值。
 */
import { luminanceOf, isDarkColor } from '../lib/shared/color.js';

let pass = 0, fail = 0;
const check = (n, c, d) => {
  c ? (pass++, console.log('  PASS  ' + n + (d ? '  (' + d + ')' : '')))
    : (fail++, console.log('  FAIL  ' + n + (d ? '  (' + d + ')' : '')));
};

/* ── 真机上读到的令牌值 ─────────────────────────────────────────────── */
const DARK_BG = '#141a2eb3';   // 深色主题 --dsw-alias-bg-base（8 位带 alpha）
check('8 位十六进制（深色底）判为暗', isDarkColor(DARK_BG) === true, `${DARK_BG} → ${String(isDarkColor(DARK_BG))}`);
check('8 位十六进制能解析出亮度', luminanceOf(DARK_BG) !== null, String(luminanceOf(DARK_BG)));
check('深色底亮度 < 0.2', (luminanceOf(DARK_BG) ?? 1) < 0.2, (luminanceOf(DARK_BG) ?? -1).toFixed(3));

const LIGHT_BG = ' #fffaf5ff ';
check('8 位十六进制（亮色底）判为亮', isDarkColor(LIGHT_BG) === false, `${LIGHT_BG.trim()} → ${String(isDarkColor(LIGHT_BG))}`);

/* ── 其它常见写法 ───────────────────────────────────────────────────── */
check('#rgb 短写法', isDarkColor('#fff') === false);
check('#rgba 短写法（4 位）', isDarkColor('#000f') === true);
check('#rrggbb', isDarkColor('#1b2430') === true);
check('rgb()', isDarkColor('rgb(20, 26, 46)') === true);
check('rgba()', isDarkColor('rgba(255, 250, 245, 0.9)') === false);
check('前后空白不影响', isDarkColor('   #141a2e   ') === true);

/* ── 认不出来要如实返回 null（而不是猜一个） ────────────────────────── */
check('空字符串 → null', luminanceOf('') === null);
check('非颜色串 → null', luminanceOf('var(--dsw-alias-bg-base)') === null);
check('hsl 未支持 → null（如实承认，不瞎猜）', luminanceOf('hsl(210 40% 10%)') === null);
check('isDarkColor 认不出时为 null', isDarkColor('not-a-color') === null);

/* ── 边界：中灰两侧 ─────────────────────────────────────────────────── */
check('中灰偏亮 (0.55) 判为亮', isDarkColor('#8c8c8c') === false, String(luminanceOf('#8c8c8c')));
check('中灰偏暗 (0.45) 判为暗', isDarkColor('#737373') === true, String(luminanceOf('#737373')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
