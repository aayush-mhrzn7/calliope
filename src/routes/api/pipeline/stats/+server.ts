import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { pipelineStats } from '$lib/server/pipeline/stats';

/** Download history for the pipeline charts. `?tz=` is the browser's timezone offset in minutes. */
export const GET = handler(({ url }) => {
	const tz = Number(url.searchParams.get('tz') ?? 0);
	return json(
		pipelineStats(Date.now(), Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0),
		{
			headers: { 'Cache-Control': 'no-store' }
		}
	);
});
