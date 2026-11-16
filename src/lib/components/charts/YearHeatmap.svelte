<script lang="ts">
	import { onMount } from 'svelte';
	import { DM, drawHeatmap, heatmapLayout } from '$lib/client/dotmatrix';
	import { stats } from '$lib/client/stats.svelte';

	onMount(() => stats.follow());

	let canvas = $state<HTMLCanvasElement>();
	let box = $state<HTMLDivElement>();
	const s = $derived(stats.data);
	const counts = $derived(s ? s.days.map((d) => d.done) : []);
	const total = $derived(counts.reduce((a, b) => a + b, 0));
	const activeDays = $derived(counts.filter((n) => n > 0).length);

	$effect(() => {
		const el = canvas;
		const wrap = box;
		if (!el || !wrap || !s) return;
		const days = [...counts];
		const end = new Date(s.todayStart);
		// The grid fills the panel's width; its height follows from the square size
		const draw = () => {
			el.style.height = `${heatmapLayout(wrap.clientWidth, days.length, end).height}px`;
			drawHeatmap(el, { days, end, color: DM.green });
		};
		draw();
		const ro = new ResizeObserver(draw);
		ro.observe(wrap);
		return () => ro.disconnect();
	});
</script>

<section class="glass p-4">
	<div class="mb-3 flex items-baseline justify-between">
		<h2 class="panel-title">Past year</h2>
		<span class="font-mono text-[11px] text-ink-400"
			>{total.toLocaleString()} songs · {activeDays} active days</span
		>
	</div>
	<div
		bind:this={box}
		role="img"
		aria-label="Songs downloaded per day over the past year: {total} in total"
	>
		<canvas bind:this={canvas} aria-hidden="true" class="block h-[105px] w-full"></canvas>
	</div>
	<div class="mt-2 flex items-center justify-end gap-1.5 font-mono text-[9px] text-ink-500">
		Less
		{#each [0.07, 0.35, 0.55, 0.78, 1] as a, i (i)}
			<span
				class="inline-block h-2.5 w-2.5 rounded-[2px]"
				style="background:{i === 0 ? `rgba(255,255,255,${a})` : DM.green};opacity:{i === 0 ? 1 : a}"
			></span>
		{/each}
		More
	</div>
</section>
