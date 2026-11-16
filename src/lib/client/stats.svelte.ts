import { api } from './api';
import { live } from './live.svelte';
import type { PipelineStats } from '$lib/types';

/** Download history for the pipeline charts, refetched shortly after tracks finish. */
class Stats {
	data = $state<PipelineStats | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;
	private users = 0;
	private unsubscribe: (() => void) | null = null;

	async load() {
		this.data = await api
			.get<PipelineStats>(`/api/pipeline/stats?tz=${new Date().getTimezoneOffset()}`, {
				quiet: true
			})
			.catch(() => this.data);
	}

	/** Start following while a component shows the stats; returns the stop function. */
	follow() {
		if (this.users++ === 0) {
			void this.load();
			this.unsubscribe = live.subscribe((event, data) => {
				const status = (data as { status?: string })?.status;
				if (event !== 'track' || !['done', 'failed', 'skipped'].includes(status ?? '')) return;
				if (this.timer) clearTimeout(this.timer);
				this.timer = setTimeout(() => void this.load(), 2000);
			});
		}
		return () => {
			if (--this.users > 0) return;
			this.unsubscribe?.();
			this.unsubscribe = null;
			if (this.timer) clearTimeout(this.timer);
		};
	}
}

export const stats = new Stats();
