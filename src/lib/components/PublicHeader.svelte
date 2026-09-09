<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		tournamentName,
		current
	}: {
		tournamentName: string;
		current: 'overview' | 'monitoring' | 'competition' | 'practice';
	} = $props();

	const links = [
		{ id: 'overview' as const, label: '大会概要', href: resolve('/') },
		{ id: 'monitoring' as const, label: 'モニタリング', href: resolve('/monitoring') },
		{ id: 'competition' as const, label: '競技', href: resolve('/competition') },
		{ id: 'practice' as const, label: '練習', href: resolve('/practice') }
	];
</script>

<header class="app-header public-header">
	<a class="header-brand" href={resolve('/')} aria-label={`KeySprint - ${tournamentName}`}>
		<img class="brand-logo" src="/KeySprint-logo_real.png" alt="KeySprint" />
		<h1 class="header-title">{tournamentName}</h1>
	</a>
	<nav class="public-nav" aria-label="メインナビゲーション">
		{#each links as link (link.id)}
			<a href={link.href} aria-current={current === link.id ? 'page' : undefined}>{link.label}</a>
		{/each}
	</nav>
</header>
