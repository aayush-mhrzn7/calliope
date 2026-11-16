/**
 * Dot-matrix charts: every mark sits on a fixed grid of small round dots. The top dot of each
 * column is the line; dots under it alternate in a checkerboard (60% / 22%) instead of a
 * gradient fill, over a faint lattice that keeps empty space reading as a grid.
 * Everything is drawn in one canvas pass.
 */

export const DM = {
	green: '#3fb950',
	red: '#f0605a',
	gray: '#8a8a8a',
	dim: 'rgba(255,255,255,0.45)',
	faint: 'rgba(255,255,255,0.2)',
	font: '9px "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace'
} as const;

export interface DotSeries {
	color: string;
	values: number[];
}

export interface DotAreaOptions {
	series: DotSeries[];
	/** Labels spread under the plot: first anchored left, last right */
	xLabels: string[];
	/** Peak value as text, e.g. "4.2 MB/s" */
	formatPeak?: (v: number) => string;
	/** Smallest peak the y-axis scales to, so near-zero noise doesn't fill the chart */
	minPeak?: number;
	step?: number;
	radius?: number;
	/** Resample + smooth to one value per column (continuous data). Off draws bars per value. */
	smooth?: boolean;
}

/** Sizes the canvas for the device pixel ratio and returns a context in CSS pixels. */
export function prepare(canvas: HTMLCanvasElement) {
	const dpr = window.devicePixelRatio || 1;
	const { width: W, height: H } = canvas.getBoundingClientRect();
	canvas.width = Math.round(W * dpr);
	canvas.height = Math.round(H * dpr);
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, W, H);
	return { ctx, W, H };
}

export function drawDotArea(canvas: HTMLCanvasElement, o: DotAreaOptions) {
	const { ctx, W, H } = prepare(canvas);
	const step = o.step ?? 4;
	const radius = o.radius ?? 1.1;
	const fmt = o.formatPeak ?? compact;

	ctx.font = DM.font;
	const axisW = Math.ceil(
		Math.max(ctx.measureText(fmt(o.minPeak ?? 1)).width, ctx.measureText('000.0 MB/s').width) + 8
	);
	const axisH = 14;
	const plot = { x: axisW, y: 4, w: W - axisW, h: H - axisH - 4 };
	const cols = Math.floor(plot.w / step);
	const rows = Math.floor(plot.h / step);
	if (cols < 2 || rows < 2) return;

	const data = o.series.map((s) =>
		o.smooth === false ? spread(s.values, cols) : smoothen(resample(s.values, cols))
	);
	const rawPeak = Math.max(0, ...data.flat());
	const peak = Math.max(o.minPeak ?? 1, rawPeak);

	const dot = (c: number, r: number, color: string, alpha: number) => {
		ctx.globalAlpha = alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(
			plot.x + c * step + step / 2,
			plot.y + plot.h - r * step - step / 2,
			radius,
			0,
			Math.PI * 2
		);
		ctx.fill();
	};

	// Lattice and half/full gridlines
	for (let c = 0; c < cols; c++)
		for (let r = 0; r < rows; r++) if ((c + r) % 3 === 0) dot(c, r, '#fff', 0.05);
	for (const frac of [0.5, 1]) {
		const r = Math.floor((rows - 1) * frac);
		for (let c = 0; c < cols; c += 2) dot(c, r, '#fff', 0.12);
	}

	// Larger series first so the smaller stays visible on top
	const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
	[...data.keys()]
		.sort((a, b) => sum(data[b]) - sum(data[a]))
		.forEach((i) => {
			for (let c = 0; c < cols; c++) {
				const v = data[i][c];
				if (v <= 0) continue;
				const h = Math.max(1, Math.round((v / peak) * (rows - 1)));
				for (let r = 0; r < h; r++)
					dot(c, r, o.series[i].color, r === h - 1 ? 1 : (c + r) % 2 === 0 ? 0.6 : 0.22);
			}
		});

	// Quiet axes
	ctx.globalAlpha = 1;
	ctx.fillStyle = DM.dim;
	ctx.textAlign = 'right';
	ctx.textBaseline = 'top';
	ctx.fillText(rawPeak > 0 ? fmt(peak) : '—', axisW - 6, plot.y);
	ctx.textBaseline = 'bottom';
	ctx.fillText('0', axisW - 6, plot.y + plot.h);
	ctx.textBaseline = 'top';
	const n = o.xLabels.length;
	o.xLabels.forEach((label, k) => {
		const f = n === 1 ? 0 : k / (n - 1);
		ctx.textAlign = k === 0 ? 'left' : k === n - 1 ? 'right' : 'center';
		ctx.fillText(label, plot.x + plot.w * f, plot.y + plot.h + 3);
	});
}

export interface HeatmapOptions {
	/** One count per day, oldest first, ending today */
	days: number[];
	/** Date of the last entry */
	end: Date;
	color?: string;
}

const HEAT_LEFT = 26;
const HEAT_TOP = 14;

/**
 * Cell size that makes the year grid fill `width`, and the height that grid then needs. Cells
 * widen with the panel but stop growing taller at `maxRow`, so a wide panel stays compact.
 */
export function heatmapLayout(width: number, days: number, end: Date, maxRow = 14) {
	const weeks = Math.ceil((days + end.getDay() + 1) / 7);
	const pitchX = Math.max(6, Math.min(40, Math.floor((width - HEAT_LEFT) / weeks)));
	const pitchY = Math.min(pitchX, maxRow);
	const gap = pitchY >= 12 ? 3 : 2;
	return {
		weeks,
		pitchX,
		pitchY,
		cellW: pitchX - gap,
		cellH: pitchY - gap,
		height: HEAT_TOP + 7 * pitchY
	};
}

/** GitHub-style year grid: 7 rows (Sun–Sat), one column per week, 5 shades. */
export function drawHeatmap(canvas: HTMLCanvasElement, o: HeatmapOptions) {
	const { ctx, W } = prepare(canvas);
	const fit = heatmapLayout(W, o.days.length, o.end);
	const left = HEAT_LEFT;
	const top = HEAT_TOP;
	const weeks = fit.weeks;
	const { pitchX, pitchY, cellW, cellH } = fit;
	const color = o.color ?? DM.green;
	const max = Math.max(1, ...o.days);
	// Quartile steps on the busiest day, like GitHub
	const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
	const alpha = [0.07, 0.35, 0.55, 0.78, 1];

	// Column of the last day is the final week; walk back from there
	const lastCol = weeks - 1;
	const lastRow = o.end.getDay();
	ctx.font = DM.font;
	ctx.textBaseline = 'top';
	let prevMonth = -1;
	let lastLabelX = -Infinity;
	for (let i = 0; i < o.days.length; i++) {
		const back = o.days.length - 1 - i;
		const slot = lastCol * 7 + lastRow - back;
		const col = Math.floor(slot / 7);
		const row = slot % 7;
		if (col < 0) continue;
		const x = left + col * pitchX;
		const y = top + row * pitchY;
		const lv = level(o.days[i]);
		ctx.globalAlpha = 1;
		ctx.fillStyle = lv === 0 ? `rgba(255,255,255,${alpha[0]})` : color;
		if (lv > 0) ctx.globalAlpha = alpha[lv];
		roundRect(ctx, x, y, cellW, cellH, Math.min(1.5, cellH / 4));
		// Month label above the first week that starts in a new month
		const d = new Date(o.end);
		d.setDate(d.getDate() - back);
		if (row === 0 && d.getMonth() !== prevMonth) {
			prevMonth = d.getMonth();
			// Skip a label that would crowd the previous one or run off the edge
			if (x - lastLabelX >= 28 && x + 24 <= W) {
				lastLabelX = x;
				ctx.globalAlpha = 1;
				ctx.fillStyle = DM.dim;
				ctx.textAlign = 'left';
				ctx.fillText(d.toLocaleDateString('en-US', { month: 'short' }), x, 0);
			}
		}
	}
	ctx.globalAlpha = 1;
	ctx.fillStyle = DM.dim;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	for (const [row, label] of [
		[1, 'Mon'],
		[3, 'Wed'],
		[5, 'Fri']
	] as const)
		ctx.fillText(label, 0, top + row * pitchY + cellH / 2);
	return top + 7 * pitchY;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
	ctx.fill();
}

/** Linear interpolation to exactly n samples. */
export function resample(v: number[], n: number): number[] {
	if (v.length < 2) return Array(n).fill(v[0] ?? 0);
	return Array.from({ length: n }, (_, i) => {
		const p = (i / (n - 1)) * (v.length - 1);
		const lo = Math.floor(p);
		const hi = Math.min(v.length - 1, lo + 1);
		const t = p - lo;
		return v[lo] * (1 - t) + v[hi] * t;
	});
}

/** Each value held across its share of the columns: crisp per-day bars, no interpolation. */
export function spread(v: number[], n: number): number[] {
	if (!v.length) return Array(n).fill(0);
	return Array.from(
		{ length: n },
		(_, i) => v[Math.min(v.length - 1, Math.floor((i / n) * v.length))]
	);
}

/** Centered moving average (radius 2) so the silhouette steps instead of spiking. */
export function smoothen(v: number[], rad = 2): number[] {
	if (v.length < 3) return v;
	return v.map((_, i) => {
		const lo = Math.max(0, i - rad);
		const hi = Math.min(v.length - 1, i + rad);
		let s = 0;
		for (let j = lo; j <= hi; j++) s += v[j];
		return s / (hi - lo + 1);
	});
}

export function compact(v: number): string {
	const a = Math.abs(v);
	return a >= 1e9
		? (v / 1e9).toFixed(1) + 'B'
		: a >= 1e6
			? (v / 1e6).toFixed(1) + 'M'
			: a >= 1e3
				? (v / 1e3).toFixed(1) + 'K'
				: String(Math.round(v));
}

const BLOCKS = ' ▁▂▃▄▅▆▇█';

/** One block character per slot, scaled to the busiest slot; empty slots are a faint ▁. */
export function blockStrip(values: number[]): { char: string; empty: boolean }[] {
	const max = Math.max(0, ...values);
	return values.map((v) => {
		if (v <= 0 || max <= 0) return { char: '▁', empty: true };
		const i = Math.max(1, Math.round((v / max) * (BLOCKS.length - 1)));
		return { char: BLOCKS[i], empty: false };
	});
}

/** "██████░░░░" at a fixed width. */
export function meter(value: number, max: number, width = 20) {
	const filled = max > 0 ? Math.round((Math.min(value, max) / max) * width) : 0;
	return { filled: '█'.repeat(filled), rest: '░'.repeat(width - filled) };
}
