/** Version markers that make a different recording unless the target title has them too. */
export const VARIANTS = [
	'live',
	'cover',
	'remix',
	'karaoke',
	'instrumental',
	'sped up',
	'slowed',
	'reverb',
	'nightcore',
	'8d',
	'acoustic',
	'extended',
	'1 hour',
	'hour loop',
	'tutorial',
	'reaction',
	'mashup',
	'bass boosted',
	'piano version',
	'demo'
];

export interface MatchTarget {
	title: string;
	artist: string;
	artists?: string[];
	durationMs?: number | null;
}

/** 1 within 2 seconds of the target length, falling to 0 at 30 seconds off; null when unknown. */
export function durationScore(
	targetMs: number | null | undefined,
	candSec: number | null | undefined
): number | null {
	if (!targetMs || !candSec) return null;
	const diff = Math.abs(targetMs / 1000 - candSec);
	if (diff <= 2) return 1;
	if (diff >= 30) return 0;
	return 1 - (diff - 2) / 28;
}
