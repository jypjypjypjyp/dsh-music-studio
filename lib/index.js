import { countEvents, fmtDur, isRenderable, usedTimbres } from "./shared/score-info.js";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/engine.js
const NOTE_OFFSETS = {
	c: 0,
	d: 2,
	e: 4,
	f: 5,
	g: 7,
	a: 9,
	b: 11
};
const WAVES = [
	"sine",
	"triangle",
	"sawtooth",
	"square"
];
const PERC_KINDS = [
	"kick",
	"snare",
	"hat",
	"clap",
	"tom"
];
const FILTER_TYPES = [
	"lowpass",
	"highpass",
	"bandpass",
	"none"
];
const TIMBRES = {
	sine: {
		plain: true,
		label: "正弦"
	},
	triangle: {
		plain: true,
		label: "三角"
	},
	sawtooth: {
		plain: true,
		label: "锯齿"
	},
	square: {
		plain: true,
		label: "方波"
	},
	organ: {
		harm: [
			0,
			1,
			.55,
			.3,
			.4,
			.15,
			.2,
			.1,
			.25
		],
		fcut: 10,
		fq: .5,
		amp: [
			.012,
			.04,
			.92,
			.1
		],
		trim: 1,
		label: "管风琴",
		keyTrack: .55,
		body: [
			{
				f: 600,
				q: 3,
				gain: 3
			},
			{
				f: 1200,
				q: 2.5,
				gain: 2.5
			},
			{
				f: 2e3,
				q: 2,
				gain: 1.5
			}
		],
		use: "低音区管体共振加厚；中音区原样；高音区截止只按 55% 跟键，越高越稳不刺"
	},
	brass: {
		harm: [
			0,
			.85,
			.9,
			1,
			.85,
			.7,
			.55,
			.42,
			.3,
			.22,
			.15
		],
		fcut: 7,
		fq: 1,
		fenv: [
			12,
			3.5,
			.22
		],
		amp: [
			.05,
			.1,
			.72,
			.16
		],
		trim: 1,
		label: "铜管",
		keyTrack: .65,
		body: [
			{
				f: 1200,
				q: 8,
				gain: 3
			},
			{
				f: 2400,
				q: 11,
				gain: 3
			},
			{
				f: 3400,
				q: 12,
				gain: 2.5
			}
		],
		high: {
			lo: 220,
			hi: 523,
			harm: [
				0,
				.8,
				.85,
				1,
				.9,
				.8,
				.7,
				.6,
				.5,
				.4,
				.32,
				.26,
				.2
			],
			formants: [{
				f: 2500,
				q: 1.2,
				gain: 3
			}]
		},
		cutMax: 5e3,
		use: "低音区喇叭共振加厚；中音区原样；高音区换更亮的分音表（超吹），5kHz 上限兜底"
	},
	strings: {
		harm: [
			0,
			1,
			.68,
			.4,
			.22,
			.12,
			.07,
			.045,
			.03,
			.02,
			.013
		],
		fcut: 7.5,
		fq: .6,
		fenv: [
			2.5,
			7.5,
			.45
		],
		amp: [
			.38,
			.25,
			.85,
			.55
		],
		trim: 1,
		label: "弦乐",
		keyTrack: .6,
		body: [
			{
				f: 275,
				q: 24,
				gain: 5
			},
			{
				f: 550,
				q: 22,
				gain: 6
			},
			{
				f: 2350,
				q: 6,
				gain: 4.5
			},
			{
				f: 2750,
				q: 6,
				gain: 3.3
			}
		],
		use: "低音区 275/550/2350/2750Hz 琴体共鸣加厚；中音区原样；高音区跟键 60% → 越高越纯越暗"
	},
	pluck: {
		harm: [
			0,
			1,
			.62,
			.45,
			.34,
			.26,
			.2,
			.15,
			.11,
			.08,
			.06,
			.04,
			.03
		],
		fcut: 3,
		fq: 1.1,
		fenv: [
			16,
			2.5,
			.35
		],
		amp: [
			.004,
			.85,
			0,
			.2
		],
		trim: 1,
		label: "拨弦",
		keyTrack: .7,
		body: [
			{
				f: 100,
				q: 5.5,
				gain: 5
			},
			{
				f: 200,
				q: 7.3,
				gain: 3.5
			},
			{
				f: 400,
				q: 11,
				gain: 2.5
			},
			{
				f: 550,
				q: 12.5,
				gain: 1.8
			}
		],
		cutMax: 6e3,
		use: "低音区 100~550Hz 琴体共鸣加厚；中音区原样；高音区跟键 70%、6kHz 封顶"
	},
	marimba: {
		harm: [
			0,
			1,
			.08,
			.12,
			.45,
			.05,
			.08,
			.04
		],
		fcut: 6,
		fq: .8,
		fenv: [
			8,
			4,
			.3
		],
		amp: [
			.003,
			.55,
			0,
			.25
		],
		trim: 1,
		label: "马林巴",
		keyTrack: .6,
		body: [{
			f: 220,
			q: 8,
			gain: 5
		}, {
			f: 880,
			q: 16,
			gain: 1.3
		}],
		use: "低音区 220/880Hz 共鸣管位置加厚；中音区原样；高音区跟键 60%，低音木条更厚更响"
	},
	pad: {
		harm: [
			0,
			1,
			.42,
			.2,
			.11,
			.07,
			.05,
			.03,
			.02
		],
		fcut: 5,
		fq: .6,
		amp: [
			.62,
			.35,
			.9,
			.85
		],
		trim: 1,
		label: "铺垫",
		keyTrack: .5,
		body: [{
			f: 300,
			q: .9,
			gain: 3
		}, {
			f: 900,
			q: .8,
			gain: 2
		}],
		use: "低音区两个低 Q 宽峰垫厚；中音区原样；高音区跟键 50%，越高越暗越柔"
	},
	reed: {
		harm: [
			0,
			1,
			.12,
			.62,
			.08,
			.35,
			.05,
			.2,
			.03
		],
		fcut: 10,
		fq: .9,
		fenv: [
			8,
			10,
			.12
		],
		amp: [
			.035,
			.09,
			.82,
			.14
		],
		trim: 1,
		label: "簧管",
		keyTrack: .65,
		body: [{
			f: 1400,
			q: 4,
			gain: 4
		}, {
			f: 3e3,
			q: 4,
			gain: 3
		}],
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.3,
				.66,
				.17,
				.42,
				.11,
				.26,
				.07,
				.055,
				.042,
				.032,
				.025,
				.019
			]
		},
		high: {
			lo: 220,
			hi: 523,
			harm: [
				0,
				1,
				.3,
				.87,
				.2,
				.35,
				.13,
				.2,
				.08
			]
		},
		use: "低音区 1400/3000Hz 簧管共振；中音区原样；高音区超吹，偶次分音抬起来（转亮）"
	},
	bass: {
		harm: [
			0,
			1,
			.35,
			.16,
			.07
		],
		fcut: 4,
		fq: .7,
		fenv: [
			7,
			2.5,
			.18
		],
		amp: [
			.008,
			.5,
			.25,
			.12
		],
		trim: 1,
		label: "低音",
		keyTrack: .7,
		body: [
			{
				f: 100,
				q: 5.5,
				gain: 5.5
			},
			{
				f: 200,
				q: 7.3,
				gain: 4.5
			},
			{
				f: 400,
				q: 11,
				gain: 3.5
			},
			{
				f: 550,
				q: 12.5,
				gain: 2.5
			}
		],
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.52,
				.3,
				.17,
				.11,
				.07,
				.045
			]
		},
		use: "低音区 100~550Hz 箱体共鸣加厚、谱更厚；中音区原样；高音区跟键 70%，仍留着'弹'的轮廓"
	},
	bell: {
		harm: [
			0,
			1,
			.35,
			.2
		],
		fm: {
			ratio: 3,
			index: 1.1
		},
		fcut: 12,
		fq: .5,
		amp: [
			.002,
			2.4,
			0,
			1
		],
		trim: 1,
		label: "钟琴",
		keyTrack: .55,
		body: [
			{
				f: 500,
				q: 4,
				gain: 3.5
			},
			{
				f: 1200,
				q: 5,
				gain: 3.5
			},
			{
				f: 2400,
				q: 5,
				gain: 2
			}
		],
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.5,
				.34,
				.22,
				.13,
				.08,
				.05
			]
		},
		cutMax: 4500,
		use: "低音区钟体固定模态加厚；中音区原样；高音区跟键 55% + 4.5kHz 上限，越高越短越纯"
	},
	piano: {
		harm: [
			0,
			1,
			.62,
			.42,
			.3,
			.2,
			.14,
			.1,
			.07,
			.05,
			.035,
			.025
		],
		noise: {
			gain: .13,
			decay: .028,
			band: 3200
		},
		fcut: 9,
		fq: .7,
		fenv: [
			9,
			2.2,
			.55
		],
		amp: [
			.005,
			1.8,
			.15,
			.45
		],
		trim: 1,
		label: "钢琴",
		keyTrack: .65,
		body: [
			{
				f: 100,
				q: 5.5,
				gain: 4
			},
			{
				f: 200,
				q: 7.3,
				gain: 3
			},
			{
				f: 400,
				q: 11,
				gain: 2
			},
			{
				f: 550,
				q: 12.5,
				gain: 1.5
			}
		],
		use: "低音区音板低频模态加厚；中音区原样；高音区跟键 65%，越高越干净短促"
	},
	metal: {
		harm: [
			0,
			1,
			.5,
			.3
		],
		fm: {
			ratio: 8.2,
			index: 11
		},
		fcut: 18,
		fq: 3,
		fenv: [
			18,
			7,
			.07
		],
		amp: [
			.001,
			.3,
			0,
			.16
		],
		trim: 1,
		label: "金属",
		keyTrack: .7,
		body: [
			{
				f: 1200,
				q: 6,
				gain: 3
			},
			{
				f: 2400,
				q: 6,
				gain: 2.5
			},
			{
				f: 3400,
				q: 6,
				gain: 2
			}
		],
		cutMax: 8e3,
		use: "低音区金属体模态加厚；中音区原样；高音区跟键 70% + 8kHz 上限，保持'敲'不是'啸'"
	},
	lead: {
		harm: [
			0,
			1,
			.7,
			.5,
			.38,
			.3,
			.24,
			.19,
			.15,
			.12,
			.09
		],
		detune: 12,
		fcut: 7,
		fq: .7,
		amp: [
			.03,
			.12,
			.8,
			.2
		],
		trim: 1,
		label: "合成主奏",
		keyTrack: .6,
		body: [{
			f: 400,
			q: .9,
			gain: 2
		}, {
			f: 1400,
			q: .8,
			gain: 2
		}],
		high: {
			lo: 220,
			hi: 440,
			harm: [
				0,
				1,
				.85,
				.7,
				.6,
				.5,
				.42,
				.36,
				.3,
				.26,
				.22,
				.18
			]
		},
		use: "低音区两个宽峰垫厚；中音区原样；高音区换更平的分音表，保持主奏的穿透力"
	},
	choir: {
		harm: [
			0,
			1,
			.72,
			.45,
			.22,
			.12,
			.06
		],
		detune: 12,
		fcut: 6.5,
		fq: 1.8,
		cutFloor: 1300,
		keyTrack: .55,
		body: [
			{
				f: 700,
				q: 9.6,
				gain: 3
			},
			{
				f: 1080,
				q: 11.8,
				gain: 2.5
			},
			{
				f: 2650,
				q: 6,
				gain: 1.2
			},
			{
				f: 3500,
				q: 6,
				gain: 1
			}
		],
		use: "低音区 700/1080Hz 元音共振加厚（只往暗走）；中音区原样；高音区跟键 55% → 越高越柔",
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.72,
				.45,
				.22,
				.12,
				.06,
				.045,
				.034,
				.026,
				.02,
				.015,
				.011
			],
			formants: [{
				f: 730,
				q: 4,
				gain: 12
			}, {
				f: 1090,
				q: 5,
				gain: 9
			}]
		},
		breath: {
			gain: .15,
			onset: 3,
			band: 1300,
			q: .7
		},
		amp: [
			.35,
			.28,
			.85,
			.6
		],
		trim: 1,
		label: "人声",
		vib: {
			voices: [{
				rate: 5.6,
				cents: 32,
				phase: 0
			}, {
				rate: 6.2,
				cents: 26,
				phase: 2.7
			}],
			wobble: .22,
			wobbleRate: .63,
			jitter: 1.2,
			drift: 2.5,
			shimmer: {
				mid: .04,
				slow: .022,
				noiseOff: 3001
			},
			seed: 2024,
			noiseOff: 0
		}
	},
	flute: {
		harm: [
			0,
			1,
			.16,
			.07,
			.04,
			.02,
			.015,
			.01
		],
		noise: {
			gain: .9,
			decay: .45,
			band: 1800
		},
		fcut: 8,
		fq: .7,
		amp: [
			.09,
			.14,
			.82,
			.22
		],
		trim: 1,
		label: "长笛",
		keyTrack: .6,
		body: [{
			f: 800,
			q: 3,
			gain: 4
		}, {
			f: 1600,
			q: 2.5,
			gain: 3
		}],
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.26,
				.13,
				.085,
				.06,
				.045,
				.035,
				.028,
				.022,
				.018
			]
		},
		high: {
			lo: 220,
			hi: 587,
			harm: [
				0,
				1,
				.22,
				.12,
				.08,
				.055,
				.04,
				.03
			],
			formants: [{
				f: 2400,
				q: 1.2,
				gain: 2
			}]
		},
		use: "低音区 800/1600Hz 管体共振加厚；中音区原样；高音区更亮更气声（2400Hz 低 Q 峰）"
	},
	epiano: {
		harm: [
			0,
			1,
			.1,
			.04,
			0
		],
		fm: {
			ratio: 14,
			index: 1.8
		},
		fcut: 8,
		fq: .5,
		amp: [
			.004,
			1.35,
			0,
			.5
		],
		trim: 1,
		label: "电钢",
		use: "全音区：FM 敲击，余音清亮",
		keyTrack: .6,
		body: [{
			f: 190,
			q: 3,
			gain: 5
		}]
	},
	harpsichord: {
		harm: [
			0,
			1,
			.58,
			.4,
			.26,
			.18,
			.12,
			.08,
			.05,
			.03,
			.02
		],
		fcut: 4.5,
		fq: 1,
		fenv: [
			22,
			1.6,
			.3
		],
		amp: [
			.002,
			.95,
			0,
			.22
		],
		trim: 1,
		label: "羽管键琴",
		use: "全音区：拨键，亮起振暗余音",
		keyTrack: .7,
		body: [{
			f: 180,
			q: 2.5,
			gain: 5
		}, {
			f: 700,
			q: 2,
			gain: 4
		}],
		low: {
			hi: 220,
			lo: 110,
			harm: [
				0,
				1,
				.58,
				.4,
				.26,
				.18,
				.12,
				.08,
				.05,
				.03,
				.02
			]
		}
	},
	hammond: {
		harm: [
			0,
			1,
			.66,
			.86,
			.4,
			.5,
			.26,
			.4,
			.16,
			.24,
			.12,
			.16,
			.09,
			.12,
			.06
		],
		detune: -1200,
		fcut: 10,
		fq: .5,
		amp: [
			.012,
			.04,
			.92,
			.1
		],
		trim: 1,
		label: "爵士风琴",
		use: "全音区：音轮风琴，低音叠 16′",
		keyTrack: .6,
		body: [{
			f: 120,
			q: 1.5,
			gain: 4
		}, {
			f: 480,
			q: 1.5,
			gain: 3
		}],
		low: {
			hi: 220,
			lo: 150,
			harm: [
				0,
				1,
				.12,
				.66,
				.86,
				.4,
				.5,
				.26,
				.4,
				.16,
				.24,
				.12,
				.16,
				.09,
				.12,
				.06
			]
		}
	},
	clarinet: {
		harm: [
			0,
			1,
			.06,
			.72,
			.04,
			.4,
			.03,
			.22,
			.02,
			.12,
			.015
		],
		fcut: 9,
		fq: .8,
		formants: [{
			f: 1600,
			q: 2.5,
			gain: 5
		}, {
			f: 4e3,
			q: 2,
			gain: 3
		}],
		amp: [
			.05,
			.09,
			.84,
			.14
		],
		trim: 1,
		label: "单簧管",
		use: "中低音区：奇次谐波簧管",
		keyTrack: .65,
		body: [{
			f: 330,
			q: 3,
			gain: 6
		}],
		high: {
			lo: 660,
			hi: 1320,
			formants: [{
				f: 1700,
				q: 3,
				gain: 5
			}]
		}
	},
	oboe: {
		harm: [
			0,
			1,
			.5,
			.8,
			.22,
			.6,
			.13,
			.42,
			.08,
			.28,
			.05,
			.18,
			.035
		],
		fcut: 11,
		fq: .7,
		formants: [{
			f: 1400,
			q: 4.5,
			gain: 10
		}, {
			f: 3e3,
			q: 3.5,
			gain: 6
		}],
		amp: [
			.045,
			.08,
			.86,
			.12
		],
		trim: 1,
		label: "双簧管",
		use: "中高音区：鼻音，1400/3000Hz",
		keyTrack: .6,
		body: [{
			f: 600,
			q: 3,
			gain: 6
		}],
		low: {
			hi: 220,
			lo: 145,
			harm: [
				0,
				1,
				.5,
				.8,
				.22,
				.6,
				.13,
				.42,
				.08,
				.28,
				.05,
				.18,
				.035
			]
		},
		high: {
			lo: 660,
			hi: 1400,
			formants: [{
				f: 3e3,
				q: 4,
				gain: 5
			}]
		}
	},
	horn: {
		harm: [
			0,
			1,
			.82,
			.6,
			.42,
			.3,
			.22,
			.15,
			.1,
			.07,
			.05,
			.035
		],
		fcut: 4.5,
		fq: .8,
		fenv: [
			3.4,
			2.2,
			.3
		],
		amp: [
			.12,
			.16,
			.8,
			.3
		],
		trim: 1,
		label: "圆号",
		use: "全音区：软铜管，起振慢",
		keyTrack: .55,
		body: [{
			f: 450,
			q: 2.5,
			gain: 7
		}, {
			f: 900,
			q: 2,
			gain: 3
		}],
		low: {
			hi: 220,
			lo: 130,
			harm: [
				0,
				1,
				.88,
				.7,
				.5,
				.36,
				.26,
				.18,
				.12,
				.08
			]
		}
	},
	harp: {
		harm: [
			0,
			1,
			.68,
			.42,
			.3,
			.2,
			.14,
			.09,
			.06,
			.04,
			.025
		],
		fcut: 6,
		fq: .9,
		fenv: [
			9,
			3,
			.5
		],
		amp: [
			.003,
			1.2,
			0,
			.3
		],
		trim: 1,
		label: "竖琴",
		use: "全音区：软拨弦，余音 1.2s",
		keyTrack: .7,
		body: [
			{
				f: 100,
				q: 2,
				gain: 5
			},
			{
				f: 200,
				q: 2,
				gain: 6
			},
			{
				f: 400,
				q: 2,
				gain: 5
			},
			{
				f: 550,
				q: 2,
				gain: 4
			}
		],
		low: {
			hi: 220,
			lo: 110,
			harm: [
				0,
				1,
				.72,
				.5,
				.38,
				.28,
				.2,
				.14,
				.1,
				.07,
				.05,
				.035
			]
		}
	},
	xylophone: {
		harm: [
			0,
			1,
			.06,
			.25
		],
		fm: {
			ratio: 3,
			index: 4.5
		},
		fcut: 13,
		fq: .7,
		fenv: [
			13,
			6,
			.12
		],
		amp: [
			.002,
			.3,
			0,
			.12
		],
		trim: 1,
		label: "木琴",
		use: "高音区：硬木敲击，分音 1:3",
		keyTrack: .6,
		body: [{
			f: 220,
			q: 6,
			gain: 6
		}, {
			f: 880,
			q: 4,
			gain: 4
		}]
	},
	musicbox: {
		harm: [
			0,
			1,
			.12,
			.06
		],
		fm: {
			ratio: 9.5,
			index: 3.5
		},
		noise: {
			gain: .5,
			decay: .02,
			band: 5200
		},
		fcut: 14,
		fq: .6,
		amp: [
			.002,
			.6,
			0,
			.2
		],
		trim: 1,
		label: "八音盒",
		use: "高音区：FM 梳齿，带机械噪声",
		keyTrack: .6,
		body: [{
			f: 1400,
			q: 4,
			gain: 4
		}]
	},
	kalimba: {
		harm: [
			0,
			1,
			.2,
			.09,
			.04,
			.02
		],
		fcut: 3,
		fq: 1.4,
		fenv: [
			5,
			2.2,
			.3
		],
		amp: [
			.04,
			1,
			0,
			.25
		],
		trim: 1,
		label: "卡林巴",
		use: "全音区：拇指琴，只留基频",
		keyTrack: .7,
		body: [{
			f: 240,
			q: 4,
			gain: 5
		}],
		low: {
			hi: 220,
			lo: 130,
			harm: [
				0,
				1,
				.26,
				.13,
				.06,
				.03,
				.015
			]
		}
	},
	accordion: {
		harm: [
			0,
			1,
			.7,
			.5,
			.35,
			.24,
			.16,
			.11,
			.07,
			.05,
			.03
		],
		detune: 14,
		fcut: 8,
		fq: .7,
		fenv: [
			9,
			7,
			.11
		],
		amp: [
			.035,
			.1,
			.84,
			.16
		],
		trim: 1,
		label: "手风琴",
		use: "全音区：双簧 musette 拍频",
		keyTrack: .6,
		body: [{
			f: 600,
			q: 2,
			gain: 4
		}, {
			f: 1200,
			q: 2,
			gain: 3
		}],
		low: {
			hi: 220,
			lo: 150,
			harm: [
				0,
				1,
				.12,
				.7,
				.5,
				.35,
				.24,
				.16,
				.11,
				.07,
				.05,
				.03
			]
		}
	},
	shakuhachi: {
		harm: [
			0,
			1,
			.05,
			.03,
			.42,
			.02,
			.28,
			.01,
			.22,
			.01,
			.14,
			.01,
			.1
		],
		noise: {
			gain: 2,
			decay: .85,
			band: 1160
		},
		fcut: 4.5,
		fq: .6,
		formants: [
			{
				f: 800,
				q: 1.2,
				gain: 1
			},
			{
				f: 1400,
				q: 1.5,
				gain: 9
			},
			{
				f: 3e3,
				q: 1.5,
				gain: 7
			}
		],
		amp: [
			.1,
			.16,
			.8,
			.22
		],
		trim: 1,
		label: "尺八",
		use: "全音区：气声竹笛，起振 100ms",
		keyTrack: .6,
		body: [{
			f: 800,
			q: 1.5,
			gain: 5
		}],
		low: {
			hi: 220,
			lo: 130,
			harm: [
				0,
				1,
				.2,
				.1,
				.04
			]
		}
	},
	sitar: {
		harm: [
			0,
			1,
			.75,
			.55,
			.42,
			.3,
			.22,
			.2,
			.16,
			.14,
			.12,
			.1,
			.09,
			.08,
			.07
		],
		fcut: 9,
		fq: 1.2,
		fenv: [
			12,
			3,
			.45
		],
		formants: [
			{
				f: 500,
				q: 3,
				gain: 6
			},
			{
				f: 1200,
				q: 3,
				gain: 5
			},
			{
				f: 2350,
				q: 5,
				gain: 7
			},
			{
				f: 2750,
				q: 5,
				gain: 6
			}
		],
		amp: [
			.003,
			.9,
			.05,
			.3
		],
		trim: 1,
		label: "西塔琴",
		use: "全音区：拨弦+桥丘共振",
		keyTrack: .65,
		body: [{
			f: 500,
			q: 2.5,
			gain: 5
		}, {
			f: 2350,
			q: 4,
			gain: 5
		}],
		low: {
			hi: 220,
			lo: 110,
			harm: [
				0,
				1,
				.78,
				.6,
				.48,
				.36,
				.28,
				.24,
				.2,
				.17,
				.14,
				.12,
				.1,
				.09,
				.08
			]
		},
		high: {
			lo: 660,
			hi: 1400,
			harm: [
				0,
				1,
				.78,
				.58,
				.46,
				.34,
				.26,
				.22,
				.18,
				.15,
				.13,
				.11,
				.1,
				.09,
				.08
			],
			formants: [{
				f: 2750,
				q: 5,
				gain: 6
			}]
		}
	},
	acidbass: {
		harm: [
			0,
			1,
			.5,
			.33,
			.25,
			.2,
			.17,
			.14,
			.13,
			.11,
			.1,
			.09,
			.08
		],
		fcut: 5,
		fq: 8,
		fenv: [
			17,
			2.2,
			.4
		],
		amp: [
			.006,
			.55,
			.3,
			.14
		],
		trim: 1,
		label: "酸性贝斯",
		use: "低音区：锯齿，8µ 低通下扫",
		keyTrack: .6,
		body: [{
			f: 90,
			q: 3,
			gain: 5
		}, {
			f: 450,
			q: 3,
			gain: 4
		}],
		cutMax: 4200,
		low: {
			hi: 220,
			lo: 130,
			harm: [
				0,
				1,
				.5,
				.45,
				.35,
				.3,
				.25,
				.22,
				.2,
				.18,
				.16,
				.14
			]
		}
	}
};
const TIMBRE_TIERS = {
	basic: [
		"sine",
		"triangle",
		"sawtooth",
		"square"
	],
	enhanced: [
		"sine",
		"triangle",
		"sawtooth",
		"square",
		"organ",
		"brass",
		"strings",
		"pluck",
		"marimba",
		"pad",
		"reed",
		"bass",
		"bell",
		"piano",
		"metal",
		"lead",
		"choir",
		"flute"
	],
	pro: [
		"sine",
		"triangle",
		"sawtooth",
		"square",
		"organ",
		"brass",
		"strings",
		"pluck",
		"marimba",
		"pad",
		"reed",
		"bass",
		"bell",
		"piano",
		"metal",
		"lead",
		"choir",
		"flute",
		"epiano",
		"harpsichord",
		"hammond",
		"clarinet",
		"oboe",
		"horn",
		"harp",
		"xylophone",
		"musicbox",
		"kalimba",
		"accordion",
		"shakuhachi",
		"sitar",
		"acidbass"
	]
};
const TIMBRE_TIER_LABELS = {
	basic: "基础音色集",
	enhanced: "增强音色集",
	pro: "专业音色集"
};
/** 某个名字是否已知音色（跨所有档）。用于导入/校验时宽容处理。 */
function isKnownTimbre(name) {
	return Object.prototype.hasOwnProperty.call(TIMBRES, name);
}
/** 名字所属的最低档位（用于提示词里告诉模型这个音色哪档才有）。 */
function timbreTierOf(name) {
	if (TIMBRE_TIERS.basic.includes(name)) return "basic";
	if (TIMBRE_TIERS.enhanced.includes(name)) return "enhanced";
	if (TIMBRE_TIERS.pro.includes(name)) return "pro";
	return null;
}
const MAX_BARS = 240;
const MAX_TRACKS = 8;
const MAX_NOTES = 6e3;
const MAX_PERC = 1500;
const MAX_LAYERS = 16;
const MAX_SECTIONS = 24;
const TAIL_SLACK_BEATS = 1;
/**
* 时间轴的单位永远是「拍」＝ 60/bpm 秒；一小节 = 每小节拍数 × 60/bpm 秒。
* 所以每个拍号必须同时说明「这里的拍是哪种音符」，否则同一个 BPM 数字会差好几倍：
*   二连分的档，拍 = 四分音符（7/8 例外，拍 = 八分音符）；
*   三连分的档是复合拍：拍 = 附点四分（一个大拍 = 三个八分），故 6/8 一小节只有 2 拍。
* subdiv 只进提示词与记谱习惯，**不参与任何时长计算**。
*/
const METERS = {
	"4/4": {
		beats: 4,
		subdiv: 2,
		note: "quarter"
	},
	"3/4": {
		beats: 3,
		subdiv: 2,
		note: "quarter"
	},
	"2/4": {
		beats: 2,
		subdiv: 2,
		note: "quarter"
	},
	"5/4": {
		beats: 5,
		subdiv: 2,
		note: "quarter"
	},
	"7/8": {
		beats: 7,
		subdiv: 2,
		note: "eighth"
	},
	"6/8": {
		beats: 2,
		subdiv: 3,
		note: "dotted quarter"
	},
	"9/8": {
		beats: 3,
		subdiv: 3,
		note: "dotted quarter"
	},
	"12/8": {
		beats: 4,
		subdiv: 3,
		note: "dotted quarter"
	}
};
/**
* 律动。swing 是纯时间映射：后半拍的落点 = span × r/(1+r) 拍（r 是「长:短」比例）；
* halftime 不是时间映射，而是把军鼓/拍手并到小节内第 3 拍（重音减半）；
* genre 只在提示词里要求模型写曲风标志性鼓型，引擎不动。
*/
const GROOVES = {
	straight: {},
	swing8_2: { swing: {
		span: 1,
		ratio: 2
	} },
	swing8_3: { swing: {
		span: 1,
		ratio: 3
	} },
	swing16_12: { swing: {
		span: .5,
		ratio: 1.2
	} },
	swing16_15: { swing: {
		span: .5,
		ratio: 1.5
	} },
	halftime: { halftime: true },
	genre: { genre: true }
};
const DEFAULT_GROOVE = "straight";
/** 乐谱的拍号。老乐谱、导入的乐谱没有这个字段时按 4/4（改动前的行为）。 */
function meterOf(s) {
	return s && METERS[s.meter] ? s.meter : "4/4";
}
/** 一小节几拍。全文件只从这里读这个数，不再有写死的 4。 */
function beatsOf(s) {
	return METERS[meterOf(s)].beats;
}
/** 小节数上限。上限的本意是「总拍数」（时长、内存与卷帘图可读性），所以按拍号折算，
并且**向上取整**保证至少 960 拍（7/8 用 round 会得到 137×7=959 拍，5 分钟 + 快速度时被早夹一格）：
4/4 → 240 小节；2/4 → 480；7/8 → 138。不折算的话 2/4 走 132 BPM 的 5 分钟曲需要 330 小节，
会被 240 的旧上限截断成 3 秒的残曲。 */
function maxBarsOf(beatsPerBar) {
	return Math.ceil(960 / beatsPerBar);
}
/** 这个拍号下摇摆是否不生效：复合拍每拍三连分，摇摆要找的「后半拍」位本来是空的。
applyGroove 的静默、提示词里那句「写直的细分」是否下发、以及长篇的警告都以此为准。 */
function meterBlocksSwing(meter, groove) {
	return !!(GROOVES[groove] && GROOVES[groove].swing && METERS[meter] && METERS[meter].subdiv === 3);
}
/**
* 把律动套到谱面上。只作用于旋律模式。
* 摇摆：只把「后半拍」上的起点往后挪 span×r/(1+r) —— 挪过之后不再满足后半拍条件，故**幂等**；
*       正拍不动；音轨与打击乐都套。
* 半速感：军鼓/拍手每小节只留一次、落小节内第 3 拍（小节不足 3 拍时落最后一拍），同小节取最大力度；
*         底鼓与踩镲不动，trap 的 16 分踩镲因此保留。
*/
function applyGroove(score, groove) {
	const g = GROOVES[groove] || {};
	if (!score || score.mode !== "melody") return score;
	if (meterBlocksSwing(meterOf(score), groove)) return score;
	if (g.swing) {
		const span = g.swing.span, off = span * g.swing.ratio / (1 + g.swing.ratio);
		const move = (b) => {
			const local = b - Math.floor(b / span) * span;
			return Math.abs(local - span / 2) < 1e-6 ? b - span / 2 + off : b;
		};
		for (const t of score.tracks) {
			for (const n of t.notes) n.start = move(n.start);
			t.notes.sort((a, b) => a.start - b.start);
		}
		for (const p of score.percussion) p.beat = move(p.beat);
		score.percussion.sort((a, b) => a.beat - b.beat);
	}
	if (g.halftime) {
		const bpb = beatsOf(score), kept = [], done = {};
		const end = score.bars * bpb;
		for (const p of score.percussion) {
			if (p.kind !== "snare" && p.kind !== "clap") {
				kept.push(p);
				continue;
			}
			if (p.beat >= end) {
				kept.push(p);
				continue;
			}
			const bar = Math.floor(p.beat / bpb);
			if (done[bar]) {
				done[bar].vel = Math.max(done[bar].vel, p.vel);
				if (done[bar].kind === "clap" && p.kind === "snare") done[bar].kind = "snare";
				continue;
			}
			done[bar] = {
				kind: p.kind,
				beat: bar * bpb + Math.min(2, bpb - 1),
				vel: p.vel
			};
			kept.push(done[bar]);
		}
		kept.sort((a, b) => a.beat - b.beat);
		score.percussion = kept;
	}
	return score;
}
function clamp(v, a, b) {
	return v < a ? a : v > b ? b : v;
}
function numOr(v, d) {
	const x = typeof v === "string" ? parseFloat(v) : v;
	return typeof x === "number" && isFinite(x) ? x : d;
}
function pitchToMidi(p) {
	if (typeof p === "number" && isFinite(p)) return Math.round(p);
	if (typeof p !== "string") return null;
	const m = p.trim().match(/^([A-Ga-g])\s*([#b♯♭]?)\s*(-?\d{1,2})$/);
	if (!m) return null;
	let acc = 0;
	if (m[2] === "#" || m[2] === "♯") acc = 1;
	else if (m[2] === "b" || m[2] === "♭") acc = -1;
	return (parseInt(m[3], 10) + 1) * 12 + NOTE_OFFSETS[m[1].toLowerCase()] + acc;
}
/**
* 把模型返回的任意结构整形成可信的乐谱。模型会犯错：缺字段、超范围、
* 字符串数字、音名写成 MIDI 号。这里全部收敛到合法区间，并记录警告。
*/
function normalizeScore(raw, forcedMode, tier, forcedMeter, groove) {
	const warn = [];
	if (!raw || typeof raw !== "object") return {
		score: null,
		warn: ["模型未返回可解析的对象"]
	};
	const mode = forcedMode || (raw.mode === "sfx" || Array.isArray(raw.layers) ? "sfx" : "melody");
	const rawMeter = typeof raw.meter === "string" ? raw.meter : "";
	const meter = METERS[forcedMeter] ? forcedMeter : METERS[rawMeter] ? rawMeter : "4/4";
	const bpb = METERS[meter].beats;
	const score = {
		title: typeof raw.title === "string" ? raw.title.trim().slice(0, 28) : "",
		mood: typeof raw.mood === "string" ? raw.mood.trim().slice(0, 48) : "",
		mode,
		bpm: Math.round(clamp(numOr(raw.bpm, 84), 40, 200)),
		bars: Math.round(clamp(numOr(raw.bars, 4), 1, maxBarsOf(bpb))),
		meter,
		tracks: [],
		percussion: [],
		layers: [],
		sections: [],
		fx: { reverb: clamp(numOr(raw.fx && raw.fx.reverb, mode === "sfx" ? .46 : .34), 0, .9) }
	};
	if (Array.isArray(raw.sections)) {
		for (const rs of raw.sections.slice(0, MAX_SECTIONS)) {
			if (!rs || typeof rs !== "object") continue;
			const from = Math.round(numOr(rs.fromBar, null) || 0);
			const to = Math.round(numOr(rs.toBar, null) || 0);
			if (from < 1 || to < from) continue;
			score.sections.push({
				label: (typeof rs.label === "string" ? rs.label : "").trim().slice(0, 6) || "·",
				role: (typeof rs.role === "string" ? rs.role : "").trim().slice(0, 14),
				fromBar: clamp(from, 1, MAX_BARS),
				toBar: clamp(to, from, MAX_BARS)
			});
		}
		score.sections.sort((a, b) => a.fromBar - b.fromBar);
	}
	if (mode === "melody") {
		const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
		if (!rawTracks.length) warn.push("模型没有给出任何音轨");
		let total = 0;
		for (const rt of rawTracks.slice(0, MAX_TRACKS)) {
			if (!rt || typeof rt !== "object") continue;
			let wave = typeof rt.wave === "string" ? rt.wave.toLowerCase().trim() : "";
			if (!isKnownTimbre(wave)) {
				if (wave) warn.push("音色 " + wave + " 不在音色库里，改用 triangle");
				wave = "triangle";
			} else if (tier && !(TIMBRE_TIERS[tier] || []).includes(wave)) warn.push("音色 " + wave + " 属于「" + TIMBRE_TIER_LABELS[timbreTierOf(wave)] + "」，超出本次所选档位，仍按原音色发声");
			const track = {
				name: typeof rt.name === "string" && rt.name.trim() ? rt.name.trim().slice(0, 16) : "track",
				wave,
				gain: clamp(numOr(rt.gain, .18), .01, .6),
				notes: []
			};
			const rawNotes = Array.isArray(rt.notes) ? rt.notes : [];
			let capped = false;
			for (const rn of rawNotes) {
				let pitch, start, dur, vel;
				if (Array.isArray(rn)) {
					pitch = rn[0];
					start = rn[1];
					dur = rn[2];
					vel = rn[3];
				} else if (rn && typeof rn === "object") {
					pitch = rn.pitch !== void 0 ? rn.pitch : rn.note !== void 0 ? rn.note : rn.midi;
					start = rn.start !== void 0 ? rn.start : rn.startBeat;
					dur = rn.dur !== void 0 ? rn.dur : rn.durBeats !== void 0 ? rn.durBeats : rn.duration;
					vel = rn.vel !== void 0 ? rn.vel : rn.velocity;
				} else continue;
				let midi = pitchToMidi(pitch);
				if (midi === null) continue;
				if (midi < 24 || midi > 100) midi = clamp(midi, 24, 100);
				const s = numOr(start, null);
				const d = numOr(dur, null);
				if (s === null || d === null || d <= 0) continue;
				if (total >= MAX_NOTES) {
					capped = true;
					break;
				}
				track.notes.push({
					midi,
					start: clamp(s, 0, score.bars * bpb),
					dur: clamp(d, .05, 16),
					vel: clamp(numOr(vel, .75), .05, 1)
				});
				total++;
			}
			track.notes.sort((a, b) => a.start - b.start);
			if (track.notes.length) score.tracks.push(track);
			if (capped) {
				warn.push("音符达到 6000 上限，已截断（可用「修订」补写后段）");
				break;
			}
		}
		for (const rp of (Array.isArray(raw.percussion) ? raw.percussion : []).slice(0, MAX_PERC)) {
			let kind, beat, vel;
			if (Array.isArray(rp)) {
				kind = rp[0];
				beat = rp[1];
				vel = rp[2];
			} else if (rp && typeof rp === "object") {
				kind = rp.kind || rp.type;
				beat = rp.beat !== void 0 ? rp.beat : rp.start;
				vel = rp.vel !== void 0 ? rp.vel : rp.velocity;
			} else continue;
			kind = typeof kind === "string" ? kind.toLowerCase().trim() : "";
			if (!PERC_KINDS.includes(kind)) continue;
			const b = numOr(beat, null);
			if (b === null) continue;
			score.percussion.push({
				kind,
				beat: clamp(b, 0, score.bars * bpb),
				vel: clamp(numOr(vel, .7), .05, 1)
			});
		}
		score.percussion.sort((a, b) => a.beat - b.beat);
		let maxBeat = score.bars * bpb;
		for (const t of score.tracks) for (const n of t.notes) maxBeat = Math.max(maxBeat, n.start + n.dur);
		for (const p of score.percussion) maxBeat = Math.max(maxBeat, p.beat + .5);
		const needed = Math.ceil((maxBeat - TAIL_SLACK_BEATS) / bpb);
		if (needed > score.bars) score.bars = clamp(needed, 1, maxBarsOf(bpb));
		if (!score.tracks.length && !score.percussion.length) warn.push("整顿后没有任何可发声内容");
	} else {
		const rawLayers = Array.isArray(raw.layers) ? raw.layers : Array.isArray(raw.tracks) ? raw.tracks : [];
		if (!rawLayers.length) warn.push("模型没有给出任何音层");
		for (const rl of rawLayers.slice(0, MAX_LAYERS)) {
			if (!rl || typeof rl !== "object") continue;
			const src = rl.src === "tone" || rl.wave ? "tone" : "noise";
			let wave = typeof rl.wave === "string" ? rl.wave.toLowerCase().trim() : "sine";
			if (!WAVES.includes(wave)) wave = "sine";
			let type = typeof rl.type === "string" ? rl.type.toLowerCase().trim() : src === "noise" ? "bandpass" : "none";
			if (!FILTER_TYPES.includes(type)) type = src === "noise" ? "bandpass" : "none";
			const layer = {
				src,
				wave,
				type,
				f0: clamp(numOr(rl.f0 !== void 0 ? rl.f0 : rl.freq, src === "noise" ? 900 : 220), 20, 18e3),
				f1: clamp(numOr(rl.f1 !== void 0 ? rl.f1 : rl.sweepTo, 0), 0, 18e3),
				q: clamp(numOr(rl.q, src === "noise" ? 1.2 : .7), .1, 24),
				start: clamp(numOr(rl.start, 0), 0, 60),
				dur: clamp(numOr(rl.dur !== void 0 ? rl.dur : rl.duration, 1), .05, 30),
				attack: clamp(numOr(rl.attack, .02), .001, 8),
				decay: clamp(numOr(rl.decay, .3), .01, 12),
				gain: clamp(numOr(rl.gain, .4), .01, 1),
				pan: clamp(numOr(rl.pan, 0), -1, 1)
			};
			if (layer.f1 <= 0) layer.f1 = layer.f0;
			score.layers.push(layer);
		}
		let end = 1;
		for (const L of score.layers) end = Math.max(end, L.start + L.dur + L.decay);
		score.bars = Math.max(1, Math.min(maxBarsOf(bpb), Math.ceil(end * score.bpm / (60 * bpb))));
		if (!score.layers.length) warn.push("整顿后没有任何可发声内容");
	}
	applyGroove(score, groove);
	score.groove = GROOVES[groove] ? groove : DEFAULT_GROOVE;
	return {
		score,
		warn
	};
}
function durationOf(score) {
	if (!score) return 0;
	const beatSec = 60 / score.bpm;
	if (score.mode === "sfx") {
		let end = 0;
		for (const L of score.layers) end = Math.max(end, L.start + L.dur + L.decay);
		return Math.max(.5, end);
	}
	let maxBeat = score.bars * beatsOf(score);
	for (const t of score.tracks) for (const n of t.notes) maxBeat = Math.max(maxBeat, n.start + n.dur);
	return maxBeat * beatSec;
}
/** mulberry32：固定种子 PRNG（确定性、与调用顺序无关）。 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function() {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
(function() {
	const r = mulberry32(20240101), a = /* @__PURE__ */ new Float32Array(8192);
	for (let i = 0; i < a.length; i++) a[i] = r() * 2 - 1;
	return a;
})();
1 / Math.sqrt(3) / Math.sqrt(3);
//#endregion
//#region src/tool.ts
/** 宿主半一律按专业档校验：接受音色库全集，不因档位口径丢数据。 */
const TIER = "pro";
const PARAMETERS = {
	type: "object",
	properties: { score: {
		type: "object",
		description: [
			"完整乐谱 JSON（格式与规则见 music-studio skill）。传 JSON 对象，不要传字符串。",
			"旋律：{title, mood, mode:\"melody\", meter, bpm, bars, tracks:[{name, wave, gain, notes:[[pitch, startBeat, durBeats, velocity]]}], percussion:[[kind, beat, velocity]], fx:{reverb}}。",
			"音效：{title, mood, mode:\"sfx\", bpm, layers:[{src, wave, type, f0, f1, q, start, dur, attack, decay, gain, pan}]}。"
		].join(" ")
	} },
	required: ["score"],
	additionalProperties: false
};
const OUTPUT_SCHEMA = {
	type: "string",
	description: "一行中文小结：曲名 / 小节 / 音符数 / 时长 / 用到的音色 / 被钳位的项。"
};
/** 从原始调用参数里取乐谱；重放旧日志时参数可能不完整，所以防御式读。 */
function scoreOf(args) {
	if (args === null || typeof args !== "object") return null;
	return args.score ?? null;
}
/** 卡片标题：能读出曲名就用曲名。纯函数（presenter 会在重放时被调用）。 */
function cardTitle(args) {
	const raw = scoreOf(args);
	if (raw !== null && typeof raw === "object") {
		const title = raw.title;
		if (typeof title === "string" && title.trim()) return `演奏《${title.trim()}》`;
	}
	return "演奏";
}
/** 校验一遍并给出结论，execute 与 presentationMeta 共用同一条判据。 */
function vet(args) {
	const { score, warn } = normalizeScore(scoreOf(args), void 0, TIER, void 0, void 0);
	if (!isRenderable(score)) return {
		score: null,
		warn
	};
	return {
		score,
		warn
	};
}
function createPlayScoreTool() {
	return {
		name: "play_score",
		description: "把一份乐谱 JSON 交给对话里的内联播放卡片：校验并规范化后，用户会看到乐谱卷帘图和播放条，可以试听、导出 WAV 与乐谱 JSON。写谱的格式与创作规则见 music-studio skill。返回的一行小结会说清这张谱的规模，以及有哪些越界项被自动钳位——小结里有钳位提示，说明原谱有不合法处。乐谱不可用时会退回可读原因，请改好再交一次。",
		parameters: PARAMETERS,
		output: {
			schema: OUTPUT_SCHEMA,
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			},
			presentationMeta(args) {
				const { score, warn } = vet(args);
				if (score === null) return null;
				return {
					score,
					warn
				};
			}
		},
		async execute(args, _exec) {
			const { score, warn } = vet(args);
			if (score === null) return `play_score：乐谱不可用 —— ${warn.length > 0 ? warn.join("；") : "没有任何可发声内容"}。请修正结构后重新调用（格式见 music-studio skill）。`;
			const events = countEvents(score);
			const tail = warn.length === 0 ? "没有越界项。" : `自动钳位/纠正了：${warn.join("；")}。`;
			return `已交给播放卡片：《${score.title || "无题"}》 · ${score.bars} 小节 · ${events} 个音 · ${fmtDur(durationOf(score))} · ${score.bpm} BPM · 音色 ${usedTimbres(score).join("/") || "无"}。${tail}`;
		},
		presentCall(args) {
			return {
				card: "generic",
				title: cardTitle(args),
				kind: "other"
			};
		},
		presentResult(args) {
			return {
				card: "generic",
				title: cardTitle(args)
			};
		}
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-music-studio";
const inject = ["systemPrompt"];
const SKILL_NAME = "music-studio";
const SKILL_DESCRIPTION = "弦外作曲规范：乐谱 JSON 结构、32 种音色、拍号与律动规则，用于把音乐交给 play_score 卡片。";
/** 常驻提示词段：只放必须一直在场的契约。 */
const XIANWAI_SECTION_TEXT = `用户想听音乐、音效，或要改一支曲子时，你用 play_score 工具把乐谱交给对话里的播放卡片。

- 先按 music-studio skill 写出完整乐谱 JSON，再调 play_score({ score: {...} })——参数是 JSON 对象，不是字符串。
- 卡片负责呈现与播放（卷帘图 + 播放条 + 导出），不负责作曲：作曲是你的活。
- 工具返回的一行小结里若有「自动钳位」提示，说明原谱有不合法处；乐谱不可用时会退回可读原因，改好再交一次。
- 用户提修改意见时，重写整张谱再交一次；不留旧版。`;
function bundledSkillProvider() {
	const here = dirname(fileURLToPath(import.meta.url));
	const path = basename(here) === "plugin" ? resolve(here, "../../SKILL.md") : resolve(here, "../SKILL.md");
	const raw = readFileSync(path, "utf8");
	const end = raw.indexOf("\n---\n", 4);
	if (!raw.startsWith("---\n") || end < 0) throw new Error("music-studio SKILL.md 的 frontmatter 格式不对");
	const meta = {
		name: SKILL_NAME,
		description: SKILL_DESCRIPTION,
		invocation: {
			modelInvocable: true,
			userInvocable: true
		},
		source: "bundled",
		provider: "dsh-music-studio",
		path,
		resourceBase: {
			kind: "directory",
			path: dirname(path)
		},
		rank: 600,
		locator: path
	};
	return {
		name: "dsh-music-studio",
		list: () => Promise.resolve([meta]),
		get: () => Promise.resolve({
			...meta,
			content: raw.slice(end + 5)
		})
	};
}
function apply(ctx) {
	ctx.systemPrompt.section({
		name: "music-studio:score",
		order: ctx.systemPrompt.getSectionOrder("STRUCTURED_OUTPUT"),
		text: XIANWAI_SECTION_TEXT
	});
	ctx.inject(["tools"], (toolsCtx) => {
		toolsCtx.effect(function* () {
			yield toolsCtx.tools.register(createPlayScoreTool());
		}, "music-studio: play_score 工具");
	});
	ctx.inject(["skills"], (skillCtx) => {
		skillCtx.skills.registerProvider(() => bundledSkillProvider());
	});
}
//#endregion
export { XIANWAI_SECTION_TEXT, apply, inject, name };
