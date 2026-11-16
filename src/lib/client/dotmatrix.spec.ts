import { describe, expect, it } from 'vitest';
import { blockStrip, compact, meter, resample, smoothen, spread } from './dotmatrix';

describe('dot-matrix helpers', () => {
	it('resamples to exactly n columns', () => {
		expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
		expect(resample([7], 4)).toEqual([7, 7, 7, 7]);
		expect(resample([], 2)).toEqual([0, 0]);
	});

	it('spreads values into crisp columns', () => {
		expect(spread([1, 2], 4)).toEqual([1, 1, 2, 2]);
	});

	it('smooths with a centered window', () => {
		expect(smoothen([0, 0, 10, 0, 0])).toEqual([10 / 3, 2.5, 2, 2.5, 10 / 3]);
	});

	it('formats compact numbers', () => {
		expect(compact(840)).toBe('840');
		expect(compact(12_600_000)).toBe('12.6M');
	});

	it('builds a block strip, empty slots faint', () => {
		const s = blockStrip([0, 4, 8]);
		expect(s.map((x) => x.char).join('')).toBe('▁▄█');
		expect(s[0].empty).toBe(true);
		expect(blockStrip([0, 0]).every((x) => x.empty)).toBe(true);
	});

	it('fills a meter to scale', () => {
		expect(meter(5, 10, 10)).toEqual({ filled: '█████', rest: '░░░░░' });
		expect(meter(0, 0, 4)).toEqual({ filled: '', rest: '░░░░' });
	});
});
