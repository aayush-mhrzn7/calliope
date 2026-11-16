/** One line of lyrics; `time` (seconds) is null for unsynced lyrics. */
export interface LyricLine {
	time: number | null;
	text: string;
}

export interface LyricsDTO {
	synced: boolean;
	lines: LyricLine[];
	/** Where they came from: the file's own tag, an .lrc next to it, or a live LRCLIB lookup */
	source: 'embedded' | 'lrc' | 'lrclib' | null;
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(?:ar|ti|al|au|by|length|offset|re|ve|#):/i;

/**
 * Parse LRC ("[01:02.34] line") or plain text. A line may carry several stamps (a repeated
 * chorus); the result is sorted by time. Text without any stamp comes back unsynced.
 */
export function parseLyrics(raw: string | null | undefined): Omit<LyricsDTO, 'source'> {
	const text = (raw ?? '').replace(/\r\n?/g, '\n').trim();
	if (!text) return { synced: false, lines: [] };
	const offsetMatch = text.match(/^\[offset:\s*([+-]?\d+)\]/im);
	const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

	const timed: LyricLine[] = [];
	for (const row of text.split('\n')) {
		if (META.test(row.trim())) continue;
		const stamps = [...row.matchAll(STAMP)];
		if (!stamps.length) continue;
		const words = row.replace(STAMP, '').trim();
		for (const m of stamps) {
			const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
			const time = Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac - offset);
			timed.push({ time, text: words });
		}
	}
	if (timed.length) {
		timed.sort((a, b) => a.time! - b.time!);
		return { synced: true, lines: timed };
	}
	return {
		synced: false,
		lines: text.split('\n').map((l) => ({ time: null, text: l.trim() }))
	};
}

/** Index of the line being sung at `sec`: the last one that has started, or -1 before the first. */
export function activeLine(lines: LyricLine[], sec: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if ((lines[mid].time ?? Infinity) <= sec) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}
