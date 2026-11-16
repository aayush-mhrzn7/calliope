import { and, gte, inArray, isNotNull } from 'drizzle-orm';
import type { PipelineStats, StatBucket } from '$lib/types';
import { db, schema } from '../db';

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const STAT_DAYS = 371; // 53 full weeks for the year grid

const empty = (): StatBucket => ({ done: 0, failed: 0, skipped: 0, bytes: 0 });

/**
 * Finished tracks bucketed by local day (a year) and by hour (the last 24h).
 * `tzOffset` is the browser's Date#getTimezoneOffset(), so days split at the viewer's midnight.
 */
export function pipelineStats(now = Date.now(), tzOffset = 0): PipelineStats {
	const shift = -tzOffset * 60_000; // UTC → local wall clock
	const todayStart = Math.floor((now + shift) / DAY) * DAY - shift;
	const since = todayStart - (STAT_DAYS - 1) * DAY;
	const hourStart = Math.floor(now / HOUR) * HOUR - 23 * HOUR;

	const rows = db
		.select({
			status: schema.tracks.status,
			finishedAt: schema.tracks.finishedAt,
			fileSize: schema.tracks.fileSize
		})
		.from(schema.tracks)
		.where(
			and(
				isNotNull(schema.tracks.finishedAt),
				gte(schema.tracks.finishedAt, new Date(since)),
				inArray(schema.tracks.status, ['done', 'failed', 'skipped'])
			)
		)
		.all();

	const days = Array.from({ length: STAT_DAYS }, empty);
	const hours = Array.from({ length: 24 }, empty);
	for (const r of rows) {
		const at = r.finishedAt!.getTime();
		const key = r.status as 'done' | 'failed' | 'skipped';
		const d = Math.floor((at - since) / DAY);
		if (d >= 0 && d < STAT_DAYS) {
			days[d][key]++;
			if (key === 'done') days[d].bytes += r.fileSize ?? 0;
		}
		const h = Math.floor((at - hourStart) / HOUR);
		if (h >= 0 && h < 24) {
			hours[h][key]++;
			if (key === 'done') hours[h].bytes += r.fileSize ?? 0;
		}
	}
	return { since, todayStart, hourStart, days, hours, today: days[STAT_DAYS - 1] };
}
