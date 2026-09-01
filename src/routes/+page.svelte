<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import { webSocketUrl, type CompetitionServerMessage } from '$lib/competition/types';
	import { onMount } from 'svelte';

	let { data } = $props();

	onMount(() => {
		let stopped = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			socket = new WebSocket(webSocketUrl());
			socket.addEventListener('open', () => {
				socket?.send(JSON.stringify({ type: 'results.subscribe' }));
			});
			socket.addEventListener('message', (event) => {
				const message = JSON.parse(event.data) as CompetitionServerMessage;
				if (
					message.type === 'competition.finished' ||
					message.type === 'competition.confirmed' ||
					message.type === 'competition.invalidated' ||
					message.type === 'competition.disqualified' ||
					message.type === 'competition.retry-prepared'
				) {
					void invalidateAll();
				}
			});
			socket.addEventListener('close', () => {
				if (!stopped) reconnectTimer = setTimeout(connect, 1_000);
			});
		};

		connect();
		return () => {
			stopped = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			socket?.close();
		};
	});
</script>

<svelte:head>
	<title>{data.tournamentName} | Typing System</title>
	<meta name="description" content={`${data.tournamentName}の競技タイピング運営画面`} />
</svelte:head>

<PublicHeader tournamentName={data.tournamentName} current="overview" />

<main>
	<section aria-labelledby="participants-heading">
		<p class="eyebrow">TOURNAMENT</p>
		<h2 id="participants-heading">出場枠</h2>

		<div class="participant-table">
			<div class="participant-row participant-header" aria-hidden="true">
				<span>チーム</span>
				<span>出場クラス</span>
				<span>出場ID</span>
			</div>
			{#each data.teams as team (team.name)}
				<div class="participant-row">
					<strong>{team.name}</strong>
					<span>{team.representativeSources.join(' / ')}</span>
					<div class="participant-ids">
						{#each team.participantSlots as participant (participant.id)}
							<code>{participant.id}</code>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section aria-labelledby="operation-heading">
		<p class="eyebrow">MATCHES</p>
		<h2 id="operation-heading">試合・レーン情報</h2>

		{#if data.assignments.length > 0}
			<div class="match-schedule">
				{#each [1, 2, 3] as matchNumber (matchNumber)}
					{@const matchResults = data.results.filter(
						(result) => result.matchNumber === matchNumber
					)}
					<section class="scheduled-match" aria-labelledby={`public-match-${matchNumber}-heading`}>
						<div class="match-heading">
							<h3 id={`public-match-${matchNumber}-heading`}>第{matchNumber}試合</h3>
							{#if data.confirmedMatchNumbers.includes(matchNumber)}
								<span>確定</span>
							{:else if matchResults.length === 6}
								<span>未確定</span>
							{/if}
						</div>
						<div class="lane-table">
							<div class="lane-row lane-header" aria-hidden="true">
								<span>レーン</span>
								<span>チーム</span>
								<span>出場クラス</span>
								<span>スコア</span>
								<span>順位</span>
							</div>
							{#each data.assignments.filter((assignment) => assignment.matchNumber === matchNumber) as assignment (`${assignment.matchNumber}-${assignment.teamName}`)}
								{@const result = matchResults.find(
									(matchResult) => matchResult.laneNumber === assignment.laneNumber
								)}
								<div class="lane-row">
									<strong class="lane-number">{assignment.laneNumber}</strong>
									<span>{assignment.teamName}</span>
									<code>{assignment.representativeSource}</code>
									<strong class="lane-score">{result ? result.score.toLocaleString() : '-'}</strong>
									<strong class="lane-rank">
										{result ? (result.disqualified ? '失格' : `${result.rank}位`) : '-'}
									</strong>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				<p>試合情報はまだ設定されていません。</p>
			</div>
		{/if}
	</section>

	{#if data.teamStandings.length > 0}
		<section aria-labelledby="overall-heading">
			<p class="eyebrow">OVERALL</p>
			<h2 id="overall-heading">総合順位</h2>

			<div class="overall-table">
				<div class="overall-row overall-header" aria-hidden="true">
					<span>順位</span>
					<span>チーム</span>
					<span>第1試合</span>
					<span>第2試合</span>
					<span>第3試合</span>
					<span>合計</span>
				</div>
				{#each data.teamStandings as standing (standing.teamName)}
					<div class="overall-row">
						<strong class="overall-rank">{standing.rank}位</strong>
						<strong class="overall-team">{standing.teamName}</strong>
						<span class="overall-match-score"
							><small>第1試合</small>{standing.matchScores[0].toLocaleString()}</span
						>
						<span class="overall-match-score"
							><small>第2試合</small>{standing.matchScores[1].toLocaleString()}</span
						>
						<span class="overall-match-score"
							><small>第3試合</small>{standing.matchScores[2].toLocaleString()}</span
						>
						<strong class="overall-total"
							><small>合計</small>{standing.totalScore.toLocaleString()}</strong
						>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</main>
