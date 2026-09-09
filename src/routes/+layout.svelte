<script lang="ts">
	import '../app.css';
	import '../brand.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/KeySprint-logo-icon_real.png" />
	<link rel="apple-touch-icon" href="/KeySprint-logo-icon_real.png" />
	<meta name="theme-color" content="#071225" />
</svelte:head>

{@render children()}

<style>
	:global(.romanized-input span) {
		color: #0b4d86;
		background: #dff2ff;
	}
</style>
