<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		tournamentName,
		current
	}: { tournamentName: string; current: 'overview' | 'monitoring' | 'competition' } = $props();

	const links = [
		{ id: 'overview' as const, label: '大会概要', href: resolve('/') },
		{ id: 'monitoring' as const, label: 'モニタリング', href: resolve('/monitoring') },
		{ id: 'competition' as const, label: '競技', href: resolve('/competition') }
	];
</script>

<header class="app-header public-header">
	<a class="header-brand" href={resolve('/')}>
		<span class="product-name">Typing System</span>
		<h1 class="header-title">{tournamentName}</h1>
	</a>
	<nav class="public-nav" aria-label="メインナビゲーション">
		{#each links as link (link.id)}
			<a href={link.href} aria-current={current === link.id ? 'page' : undefined}>{link.label}</a>
		{/each}
	</nav>
</header>
