<script lang="ts">
	import { drawDotArea, type DotAreaOptions } from '$lib/client/dotmatrix';

	let {
		height = 120,
		label,
		...opts
	}: DotAreaOptions & { height?: number; label: string } = $props();

	let canvas = $state<HTMLCanvasElement>();

	$effect(() => {
		const el = canvas;
		if (!el) return;
		// Touch every option so data changes redraw
		const o = { ...opts, series: opts.series.map((s) => ({ ...s, values: [...s.values] })) };
		const draw = () => drawDotArea(el, o);
		draw();
		const ro = new ResizeObserver(draw);
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

<div role="img" aria-label={label}>
	<canvas bind:this={canvas} aria-hidden="true" class="block w-full" style="height:{height}px"
	></canvas>
</div>
