//#region src/shared/color.ts
/**
* 颜色解析（纯逻辑，不碰 DOM —— 所以能在 Node 里直接测）。
*
* 为什么需要它：DSH 的主题令牌是 **8 位带透明度**的十六进制，
* 例如深色主题下 `--dsw-alias-bg-base` 实测是 `#141a2eb3`（alpha=0.7）。
* 只认 3/6 位的解析器会全部解析失败 —— 于是「明暗判定」永远走兜底分支，
* 看起来能用，其实一直在瞎猜：一旦 DSH 主题与系统偏好不一致就配反色。
*/
/** 解析 `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` → 亮度 0..1；认不出返回 null。 */
function luminanceOf(css) {
	const s = css.trim();
	if (s === "") return null;
	let r = 0;
	let g = 0;
	let b = 0;
	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
	if (hex !== null) {
		const h = hex[1];
		const six = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
		r = parseInt(six.slice(0, 2), 16);
		g = parseInt(six.slice(2, 4), 16);
		b = parseInt(six.slice(4, 6), 16);
	} else {
		const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
		if (rgb === null) return null;
		r = Number(rgb[1]);
		g = Number(rgb[2]);
		b = Number(rgb[3]);
	}
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
	return (.2126 * r + .7152 * g + .0722 * b) / 255;
}
/** 一个颜色算不算「暗」。认不出来返回 null（交给调用方兜底）。 */
function isDarkColor(css) {
	const lum = luminanceOf(css);
	return lum === null ? null : lum < .5;
}
//#endregion
export { isDarkColor, luminanceOf };
