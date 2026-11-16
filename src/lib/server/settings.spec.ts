import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calliope-settings-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Settings as a fresh process would read them from rows written by an older version. */
async function load(name: string, rows: Record<string, object>) {
	vi.resetModules();
	delete (globalThis as { __calliope_db__?: unknown }).__calliope_db__;
	process.env.CALLIOPE_DATA_DIR = path.join(tmp, name);
	process.env.CALLIOPE_MIGRATIONS_DIR = path.resolve('drizzle');
	const { db, schema } = await import('./db');
	for (const [key, value] of Object.entries(rows))
		db.insert(schema.settings).values({ key, value }).run();
	return (await import('./settings')).getSettings();
}

describe('settings from older versions', () => {
	it('drops removed options (Spotify, Soulseek, match thresholds) and keeps the rest', async () => {
		const s = await load('a', {
			pipeline: {
				formatPreset: 'opus',
				concurrency: 3,
				preferredSource: 'ytmusic',
				preferYtMusic: true,
				lowConfidenceScore: 0.6,
				rejectScore: 0.35
			},
			spotify: { clientId: 'x', clientSecret: 'y' },
			soulseek: { enabled: true, username: 'u', password: 'p', autoLossless: true }
		});
		expect(s.pipeline).toMatchObject({ formatPreset: 'opus', concurrency: 3 });
		expect(s.pipeline).not.toHaveProperty('preferredSource');
		expect(s.pipeline).not.toHaveProperty('rejectScore');
		expect(s).not.toHaveProperty('spotify');
		expect(s).not.toHaveProperty('soulseek');
	});
});
