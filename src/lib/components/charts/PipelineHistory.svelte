<script lang="ts">
	import { onMount } from 'svelte';
	import { DM, blockStrip, meter } from '$lib/client/dotmatrix';
	import { bytes } from '$lib/client/format';
	import { stats } from '$lib/client/stats.svelte';
	import DotArea from './DotArea.svelte';

	const DAYS = 30;
	const DAY = 86_400_000;

	onMount(() => stats.follow());

	const s = $derived(stats.data);
	const month = $derived(s ? s.days.slice(-DAYS) : []);
	const done = $derived(month.map((d) => d.done));
	const failed = $derived(month.map((d) => d.failed));
	const totals = $derived({
		done: done.reduce((a, b) => a + b, 0),
		failed: failed.reduce((a, b) => a + b, 0)
	});
	const dateLabel = (t: number) =>
		new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
	const xLabels = $derived(
		s ? [0, 1, 2, 3].map((k) => dateLabel(s.todayStart - (DAYS - 1) * DAY * (1 - k / 3))) : []
	);
	const share = (n: number) => {
		const all = totals.done + totals.failed;
		return all ? `${Math.round((n / all) * 100)}%` : '—';
	};

	const today = $derived(s?.today ?? { done: 0, failed: 0, skipped: 0, bytes: 0 });
	const meterMax = $derived(Math.max(1, today.done + today.failed + today.skipped));
	const meters = $derived([
		{ label: 'Done', value: today.done, color: DM.green },
		{ label: 'Failed', value: today.failed, color: DM.red },
		{ label: 'Skipped', value: today.skipped, color: DM.gray }
	]);

	const strip = $derived.by(() => {
		const hours = s?.hours ?? Array.from({ length: 24 }, () => null);
		const blocks = blockStrip(hours.map((h) => (h ? h.done + h.failed + h.skipped : 0)));
		return blocks.map((b, i) => {
			const h = hours[i];
			const color = b.empty ? DM.faint : h && h.failed ? DM.red : h && h.done ? DM.green : DM.gray;
			const at = s ? new Date(s.hourStart + i * 3_600_000) : null;
			const title =
				h && at
					? `${at.toLocaleTimeString([], { hour: 'numeric' })}: ${h.done} done, ${h.failed} failed, ${h.skipped} skipped`
					: '';
			return { ...b, color, title };
		});
	});
</script>

<section class="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
	<div class="glass p-4">
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="panel-title">Downloads · last 30 days</h2>
			<span class="font-mono text-[11px] text-ink-400">{totals.done.toLocaleString()} songs</span>
		</div>
		<DotArea
			height={96}
			label="Downloads per day over the last 30 days: {totals.done} completed, {totals.failed} failed"
			series={[
				{ color: DM.green, values: done },
				{ color: DM.red, values: failed }
			]}
			{xLabels}
			minPeak={4}
		/>
		<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]">
			{#each [{ name: 'Done', n: totals.done, color: DM.green }, { name: 'Failed', n: totals.failed, color: DM.red }] as l (l.name)}
				<span class="flex items-center gap-1.5">
					<span style="color:{l.color}">■</span>
					<span class="text-ink-100">{l.name}</span>
					<span class="text-ink-400">{l.n.toLocaleString()}</span>
					<span class="text-ink-500">{share(l.n)}</span>
				</span>
			{/each}
		</div>
	</div>

	<div class="glass flex flex-col gap-5 p-4 font-mono">
		<div>
			<div class="mb-2.5 flex items-baseline justify-between">
				<h2 class="panel-title">Today</h2>
				<span class="text-[11px] text-ink-400">{bytes(today.bytes)} added</span>
			</div>
			<div class="space-y-1 text-[11px] leading-tight">
				{#each meters as m (m.label)}
					{@const bar = meter(m.value, meterMax, 18)}
					<div class="flex items-center gap-2">
						<span class="w-14 text-ink-300">{m.label}</span>
						<span class="tracking-[-0.05em] whitespace-pre"
							><span style="color:{m.color}">{bar.filled}</span><span class="text-ink-700"
								>{bar.rest}</span
							></span
						>
						<span class="ml-auto text-ink-100 tabular-nums">{m.value.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		</div>

		<div>
			<h2 class="panel-title mb-2">Last 24 hours</h2>
			<div
				class="flex justify-between text-[18px] leading-none"
				aria-label="Downloads per hour, last 24 hours"
			>
				{#each strip as b, i (i)}
					<span style="color:{b.color}" title={b.title}>{b.char}</span>
				{/each}
			</div>
			<div class="mt-1.5 flex justify-between text-[9px] tracking-wide text-ink-500 uppercase">
				<span>24h ago</span><span>12h</span><span>Now</span>
			</div>
		</div>
	</div>
</section>
