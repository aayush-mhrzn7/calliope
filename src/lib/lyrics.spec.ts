import { describe, expect, it } from 'vitest';
import { activeLine, parseLyrics } from './lyrics';

describe('parseLyrics', () => {
	it('reads synced LRC, skipping metadata tags', () => {
		const r = parseLyrics('[ar:Drake]\n[ti:WNBA]\n[00:01.50] First\n[00:04.25]Second\n[01:00.00] ');
		expect(r.synced).toBe(true);
		expect(r.lines).toEqual([
			{ time: 1.5, text: 'First' },
			{ time: 4.25, text: 'Second' },
			{ time: 60, text: '' }
		]);
	});

	it('expands lines with several stamps and sorts them', () => {
		const r = parseLyrics('[00:10.00][00:30.00] Chorus\n[00:20.00] Verse');
		expect(r.lines.map((l) => [l.time, l.text])).toEqual([
			[10, 'Chorus'],
			[20, 'Verse'],
			[30, 'Chorus']
		]);
	});

	it('handles 3-digit fractions and the offset tag', () => {
		const r = parseLyrics('[offset:500]\n[00:02.123] Hi');
		expect(r.lines[0].time).toBeCloseTo(1.623);
	});

	it('returns plain text unsynced', () => {
		const r = parseLyrics('Line one\r\nLine two');
		expect(r).toEqual({
			synced: false,
			lines: [
				{ time: null, text: 'Line one' },
				{ time: null, text: 'Line two' }
			]
		});
	});

	it('is empty for nothing', () => {
		expect(parseLyrics(null)).toEqual({ synced: false, lines: [] });
	});
});

describe('activeLine', () => {
	const lines = [
		{ time: 1, text: 'a' },
		{ time: 5, text: 'b' },
		{ time: 9, text: 'c' }
	];
	it('picks the last line that has started', () => {
		expect(activeLine(lines, 0)).toBe(-1);
		expect(activeLine(lines, 1)).toBe(0);
		expect(activeLine(lines, 7)).toBe(1);
		expect(activeLine(lines, 100)).toBe(2);
	});
});
