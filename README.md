# Calliope

Self-hosted music harvester and library studio. Paste YouTube links, or monitor playlists,
albums and channels, and Calliope matches, downloads, tags and files every track into your library.

Calliope v2: a ground-up rewrite of the original Next.js app on SvelteKit 5, Drizzle and SQLite.

## Features

**Sync Hub**

- **Pipeline:** a persistent download queue that survives restarts, with parallel workers, live
  progress/speed/ETA over SSE, per-track yt-dlp logs, drag-and-drop reordering, pause/resume and
  retries with backoff.
- **Sources:** monitor YouTube playlists, albums and channels.
  Each source has its own schedule (15 min to daily, or manual), and new tracks are either
  auto-queued or held in a diff preview for you to pick from.
- **Identification:** YouTube Music's own song data (title, artists, album, year and the square
  album cover) comes first, then the video title. The album YouTube Music names is kept — it knows
  new releases before MusicBrainz does — and MusicBrainz fills in track numbers, genres and the
  year. The uploading channel becomes the album artist, so featured artists don't split an album.
- **Tagging:** title, artists, album, album artist, track/disc numbers, year, cover art and
  (synced) lyrics from LRCLIB, written natively with TagLib for MP3, M4A, Opus and FLAC.
- **Filing:** a folder template engine, e.g. `{albumartist|artist}/{album|Singles}/[{track:02} - ]{title}`.
- **Integrations:** Navidrome rescan and Discord notifications (webhook or bot).

**Library**

- **Library Explorer:** an incremental scanner (re-reads only changed files), a virtualized track
  table with multi-column sort (shift-click adds a sort key), instant search, format/quality/missing-tag
  filters, an artist facet, an album grid and a track details drawer.
- **Player:** Web Audio playback with an interactive waveform, live spectrum visualizer,
  near-gapless transitions, loudness normalization (capped by each track's peak headroom), media keys,
  a play queue and a lyrics panel (press `L`): synced lyrics follow the song and a click on a line
  jumps there.
- **Metadata Studio:** a spreadsheet-style tag grid with staged edits (nothing is written until you
  save). Tools:
  - bulk edit
  - find/replace, with regex
  - casing fixes
  - filename pattern parser (`%track% - %artist% - %title%`)
  - track numbering
  - MusicBrainz search and auto-match, plus AcoustID audio identification
  - Cover Art Archive artwork, image upload, LRCLIB lyrics
  - organize files by template
- **Duplicate Inspector:** three engines (identical audio hash, same normalized tags, Chromaprint
  acoustic similarity) and a side-by-side comparison matrix. The best copy is picked automatically,
  and resolving can merge missing tags, artwork and lyrics into it. Removed copies go to a quarantine
  folder with one-click restore; permanent deletion requires typing a confirmation.

## Running with Docker

Every push to `main` is tested and published by GitHub Actions as
`ghcr.io/aayush-mhrzn7/calliope` (`latest`, `sha-<commit>`, and a version tag for each `v*` release),
so the server only downloads a ready image — nothing is compiled on it.

```bash
mkdir calliope && cd calliope
curl -fsSLo docker-compose.yml https://raw.githubusercontent.com/aayush-mhrzn7/calliope/main/docker-compose.example.yml
# edit docker-compose.yml: the password, TZ and your Music path
docker compose up -d
```

Update to the newest version:

```bash
docker compose pull && docker compose up -d
```

To stay on one version, use a commit or release tag instead of `latest`, for example
`ghcr.io/aayush-mhrzn7/calliope:sha-1a2b3c4`. To build the image yourself instead, clone the repo,
replace `image:` with `build: .` and run `docker compose up -d --build` (slow on small machines:
it compiles the SQLite driver and bundles the app). The published image is for Intel/AMD (`linux/amd64`).

Open `http://localhost:7200`. The image bundles FFmpeg, Chromaprint (fpcalc, for AcoustID and
duplicate detection), deno and yt-dlp, and updates yt-dlp on every start (`YTDLP_AUTO_UPDATE=1`).
YouTube regularly breaks old yt-dlp releases. Set `TZ` to your timezone so the pipeline's "today"
counts roll over at your midnight. The example file also has an optional Navidrome service that
shares the music folder.

The app works at whatever address you open it at (LAN IP, hostname, reverse proxy or tunnel) — no `ORIGIN` needed. Proxies should pass the original `Host` (or `X-Forwarded-Host`) and `X-Forwarded-Proto`.

Forgot the password? `docker exec -it calliope node reset-password.mjs` sets a new one and signs out every session.

## Running locally

Requirements: Node 24+, `yt-dlp` (recent), `ffmpeg`/`ffprobe`, and ideally `deno` (yt-dlp uses it
for YouTube). `fpcalc` (Chromaprint) is optional.

```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:7200
```

The first visit opens a setup screen to choose the library and staging folders and set a password.

## Notes

- **Formats:** YouTube audio is lossy. The FLAC preset stores it losslessly but adds no quality.
  Opus avoids re-encoding.

## Development

| Command                      |                                                                  |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Dev server on :7200                                              |
| `npm run check`              | Type-check (svelte-check)                                        |
| `npm test`                   | Unit tests (vitest)                                              |
| `npm run db:generate`        | Generate a migration after editing `src/lib/server/db/schema.ts` |
| `npm run build && npm start` | Production build                                                 |

Layout: `src/lib/server/` holds the pipeline, sources, sync scheduler, tagging and integrations.
`src/lib/components/` holds the UI. Routes live under `src/routes/(app)` and `src/routes/api`.

## License

The Unlicense. See `LICENSE`.
