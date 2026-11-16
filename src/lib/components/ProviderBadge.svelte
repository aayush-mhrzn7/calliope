<script lang="ts">
	let { kind }: { provider?: string; kind?: string } = $props();
</script>

<span class="chip border-ink-600 text-ink-300">
	YouTube{kind ? ` · ${kind}` : ''}
</span>
