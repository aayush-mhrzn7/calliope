import fs from 'node:fs';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { readMetadataBatch } from 'taglib-wasm/simple';
import type { RequestHandler } from './$types';
import { parseLyrics, type LyricsDTO } from '$lib/lyrics';
import { db, schema } from '$lib/server/db';
import { handler } from '$lib/server/http';
import { fetchLyrics } from '$lib/server/integrations/lyrics';

async function embedded(file: string): Promise<string | null> {
	const res = await readMetadataBatch([file], { includeProperties: ['LYRICS'] }).catch(() => null);
	const item = res?.items[0];
	if (!item || item.status !== 'ok') return null;
	const tags = item.data.tags as { lyrics?: { text?: string }[] };
	return tags.lyrics?.find((l) => l.text?.trim())?.text ?? null;
}

/**
 * Lyrics for the player: an .lrc next to the file (often better synced), then the file's own
 * lyrics tag, then — for files that have none — a live LRCLIB lookup that is shown but not saved.
 */
export const GET: RequestHandler = handler(async ({ params }) => {
	const file = db
		.select()
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, params.id))
		.get();
	if (!file) error(404, 'Not found');

	const lrcPath = file.path.replace(/\.[^.]+$/, '.lrc');
	const lrc = fs.existsSync(lrcPath) ? fs.readFileSync(lrcPath, 'utf8') : null;
	const own = await embedded(file.path);

	let out: LyricsDTO = { synced: false, lines: [], source: null };
	const fromLrc = parseLyrics(lrc);
	const fromTag = parseLyrics(own);
	// A synced copy beats a plain one wherever it lives
	if (fromLrc.synced || (fromLrc.lines.length && !fromTag.synced))
		out = { ...fromLrc, source: 'lrc' };
	else if (fromTag.lines.length) out = { ...fromTag, source: 'embedded' };

	if (!out.lines.length && file.artist && file.title) {
		const found = await fetchLyrics({
			artist: file.artist,
			title: file.title,
			album: file.album,
			durationSec: file.durationMs ? file.durationMs / 1000 : null
		});
		const parsed = parseLyrics(found?.synced ?? found?.plain);
		if (parsed.lines.length) out = { ...parsed, source: 'lrclib' };
	}
	return json(out, { headers: { 'Cache-Control': 'no-store' } });
});
