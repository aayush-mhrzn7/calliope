import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { YtVideoInfo } from '../sources/youtube';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-worker-'));
const fixture = path.join(tmp, 'fixture.flac');

// YouTube is replaced: video info is canned per test and "yt-dlp" hands back a local file.
const net = vi.hoisted(() => ({
	info: null as unknown as Partial<YtVideoInfo>,
	downloads: 0,
	fails: false
}));
vi.mock('../sources/youtube', () => ({
	ytVideoInfo: async (id: string) => ({
		id,
		title: 'Untitled',
		durationSec: 1,
		channel: null,
		channelId: null,
		viewCount: null,
		url: `https://www.youtube.com/watch?v=${id}`,
		track: null,
		artist: null,
		artists: [],
		album: null,
		releaseYear: null,
		thumbnail: null,
		...net.info
	})
}));
vi.mock('./download', async (original) => ({
	...(await original<typeof import('./download')>()),
	downloadAudio: async (_url: string, id: string) => {
		net.downloads++;
		if (net.fails) throw new Error('yt-dlp exploded');
		const dest = path.join(tmp, 'staging', `${id}.flac`);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(fixture, dest);
		return dest;
	}
}));

describe.skipIf(!hasFfmpeg)('YouTube downloads in the pipeline', () => {
	const libraryDir = path.join(tmp, 'music');

	beforeAll(async () => {
		process.env.CALLIOPE_DATA_DIR = path.join(tmp, 'data');
		process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
		execFileSync('ffmpeg', [
			...['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
			fixture
		]);
		const { updateSettings } = await import('../settings');
		updateSettings({
			paths: { libraryDir, stagingDir: path.join(tmp, 'staging') },
			// No network in tests: MusicBrainz and LRCLIB stay off
			pipeline: { enrichMusicBrainz: false, formatPreset: 'flac' },
			lyrics: { enabled: false }
		});
	});
	afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

	const run = async (row: Record<string, unknown>) => {
		const { pipeline } = await import('./queue');
		const { getTrack } = await import('./tracks');
		const { processTrack } = await import('./worker');
		const [track] = pipeline.enqueue([{ provider: 'youtube', force: true, ...row }]);
		const log: string[] = [];
		const error = await processTrack(track, {
			signal: new AbortController().signal,
			log: (l) => log.push(l),
			stage: () => {},
			progress: () => {}
		}).then(
			() => null,
			(err: Error) => err
		);
		return { track: getTrack(track.id)!, log: log.join('\n'), error };
	};

	it('an album link keeps its album, and the channel is the album artist despite features', async () => {
		net.info = { title: 'Drake, Qendresa - Slap The City', channel: 'Drake' };
		const { track, error } = await run({
			youtubeId: 'slap0000000',
			album: 'HABIBTI (FOMO)',
			trackNumber: 3
		});
		expect(error).toBeNull();
		expect(track).toMatchObject({
			title: 'Slap The City',
			artist: 'Drake, Qendresa',
			album: 'HABIBTI (FOMO)',
			albumArtist: 'Drake',
			trackNumber: 3
		});
		expect(track.filePath).toBe(
			path.join(libraryDir, 'Drake', 'HABIBTI (FOMO)', '03 - Slap The City.flac')
		);
	});

	it("a single song link takes YouTube Music's album", async () => {
		net.info = {
			title: 'WNBA',
			channel: 'Drake',
			track: 'WNBA',
			artist: 'Drake',
			artists: ['Drake'],
			album: 'HABIBTI (FOMO)',
			releaseYear: 2026
		};
		const { track } = await run({ youtubeId: 'rMfx7UQ3mcs' });
		expect(track).toMatchObject({ album: 'HABIBTI (FOMO)', albumArtist: 'Drake', year: 2026 });
		expect(track.filePath).toBe(path.join(libraryDir, 'Drake', 'HABIBTI (FOMO)', 'WNBA.flac'));
	});

	it('a video with no album info is filed under Singles', async () => {
		net.info = { title: 'Foster - fools (Official Audio)', channel: 'Foster' };
		const { track } = await run({ youtubeId: 'fools000000' });
		expect(track.album).toBeNull();
		expect(track.filePath).toBe(path.join(libraryDir, 'Foster', 'Singles', 'fools.flac'));
	});

	it('a failed download leaves nothing in staging and reports the error', async () => {
		net.info = { title: 'Some - Song', channel: 'Some' };
		net.fails = true;
		const { error } = await run({ youtubeId: 'fail0000000' });
		net.fails = false;
		expect(error?.message).toBe('yt-dlp exploded');
		expect(fs.readdirSync(path.join(tmp, 'staging'))).toEqual([]);
	});
});
