<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Calliope</title>
</svelte:head>

{@render children()}
