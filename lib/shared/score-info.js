//#region src/shared/score-info.ts
/** 音符 + 打击乐的总事件数（与 index.html 的 countEvents 同口径）。 */
function countEvents(score) {
	if (score.mode === "sfx") return score.layers.length;
	let n = score.percussion.length;
	for (const t of score.tracks) n += t.notes.length;
	return n;
}
/** 秒 → m:ss。 */
function fmtDur(sec) {
	const m = Math.floor(sec / 60);
	const s = Math.round(sec % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}
/** 这张谱实际用到的音色名（去重、保序）。 */
function usedTimbres(score) {
	const out = [];
	for (const t of score.tracks) if (!out.includes(t.wave)) out.push(t.wave);
	for (const l of score.layers) if (typeof l.wave === "string" && l.wave && !out.includes(l.wave)) out.push(l.wave);
	return out;
}
/**
* 一张谱能不能交给卡片 —— 全插件只有这一条判据：**至少有一个可发声事件**。
*
* 为什么不能只看 normalizeScore 是否返回 null：实测引擎对「tracks 不是数组」
* 这类结构错不会返回 null，而是返回一张**没有音轨的空谱**加一句警告。空谱交给
* 卡片就是一张点了没反应的卡，所以这里必须再卡一道。
*/
function isRenderable(score) {
	if (score === null || score === void 0) return false;
	return countEvents(score) > 0;
}
//#endregion
export { countEvents, fmtDur, isRenderable, usedTimbres };
