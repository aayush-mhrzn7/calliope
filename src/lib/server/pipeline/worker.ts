import fs from 'node:fs';
import path from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { FORMAT_PRESETS, type FormatPresetId } from '$lib/formats';
import type { TrackStatus } from '$lib/status';
import { albumArtistFor, matchKey, splitArtistTitle } from '$lib/text';
import { db, schema } from '../db';
import { applyEnrichment, enrich, sameAlbum, splitGenres, type Enrichment } from '../enrich';
import type { Track } from '../db/schema';
import { fetchLyrics } from '../integrations/lyrics';
import { albumIdentity, findInLibrary } from '../library/lookup';
import { getSettings } from '../settings';
import { ytVideoInfo } from '../sources/youtube';
import { fetchImage, readMetadata, writeArtwork, writeTags } from '../tagger';
import { cleanupStaging, downloadAudio, type DownloadProgress } from './download';
import { renderTemplate } from './template';
import { patchTrack } from './tracks';

export interface WorkerContext {
	signal: AbortSignal;
	log: (line: string) => void;
	stage: (status: TrackStatus) => void;
	progress: (p: DownloadProgress) => void;
}

export class SkipError extends Error {}
export class PermanentError extends Error {}

function checkAbort(signal: AbortSignal) {
	if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Run one track through every stage. Throws SkipError / PermanentError / anything (retryable). */
export async function processTrack(initial: Track, ctx: WorkerContext): Promise<void> {
	let t = initial;
	const update = (patch: Partial<Track>) => {
		t = patchTrack(t.id, patch) ?? { ...t, ...patch };
	};
	const settings = getSettings();

	// 1. Resolve metadata ---------------------------------------------------------------
	let channel: string | null = null;
	ctx.stage('resolving');
	if (t.provider === 'youtube' && t.youtubeId) {
		ctx.log(`Fetching video info for ${t.youtubeId}`);
		const info = await ytVideoInfo(t.youtubeId, { signal: ctx.signal });
		channel = info.channel;
		const guess = splitArtistTitle(info.title, info.channel);
		update({
			// YouTube Music's structured fields beat parsing the video title
			title: info.track ?? t.title ?? guess.title,
			artist: info.artist ?? t.artist ?? guess.artist,
			artists: info.artists.length ? info.artists : (t.artists ?? [guess.artist]),
			// An album link names the album; otherwise YouTube Music's own album field
			album: t.album ?? info.album,
			year: t.year ?? info.releaseYear,
			durationMs: info.durationSec ? Math.round(info.durationSec * 1000) : t.durationMs,
			artworkUrl: info.thumbnail ?? t.artworkUrl,
			matchUrl: `https://www.youtube.com/watch?v=${info.id}`,
			matchTitle: info.title,
			matchScore: 1
		});
	}
	checkAbort(ctx.signal);
	if (!t.title || !t.artist) throw new PermanentError('Could not determine title/artist');
	if (!t.albumArtist) update({ albumArtist: albumArtistFor(t.artists?.[0] ?? t.artist, channel) });
	if (t.album) ctx.log(`Album: ${t.album} — ${t.albumArtist}`);

	// 2. Duplicate checks -----------------------------------------------------------------
	if (!t.force) {
		const idMatch = t.youtubeId ? eq(schema.tracks.youtubeId, t.youtubeId) : undefined;
		if (idMatch) {
			const prior = db
				.select({ id: schema.tracks.id })
				.from(schema.tracks)
				.where(and(idMatch, ne(schema.tracks.id, t.id), eq(schema.tracks.status, 'done')))
				.get();
			if (prior) throw new SkipError('Already downloaded');
		}
		if (settings.pipeline.skipExisting) {
			const hit = findInLibrary(t.artist, t.title);
			if (hit) throw new SkipError(`Already in library: ${hit.path}`);
		}
	}

	// 3. Download the audio -----------------------------------------------------------------
	const preset = (
		t.formatPreset in FORMAT_PRESETS ? t.formatPreset : settings.pipeline.formatPreset
	) as FormatPresetId;
	if (!t.matchUrl) throw new PermanentError('No YouTube video to download');
	checkAbort(ctx.signal);
	ctx.stage('downloading');
	let file: string;
	try {
		file = await downloadAudio(t.matchUrl, t.id, preset, {
			signal: ctx.signal,
			onProgress: ctx.progress,
			onPostprocess: () => ctx.stage('processing'),
			onLog: ctx.log
		});
	} catch (err) {
		cleanupStaging(t.id);
		throw err;
	}

	try {
		// 4. Tag -------------------------------------------------------------------------
		ctx.stage('tagging');
		// MusicBrainz: track numbers, original year, genres and real cover art. An album YouTube
		// Music named (or the album link itself) stays authoritative — MusicBrainz lags behind new
		// releases and often names a different edition — so it only fills the gaps. A plain video
		// knows no album, and MusicBrainz decides it.
		let mbMatch: Enrichment | null = null;
		if (settings.pipeline.enrichMusicBrainz) {
			const keepAlbum = !!t.album;
			mbMatch = await enrich(
				{
					artist: t.artist,
					title: t.title,
					durationMs: t.durationMs,
					album: keepAlbum ? t.album : null,
					file
				},
				ctx.log
			).catch((err: Error) => {
				ctx.log(`MusicBrainz lookup failed: ${err.message}`);
				return null;
			});
			if (mbMatch) update(applyEnrichment(t, mbMatch, { keepAlbum }));
		}
		checkAbort(ctx.signal);
		const durationSec = t.durationMs ? t.durationMs / 1000 : null;
		let lyrics: Awaited<ReturnType<typeof fetchLyrics>> = null;
		if (settings.lyrics.enabled) {
			lyrics = await fetchLyrics({ artist: t.artist, title: t.title, album: t.album, durationSec });
			ctx.log(lyrics ? `Lyrics found (${lyrics.synced ? 'synced' : 'plain'})` : 'No lyrics found');
		}
		const lyricText = settings.lyrics.preferSynced
			? (lyrics?.synced ?? lyrics?.plain)
			: (lyrics?.plain ?? lyrics?.synced);

		// File the track with the album the library already has: one album artist, one release ID
		const identity = albumIdentity({
			albumArtist: t.albumArtist,
			artist: t.artists?.[0] ?? t.artist,
			album: t.album,
			releaseId: mbMatch && sameAlbum(mbMatch.album, t.album) ? mbMatch.releaseId : null
		});
		update({ albumArtist: identity.albumArtist, album: identity.album });

		await writeTags(file, {
			title: t.title,
			artists: t.artists?.length ? t.artists : [t.artist],
			album: t.album ?? undefined,
			albumArtist: t.albumArtist ?? t.artists?.[0] ?? t.artist,
			year: t.year ?? undefined,
			trackNumber: t.trackNumber ?? undefined,
			discNumber: t.discNumber ?? undefined,
			trackTotal:
				mbMatch && sameAlbum(mbMatch.album, t.album)
					? (mbMatch.trackTotal ?? undefined)
					: undefined,
			genre: splitGenres(t.genre),
			comment: t.matchUrl ?? undefined,
			lyrics: lyricText ?? undefined,
			mbRecordingId: mbMatch?.recordingId,
			mbReleaseId: identity.releaseId ?? undefined,
			mbArtistId: mbMatch?.artistId ?? undefined
		});

		let hasArtwork = false;
		if (t.artworkUrl) {
			const img = await fetchImage(t.artworkUrl);
			if (img) {
				await writeArtwork(file, img.data, img.mime);
				hasArtwork = true;
			} else ctx.log('Artwork download failed');
		}
		const meta = await readMetadata(file);
		checkAbort(ctx.signal);

		// 5. File into the library ------------------------------------------------------------
		ctx.stage('moving');
		const ext = path.extname(file).slice(1);
		const rel = renderTemplate(settings.pipeline.pathTemplate, {
			title: t.title,
			artist: t.artist,
			albumartist: t.albumArtist ?? t.artist,
			album: t.album,
			year: t.year,
			track: t.trackNumber,
			disc: t.discNumber,
			genre: t.genre
		});
		const dest = moveFile(file, uniquePath(path.join(settings.paths.libraryDir, `${rel}.${ext}`)));
		if (settings.lyrics.writeLrcFile && lyrics?.synced) {
			fs.writeFileSync(dest.replace(/\.[^.]+$/, '.lrc'), lyrics.synced);
		}
		const stat = fs.statSync(dest);
		ctx.log(`Saved to ${dest}`);

		update({
			filePath: dest,
			fileSize: stat.size,
			bitrate: meta.properties?.bitrate ?? null,
			hasArtwork,
			hasLyrics: !!lyricText,
			hasSyncedLyrics: !!lyrics?.synced
		});

		// Index immediately so the library and dedup checks see it without waiting for a scan.
		db.insert(schema.libraryFiles)
			.values({
				id: crypto.randomUUID(),
				path: dest,
				relPath: path.relative(settings.paths.libraryDir, dest),
				size: stat.size,
				mtimeMs: Math.floor(stat.mtimeMs),
				format: ext,
				codec: meta.properties?.codec ?? null,
				lossless: meta.properties?.isLossless ?? null,
				bitrate: meta.properties?.bitrate ?? null,
				sampleRate: meta.properties?.sampleRate ?? null,
				bitsPerSample: meta.properties?.bitsPerSample || null,
				channels: meta.properties?.channels ?? null,
				durationMs: meta.properties ? Math.round(meta.properties.duration * 1000) : t.durationMs,
				title: t.title,
				artist: t.artist,
				album: t.album,
				albumArtist: t.albumArtist ?? t.artist,
				trackNumber: t.trackNumber,
				discNumber: t.discNumber,
				year: t.year,
				genre: t.genre,
				hasArtwork,
				hasLyrics: !!lyricText,
				mbReleaseId: identity.releaseId ?? null,
				matchKey: matchKey(t.artist, t.title),
				trackId: t.id
			})
			.onConflictDoNothing()
			.run();
	} finally {
		cleanupStaging(t.id);
	}
}

function uniquePath(p: string) {
	if (!fs.existsSync(p)) return p;
	const ext = path.extname(p);
	const base = p.slice(0, -ext.length);
	for (let i = 2; ; i++) {
		const candidate = `${base} (${i})${ext}`;
		if (!fs.existsSync(candidate)) return candidate;
	}
}

/**
 * rename(), falling back to copy+unlink across filesystems (staging on SSD, library on HDD).
 * Returns the path as it exists on disk: on case-insensitive filesystems (macOS) "System of a
 * Down/…" lands inside an existing "System Of A Down/" folder, and the index must record that.
 */
export function moveFile(from: string, to: string): string {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	try {
		fs.renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		fs.copyFileSync(from, to);
		fs.rmSync(from);
	}
	return trueCasePath(to);
}

/**
 * The path with each segment spelled the way it exists on disk. On case-insensitive filesystems
 * "System of a Down/Toxicity" may really be the existing "System Of A Down/Toxicity" folder, and
 * the index must record what a directory walk will report. (No symlink resolution, unlike realpath.)
 */
export function trueCasePath(p: string): string {
	const parts = p.split(path.sep);
	let cur = parts[0] === '' ? path.sep : '.';
	for (const part of parts[0] === '' ? parts.slice(1) : parts) {
		if (!part) continue;
		let entries: string[] = [];
		try {
			entries = fs.readdirSync(cur);
		} catch {
			/* unreadable: keep the given spelling */
		}
		const real = entries.includes(part)
			? part
			: entries.find((e) => e.toLowerCase() === part.toLowerCase());
		cur = path.join(cur, real ?? part);
	}
	return path.isAbsolute(p) ? cur : path.relative('.', cur);
}

/** Two paths name the same existing file (true for case-only differences on macOS). */
export function samePath(a: string, b: string) {
	try {
		return fs.realpathSync.native(a) === fs.realpathSync.native(b);
	} catch {
		return false;
	}
}
