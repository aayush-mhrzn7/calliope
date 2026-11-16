<script lang="ts">
	import { LoaderCircle, MicVocal } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { api } from '$lib/client/api';
	import { player } from '$lib/client/player.svelte';
	import { activeLine, type LyricsDTO } from '$lib/lyrics';

	const SOURCE_LABEL: Record<string, string> = {
		embedded: 'From the file',
		lrc: 'From .lrc file',
		lrclib: 'From LRCLIB (not saved to the file)'
	};

	/** Lyrics already fetched this session, by library file id. */
	const cache = new Map<string, LyricsDTO>();
	let lyrics = $state<LyricsDTO | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	let box = $state<HTMLDivElement>();
	/** The user scrolled by hand: leave the view alone for a moment. */
	let manualUntil = 0;

	const id = $derived(player.current?.id ?? null);

	$effect(() => {
		const current = id;
		lyrics = current ? (cache.get(current) ?? null) : null;
		failed = false;
		if (!current || cache.has(current)) return;
		loading = true;
		api
			.get<LyricsDTO>(`/api/library/${current}/lyrics`, { quiet: true })
			.then((res) => {
				cache.set(current, res);
				if (id === current) lyrics = res;
			})
			.catch(() => id === current && (failed = true))
			.finally(() => id === current && (loading = false));
	});

	const active = $derived(lyrics?.synced ? activeLine(lyrics.lines, player.time + 0.15) : -1);

	$effect(() => {
		const i = active;
		if (i < 0 || !box || Date.now() < manualUntil) return;
		const el = box.querySelector<HTMLElement>(`[data-line="${i}"]`);
		if (!el) return;
		box.scrollTo({
			top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
			behavior: 'smooth'
		});
	});

	function onUserScroll() {
		manualUntil = Date.now() + 4000;
	}
</script>

<div
	transition:slide={{ duration: 180 }}
	class="glass mb-2 ml-auto flex max-h-[55dvh] w-full max-w-md flex-col !bg-ink-900"
>
	<div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
		<span class="panel-title flex items-center gap-1.5"
			><MicVocal class="h-3.5 w-3.5" /> Lyrics</span
		>
		{#if lyrics?.source}
			<span
				class="chip border-white/8 text-[10px] text-ink-400"
				title={SOURCE_LABEL[lyrics.source]}
			>
				{lyrics.synced ? 'Synced' : 'Plain'} · {lyrics.source === 'lrclib' ? 'LRCLIB' : 'Saved'}
			</span>
		{/if}
	</div>

	<div
		bind:this={box}
		class="relative min-h-24 flex-1 overflow-y-auto px-4 pb-6"
		role="region"
		aria-label="Lyrics"
		onwheel={onUserScroll}
		ontouchmove={onUserScroll}
	>
		{#if loading}
			<div class="flex items-center gap-2 py-6 text-xs text-ink-400">
				<LoaderCircle class="h-3.5 w-3.5 animate-spin" /> Looking for lyrics…
			</div>
		{:else if failed}
			<p class="py-6 text-xs text-bad">Couldn't load lyrics.</p>
		{:else if !lyrics?.lines.length}
			<p class="py-6 text-xs text-ink-400">
				No lyrics for this song. Studio › Art & lyrics can look them up again and save them.
			</p>
		{:else if lyrics.synced}
			<div class="py-[20%]">
				{#each lyrics.lines as line, i (i)}
					<button
						data-line={i}
						class="block w-full rounded-lg px-2 py-1.5 text-left text-[15px] leading-snug font-medium transition-all duration-300 hover:bg-ink-850
							{i === active ? 'text-amber' : i < active ? 'text-ink-400' : 'text-ink-200'}"
						title="Jump here"
						onclick={() => {
							manualUntil = 0;
							player.seek(line.time ?? 0);
						}}
					>
						{line.text || '♪'}
					</button>
				{/each}
			</div>
		{:else}
			<div class="space-y-1 py-2 text-[14px] leading-relaxed text-ink-200">
				{#each lyrics.lines as line, i (i)}
					<p class="min-h-[1em] px-2">{line.text}</p>
				{/each}
			</div>
		{/if}
	</div>
</div>
