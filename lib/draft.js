import { a as sameCell, c as GROOVES, d as beatsOf, f as clamp, h as normalizeScore, i as parseKey, l as METERS, m as midiToName, n as numOr, p as durationOf, r as outOfKey, s as vetNotes, u as TIMBRES } from "./check-DLJj4knt.mjs";
import { countEvents, fmtDur, usedTimbres } from "./shared/score-info.js";
//#region src/draft.ts
/**
* 草稿：一份骨架 + 逐格内容（某段 × 某乐器）。
*
* 这就是「像改代码一样写曲子」的那份文档。格是一次编辑的单位，格里的拍位
* **相对本段起算**，合成时才换算成绝对拍位 —— 模型因此从不做「第 41 小节是
* 第几拍」这种心算，而长曲出错的重灾区正是这个心算。
*
* 骨架锁死的是调性、和弦、音色、速度、拍号、律动与段表：这些模型在格层面
* **物理上改不动**，所以「后半段偷偷换音色/改速度/跑调」这类退化不会发生。
*/
/** 鼓件清单（与引擎 percussion 分支同一份口径）。 */
const DRUM_KINDS = [
	"kick",
	"snare",
	"hat",
	"clap",
	"tom"
];
/** 鼓在进度表里占的那一列的名字（它不是一个 track，但算一格）。 */
const DRUM_COLUMN = "鼓";
/** 一段最多几小节：一格一次写得完的上限。 */
const MAX_SECTION_BARS = 16;
/** 段数上限（引擎 MAX_SECTIONS）。 */
const MAX_SECTIONS = 24;
/** 音轨上限（引擎 MAX_TRACKS）。 */
const MAX_TRACKS = 8;
function cellKey(section, track) {
	return `${section}/${track}`;
}
function beatsPerBarOf(sk) {
	return beatsOf({ meter: sk.meter });
}
function sectionBars(s) {
	return s.toBar - s.fromBar + 1;
}
function sectionBeatsOf(sk, s) {
	return sectionBars(s) * beatsPerBarOf(sk);
}
/** 进度表的列：骨架的音轨顺序 + 最后一列鼓。 */
function columnsOf(draft) {
	return [...draft.skeleton.tracks.map((t) => t.name), "鼓"];
}
function cellOf(draft, section, column) {
	return draft.cells.get(cellKey(section, column));
}
/**
* 一格算不算「写过了」：**写过就算**，哪怕写的是空数组。
*
* 为什么空数组也算：一段里某个乐器故意留白（安静段落不要鼓）是正当编配，
* 必须给它一个「我已经决定这里不写」的表达方式，否则 progress 永远差一格、
* 模型也会被「下一步」反复推回同一格。
*/
function written(cell) {
	return cell !== void 0;
}
function str(v) {
	return typeof v === "string" ? v.trim() : "";
}
/** 「每 N 小节一个」里的那半句（N=1 时不写数字；数字前后都要留空格，实测漏过前面那个）。 */
function everyText(n) {
	return n === 1 ? "" : ` ${n} `;
}
/**
* 校验一份骨架。**任一条不过就不建谱**，返回可读原因 ——
* 「起稿也要准」：骨架就是把后面几十格钉住的模具，模具歪了后面全歪。
*/
function validateSkeleton(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {
		skeleton: null,
		reason: "score_new 的参数必须是一个对象（骨架）"
	};
	const r = raw;
	const meterRaw = str(r.meter);
	const meter = METERS[meterRaw] !== void 0 ? meterRaw : "4/4";
	const beats = METERS[meter].beats;
	const maxBars = Math.ceil(960 / beats);
	const bars = Math.round(numOr(r.bars, 0));
	if (!(bars >= 1 && bars <= maxBars)) return {
		skeleton: null,
		reason: `bars（全曲小节数）要在 1–${maxBars} 之间，${meter} 的上限是 ${maxBars}，收到 ${String(r.bars)}`
	};
	const key = str(r.key);
	if (parseKey(key) === null) return {
		skeleton: null,
		reason: `key（调性）认不出：${JSON.stringify(str(r.key))}。写法是 A–G 加可选 # / b，小调在末尾加 m，例如 C、F#、Bbm`
	};
	const rawTracks = Array.isArray(r.tracks) ? r.tracks : [];
	if (rawTracks.length < 1 || rawTracks.length > MAX_TRACKS) return {
		skeleton: null,
		reason: `tracks 要有 1–${MAX_TRACKS} 条，收到 ${rawTracks.length} 条`
	};
	const tracks = [];
	for (const rt of rawTracks) {
		if (rt === null || typeof rt !== "object") return {
			skeleton: null,
			reason: "tracks 里每一项都要是 {name, wave, gain}"
		};
		const t = rt;
		const name = str(t.name);
		const wave = str(t.wave);
		if (name === "") return {
			skeleton: null,
			reason: "tracks 里有一项缺 name（乐器名）"
		};
		if (name === "鼓") return {
			skeleton: null,
			reason: `乐器名不能叫「鼓」——那一列留给打击乐`
		};
		if (tracks.some((x) => x.name === name)) return {
			skeleton: null,
			reason: `乐器名重复：${name}`
		};
		if (TIMBRES[wave] === void 0) return {
			skeleton: null,
			reason: `音色 ${JSON.stringify(wave)} 不在音色清单里（见 music-studio skill 的「音色清单」）`
		};
		tracks.push({
			name,
			wave,
			gain: clamp(numOr(t.gain, .18), .01, .6)
		});
	}
	const rawSections = Array.isArray(r.sections) ? r.sections : [];
	if (rawSections.length < 1 || rawSections.length > MAX_SECTIONS) return {
		skeleton: null,
		reason: `sections 要有 1–${MAX_SECTIONS} 段，收到 ${rawSections.length} 段`
	};
	const sections = [];
	let expect = 1;
	for (const rs of rawSections) {
		if (rs === null || typeof rs !== "object") return {
			skeleton: null,
			reason: "sections 里每一项都要是 {label, role, fromBar, toBar}"
		};
		const s = rs;
		const fromBar = Math.round(numOr(s.fromBar, 0));
		const toBar = Math.round(numOr(s.toBar, 0));
		const label = str(s.label);
		const role = str(s.role);
		if (fromBar !== expect) return {
			skeleton: null,
			reason: `段表要从第 1 小节起逐段相接：第 ${sections.length + 1} 段应从第 ${expect} 小节开始，收到 fromBar=${String(s.fromBar)}`
		};
		if (toBar < fromBar) return {
			skeleton: null,
			reason: `第 ${sections.length + 1} 段的 toBar(${toBar}) 小于 fromBar(${fromBar})`
		};
		if (sectionBars({
			label,
			role,
			fromBar,
			toBar
		}) > MAX_SECTION_BARS) return {
			skeleton: null,
			reason: `第 ${sections.length + 1} 段有 ${sectionBars({
				label,
				role,
				fromBar,
				toBar
			})} 小节，超过每段上限 ${MAX_SECTION_BARS} 小节 —— 拆成两段`
		};
		sections.push({
			label,
			role,
			fromBar,
			toBar
		});
		expect = toBar + 1;
	}
	if (expect - 1 !== bars) return {
		skeleton: null,
		reason: `段表没盖满全曲：段表到第 ${expect - 1} 小节，bars 说全曲 ${bars} 小节 —— 段表必须正好覆盖第 1–${bars} 小节`
	};
	const grooveRaw = str(r.groove);
	const groove = GROOVES[grooveRaw] !== void 0 ? grooveRaw : "straight";
	return {
		skeleton: {
			title: str(r.title) || "无题",
			mood: str(r.mood),
			meter,
			bpm: Math.round(clamp(numOr(r.bpm, 96), 40, 200)),
			bars,
			groove,
			key,
			chords: str(r.chords),
			chordsEvery: Math.round(clamp(numOr(r.chordsEvery, 1), 1, 8)),
			tracks,
			sections
		},
		reason: ""
	};
}
function createDraft(skeleton) {
	return {
		skeleton,
		cells: /* @__PURE__ */ new Map(),
		dropped: 0,
		clamps: []
	};
}
/** 下一个该写的格：按段推进，段内按乐器顺序、鼓最后。 */
function nextCellOf(draft) {
	const columns = columnsOf(draft);
	for (let n = 1; n <= draft.skeleton.sections.length; n++) for (const column of columns) if (!written(cellOf(draft, n, column))) return {
		section: n,
		track: column
	};
	return null;
}
/** 还缺哪些格（供导出前点名）。 */
function missingCells(draft) {
	const out = [];
	const columns = columnsOf(draft);
	for (let n = 1; n <= draft.skeleton.sections.length; n++) for (const column of columns) if (!written(cellOf(draft, n, column))) out.push(`第 ${n} 段「${column}」`);
	return out;
}
function dispWidth(s) {
	let w = 0;
	for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 11904 ? 2 : 1;
	return w;
}
function pad(s, w) {
	return dispWidth(s) >= w ? s : s + " ".repeat(w - dispWidth(s));
}
function barOfIn(sk, s, startBeat) {
	return s.fromBar + Math.floor(startBeat / beatsPerBarOf(sk));
}
/** 全草稿的调外音（最多 3 个）。 */
function outOfKeyAll(draft) {
	const out = [];
	for (const track of draft.skeleton.tracks) for (let n = 1; n <= draft.skeleton.sections.length; n++) {
		const cell = cellOf(draft, n, track.name);
		if (cell === void 0) continue;
		const section = draft.skeleton.sections[n - 1];
		out.push(...outOfKey(cell.notes, draft.skeleton.key, (b) => barOfIn(draft.skeleton, section, b)));
		if (out.length >= 3) return out.slice(0, 3);
	}
	return out;
}
/** 一格里的音符数（进度表用）。 */
function countOf(cell) {
	if (cell === void 0) return 0;
	return cell.notes.length + cell.drums.length;
}
/**
* 进度视图 —— 模型「read」出来的那张表（也是主人看得懂的那张）。
* 格式是契约：改了它就要同步改 skill。
*/
function renderProgress(draft) {
	const sk = draft.skeleton;
	const columns = columnsOf(draft);
	beatsPerBarOf(sk);
	const lines = [];
	const head = [
		`《${sk.title}》`,
		`${sk.bars} 小节`,
		sk.meter,
		`${sk.bpm} BPM`,
		`${sk.key} 调`,
		sk.groove === "straight" ? "直拍" : sk.groove
	];
	lines.push(head.join(" · "));
	lines.push(`乐器：${sk.tracks.map((t) => `${t.name}(${t.wave})`).join(" · ")} · 鼓`);
	if (sk.chords !== "") lines.push(`和弦：${sk.chords}（每${everyText(sk.chordsEvery)}小节一个，循环）`);
	lines.push("");
	const colW = columns.map((c) => Math.max(dispWidth(c), 4));
	const roleW = Math.max(4, ...sk.sections.map((s) => dispWidth(s.role)));
	const barW = Math.max(4, ...sk.sections.map((s) => dispWidth(`${s.fromBar}-${s.toBar}`)));
	const secW = Math.max(2, String(sk.sections.length).length);
	lines.push([
		pad("段", secW),
		pad("角色", roleW),
		pad("小节", barW),
		...columns.map((c, i) => pad(c, colW[i]))
	].join("  "));
	for (let i = 0; i < sk.sections.length; i++) {
		const s = sk.sections[i];
		const cells = columns.map((c, ci) => {
			const cell = cellOf(draft, i + 1, c);
			return pad(cell === void 0 ? "—" : `✓${countOf(cell)}`, colW[ci]);
		});
		lines.push([
			pad(String(i + 1), secW),
			pad(s.role || s.label, roleW),
			pad(`${s.fromBar}-${s.toBar}`, barW),
			...cells
		].join("  "));
	}
	lines.push("");
	const total = sk.sections.length * columns.length;
	const done = total - missingCells(draft).length;
	const next = nextCellOf(draft);
	const events = countEvents(assembleNoWarn(draft).score);
	lines.push(`进度 ${done}/${total} 格 · ${events} 个音 · ` + (next === null ? "全部写齐，可以 score_export 交给卡片" : `下一步：第 ${next.section} 段的「${next.track}」`));
	const first = sk.tracks.find((t) => written(cellOf(draft, 1, t.name)));
	if (first !== void 0) {
		const names = (cellOf(draft, 1, first.name)?.notes ?? []).slice(0, 12).map((n) => midiToName(n.midi)).join(" ");
		if (names !== "") lines.push(`第 1 段「${first.name}」（动机）：${names}`);
	}
	const bad = outOfKeyAll(draft);
	if (done > 0) {
		const badText = bad.length === 0 ? "不在调内 0 个" : `不在调内 ${bad.length} 个（${bad.map((b) => `${b.name} @ 第 ${b.bar} 小节`).join("、")}）`;
		lines.push(`体检：${badText} · 丢弃 ${draft.dropped} 个音 · 钳位 ${draft.clamps.length} 项`);
	}
	return lines.join("\n");
}
/** 段内相对拍 → 绝对拍，用的是段起始小节。 */
function absolutize(sk, s, beat) {
	return (s.fromBar - 1) * beatsPerBarOf(sk) + beat;
}
function vetDrums(raw, sectionBeats) {
	const list = Array.isArray(raw) ? raw : [];
	const drums = [];
	const clamps = [];
	let dropped = 0;
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		if (!Array.isArray(item)) {
			dropped++;
			continue;
		}
		const kind = typeof item[0] === "string" ? item[0].trim() : "";
		if (!DRUM_KINDS.includes(kind)) {
			dropped++;
			continue;
		}
		const beat = numOr(item[1], 0);
		if (!(beat < sectionBeats)) {
			dropped++;
			clamps.push(`第 ${i + 1} 个鼓点的拍位 ${beat} 落在本段（${sectionBeats} 拍）之外，已丢弃`);
			continue;
		}
		const vel = numOr(item[2], .7);
		const fixedVel = clamp(vel, .05, 1);
		if (fixedVel !== vel) clamps.push(`第 ${i + 1} 个鼓点的力度 ${vel} 超出范围，已钳到 ${fixedVel}`);
		drums.push({
			kind,
			beat: clamp(beat, 0, sectionBeats),
			vel: fixedVel
		});
	}
	return {
		drums,
		dropped,
		clamps
	};
}
/** 读一段的角色名（回执与骨架提醒用）。 */
function sectionOf(draft, n) {
	return draft.skeleton.sections[n - 1];
}
/** 回执里的骨架提醒：调性 + 和弦 + 本段角色（+ 非直拍时的律动）。 */
function skeletonReminder(draft, section) {
	const sk = draft.skeleton;
	const s = sectionOf(draft, section);
	const parts = [`${sk.key} 调`];
	if (sk.chords !== "") parts.push(`和弦 ${sk.chords} 循环（每${everyText(sk.chordsEvery)}小节一个）`);
	if (sk.groove !== "straight") parts.push(`律动 ${sk.groove}`);
	parts.push(`本段角色「${s.role || s.label}」`);
	return `骨架：${parts.join(" · ")}`;
}
/**
* 落一格。`args` 是 `score_edit` 的原始参数：
* `{section, track, notes}` 或 `{section, percussion}`。
*/
function applyEdit(draft, args) {
	if (args === null || typeof args !== "object") return {
		ok: false,
		reply: "score_edit 的参数必须是对象。"
	};
	const a = args;
	const sk = draft.skeleton;
	const section = Math.round(numOr(a.section, 0));
	if (!(section >= 1 && section <= sk.sections.length)) return {
		ok: false,
		reply: `section 要在 1–${sk.sections.length} 之间（这份谱有 ${sk.sections.length} 段），收到 ${String(a.section)}。`
	};
	const hasDrums = Array.isArray(a.percussion);
	const hasTrack = typeof a.track === "string" && a.track.trim() !== "";
	if (hasDrums === hasTrack) return {
		ok: false,
		reply: "一次只写一格：要么给 track + notes，要么给 percussion，两者只能有一个。"
	};
	const s = sectionOf(draft, section);
	const sectionBeats = sectionBeatsOf(sk, s);
	const where = `第 ${section} 段「${hasDrums ? "鼓" : String(a.track).trim()}」`;
	const range = `第 ${s.fromBar}–${s.toBar} 小节`;
	if (hasTrack && !Array.isArray(a.notes)) return {
		ok: false,
		reply: `${where} 少了 notes。乐器形态要给 notes：[音高, 起始拍, 时值拍, 力度] 的数组（空数组 = 这一格刻意留白）。`
	};
	if (hasDrums) {
		const v = vetDrums(a.percussion, sectionBeats);
		draft.clamps.push(...v.clamps);
		draft.dropped += v.dropped;
		draft.cells.set(cellKey(section, "鼓"), {
			notes: [],
			drums: v.drums
		});
		const lines = [
			`${where} 已写入 ${v.drums.length} 个鼓点（${range}）。`,
			skeletonReminder(draft, section),
			`体检：钳位 ${v.clamps.length} 项 · 丢弃 ${v.dropped} 个`
		];
		if (v.clamps.length > 0) lines.push(`明细：${v.clamps.slice(-3).join("；")}`);
		lines.push(progressLine(draft));
		return {
			ok: true,
			reply: lines.join("\n")
		};
	}
	const trackName = String(a.track).trim();
	let track = sk.tracks.find((t) => t.name === trackName);
	let added = false;
	if (track === void 0) {
		const wave = typeof a.wave === "string" ? a.wave.trim() : "";
		if (wave === "") return {
			ok: false,
			reply: `乐器「${trackName}」不在骨架里。要用新乐器请同时给 wave（音色名，见 skill 的音色清单）。可用乐器：${sk.tracks.map((t) => t.name).join("、")}。`
		};
		if (TIMBRES[wave] === void 0) return {
			ok: false,
			reply: `音色 ${JSON.stringify(wave)} 不在音色清单里（见 music-studio skill 的「音色清单」）。`
		};
		if (trackName === "鼓") return {
			ok: false,
			reply: `乐器名不能叫「鼓」——打击乐请用 percussion 参数。`
		};
		if (sk.tracks.length >= MAX_TRACKS) return {
			ok: false,
			reply: `音轨已经 ${MAX_TRACKS} 条（引擎上限），不能再加「${trackName}」。`
		};
		track = {
			name: trackName,
			wave,
			gain: .18
		};
		added = true;
	}
	const v = vetNotes(a.notes, sectionBeats);
	for (let n = 1; n <= sk.sections.length; n++) {
		if (n === section) continue;
		const other = cellOf(draft, n, trackName);
		if (other === void 0) continue;
		if (sameCell(v.notes, other.notes)) return {
			ok: false,
			reply: `${where} 已退回：与第 ${n} 段的「${trackName}」逐音完全一致（${v.notes.length} 个音全同）——这是把开头复读了一遍，不是新段落。
请重写这一格。${skeletonReminder(draft, section)}`
		};
	}
	if (added) sk.tracks.push(track);
	draft.clamps.push(...v.clamps);
	draft.dropped += v.dropped;
	draft.cells.set(cellKey(section, trackName), {
		notes: v.notes,
		drums: []
	});
	const bad = outOfKey(v.notes, sk.key, (b) => barOfIn(sk, s, b));
	const lines = [
		`${where} 已写入 ${v.notes.length} 个音（${range}）。`,
		skeletonReminder(draft, section),
		`体检：钳位 ${v.clamps.length} 项 · 不在调内 ${bad.length} 个 · 丢弃 ${v.dropped} 个`
	];
	if (bad.length > 0) lines.push(`调外音：${bad.map((b) => `${b.name} @ 第 ${b.bar} 小节`).join("、")}（若是有意的离调请忽略）`);
	if (v.clamps.length > 0) lines.push(`钳位明细：${v.clamps.slice(-3).join("；")}`);
	if (added) lines.push(`新增乐器：${trackName}(${track.wave}) —— 后面每一段都可以给它写内容。`);
	lines.push(progressLine(draft));
	return {
		ok: true,
		reply: lines.join("\n")
	};
}
function progressLine(draft) {
	const total = draft.skeleton.sections.length * columnsOf(draft).length;
	const done = total - missingCells(draft).length;
	const next = nextCellOf(draft);
	return `进度：${done}/${total} 格 · ` + (next === null ? "全部写齐，可以 score_export 交给卡片" : `下一步：第 ${next.section} 段的「${next.track}」`);
}
/**
* 把已写的格合成一份完整乐谱。
*
* `trim = true` 时只覆盖已写到的范围（`bars` 裁到那里、`sections` 同步裁剪）——
* 这样「只写齐第 1 段」导出的就是一张能听的样张卡，而不是三分钟的静音。
* 合成结果一律再过一次引擎的 `normalizeScore`：钳位口径与 `play_score` 同一个真源。
*/
function assemble(draft, opts) {
	const sk = draft.skeleton;
	beatsPerBarOf(sk);
	const tracks = [];
	const percussion = [];
	let writtenBars = 0;
	for (const t of sk.tracks) {
		const notes = [];
		for (let n = 1; n <= sk.sections.length; n++) {
			const cell = cellOf(draft, n, t.name);
			if (!written(cell)) continue;
			const s = sectionOf(draft, n);
			writtenBars = Math.max(writtenBars, s.toBar);
			for (const x of cell.notes) notes.push({
				...x,
				start: absolutize(sk, s, x.start)
			});
		}
		if (notes.length > 0) {
			notes.sort((a, b) => a.start - b.start);
			tracks.push({
				name: t.name,
				wave: t.wave,
				gain: t.gain,
				notes
			});
		}
	}
	for (let n = 1; n <= sk.sections.length; n++) {
		const cell = cellOf(draft, n, "鼓");
		if (!written(cell)) continue;
		const s = sectionOf(draft, n);
		writtenBars = Math.max(writtenBars, s.toBar);
		for (const d of cell.drums) percussion.push({
			...d,
			beat: absolutize(sk, s, d.beat)
		});
	}
	percussion.sort((a, b) => a.beat - b.beat);
	const bars = opts.trim ? Math.max(1, writtenBars) : sk.bars;
	const sections = opts.trim ? sk.sections.filter((s) => s.fromBar <= bars).map((s) => ({
		...s,
		toBar: Math.min(s.toBar, bars)
	})) : sk.sections.map((s) => ({ ...s }));
	const raw = {
		title: sk.title,
		mood: sk.mood,
		mode: "melody",
		meter: sk.meter,
		bpm: sk.bpm,
		bars,
		key: sk.key,
		chords: sk.chords,
		chordsEvery: sk.chordsEvery,
		tracks,
		percussion,
		sections
	};
	const { score, warn } = normalizeScore(raw, "melody", "pro", void 0, sk.groove);
	return {
		score,
		warn,
		missing: missingCells(draft),
		writtenBars
	};
}
/** 给 read 视图用的、不要 warn 的轻量合成。 */
function assembleNoWarn(draft) {
	return { score: assemble(draft, { trim: true }).score };
}
/** 导出时必须能渲染：至少一个可发声事件。 */
function exportable(a) {
	return countEvents(a.score) > 0;
}
/** 导出小结里那句「已写多少 / 时长多少」。 */
function exportHeadline(a, draft) {
	return `已写 ${a.writtenBars}/${draft.skeleton.bars} 小节 · ${countEvents(a.score)} 个音 · ${fmtDur(durationOf(a.score))} · ${draft.skeleton.key} 调 · ${draft.skeleton.meter} · ${draft.skeleton.bpm} BPM · 音色 ${usedTimbres(a.score).join("/") || "无"}`;
}
/** 导出小结里的体检总账。 */
function exportVerdict(a, draft) {
	const bad = outOfKeyAll(draft);
	const head = `体检总账：${bad.length === 0 ? "不在调内 0 个" : `不在调内 ${bad.length} 个（${bad.map((b) => `${b.name} @ 第 ${b.bar} 小节`).join("、")}）`} · 丢弃 ${draft.dropped} 个音 · 钳位 ${draft.clamps.length} 项`;
	return a.warn.length === 0 ? head : `${head}\n引擎钳位：${a.warn.join("；")}`;
}
//#endregion
export { DRUM_COLUMN, DRUM_KINDS, applyEdit, assemble, cellKey, columnsOf, createDraft, exportHeadline, exportVerdict, exportable, missingCells, nextCellOf, renderProgress, skeletonReminder, validateSkeleton };
