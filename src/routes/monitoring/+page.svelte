<script lang="ts">
	import { onMount } from 'svelte';
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import {
		webSocketUrl,
		type CompetitionServerMessage,
		type CompetitionSnapshot,
		type LaneSnapshot,
		type LaneStatus
	} from '$lib/competition/types';

	let { data } = $props();
	let selectedMatch = $state(1);
	let snapshot = $state<CompetitionSnapshot | null>(null);
	let connectionState = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
	let now = $state(Date.now());
	let clockOffset = $state(0);
	let webSocket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	let lanes = $derived(
		snapshot?.matchNumber === selectedMatch
			? snapshot.lanes
			: data.assignments
					.filter((assignment) => assignment.matchNumber === selectedMatch)
					.map(emptyLane)
	);

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 100);
		connect();
		return () => {
			stopped = true;
			clearInterval(clock);
			clearTimeout(reconnectTimer);
			webSocket?.close();
		};
	});

	function connect() {
		connectionState = 'connecting';
		const socket = new WebSocket(webSocketUrl());
		webSocket = socket;
		socket.addEventListener('open', () => {
			connectionState = 'connected';
			subscribe();
		});
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data)) as CompetitionServerMessage;
			if (message.type !== 'competition.snapshot') return;
			snapshot = message.data;
			clockOffset = message.data.serverTime - Date.now();
		});
		socket.addEventListener('close', () => {
			if (webSocket !== socket) return;
			connectionState = 'disconnected';
			if (!stopped) reconnectTimer = setTimeout(connect, 1_000);
		});
	}

	function subscribe() {
		if (webSocket?.readyState !== WebSocket.OPEN) return;
		webSocket.send(
			JSON.stringify({ type: 'monitor.subscribe', data: { matchNumber: selectedMatch } })
		);
	}

	function selectMatch(matchNumber: number) {
		selectedMatch = matchNumber;
		snapshot = null;
		subscribe();
	}

	function remainingSeconds() {
		if (!snapshot?.endsAt) return snapshot?.durationSeconds ?? 180;
		return Math.max(0, Math.ceil((snapshot.endsAt - (now + clockOffset)) / 1_000));
	}

	function formatTime(seconds: number) {
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function statusLabel(status: LaneStatus) {
		return {
			disconnected: '未接続',
			connected: '接続済み',
			ready: '準備完了',
			countdown: '開始待機',
			running: '競技中',
			finished: '終了',
			interrupted: '中断',
			force_finished: '強制終了',
			invalidated: '無効'
		}[status];
	}

	function emptyLane(assignment: (typeof data.assignments)[number]): LaneSnapshot {
		return {
			laneNumber: assignment.laneNumber,
			teamName: assignment.teamName,
			representativeSource: assignment.representativeSource,
			connected: false,
			ready: false,
			status: 'disconnected',
			problemIndex: 0,
			problemCount: 36,
			displayText: '待機中',
			reading: '',
			romanizedText: '',
			inputPosition: 0,
			correctTypes: 0,
			incorrectTypes: 0,
			completedProblems: 0,
			accuracy: 0,
			wpm: 0,
			rawScore: 0,
			score: 0,
			progress: 0,
			rank: null
		};
	}
</script>

<svelte:head>
	<title>モニタリング | {data.tournamentName}</title>
	<meta name="description" content={`${data.tournamentName}の競技モニタリング画面`} />
</svelte:head>

<PublicHeader tournamentName={data.tournamentName} current="monitoring" />

<main class="monitor-main">
	<div class="monitor-toolbar">
		<div class="match-tabs" role="tablist" aria-label="試合">
			{#each [1, 2, 3] as matchNumber (matchNumber)}
				<button
					type="button"
					role="tab"
					aria-selected={selectedMatch === matchNumber}
					class:is-active={selectedMatch === matchNumber}
					onclick={() => selectMatch(matchNumber)}>第{matchNumber}試合</button
				>
			{/each}
		</div>
		<div class="monitor-summary" aria-live="polite">
			<span class:online={connectionState === 'connected'}
				>{connectionState === 'connected' ? 'LIVE' : 'OFFLINE'}</span
			>
			<strong>{snapshot?.readyCount ?? 0}/6 準備</strong>
			<time>{formatTime(remainingSeconds())}</time>
		</div>
	</div>

	{#if lanes.length === 0}
		<section class="empty-state">
			<h1>第{selectedMatch}試合</h1>
			<p>試合情報はまだ設定されていません。</p>
		</section>
	{:else}
		<div class="monitor-grid" aria-label={`第${selectedMatch}試合 競技状況`}>
			{#each lanes as lane (lane.laneNumber)}
				<section
					class="monitor-lane"
					class:is-running={lane.status === 'running'}
					aria-label={`レーン${lane.laneNumber} ${lane.teamName}`}
				>
					<header>
						<div class="lane-identity">
							<strong class="monitor-lane-number">{lane.laneNumber}</strong>
							<div>
								<h2>{lane.teamName}</h2>
								<p>{lane.representativeSource}</p>
							</div>
						</div>
						<div class={`lane-status status-${lane.status}`}>
							<span>{statusLabel(lane.status)}</span>
							{#if lane.rank}<strong>{lane.rank}位</strong>{/if}
						</div>
					</header>

					<div class="monitor-problem">
						<p>{lane.displayText}</p>
						<div class="monitor-roman">
							<span>{lane.romanizedText.slice(0, lane.inputPosition)}</span
							>{lane.romanizedText.slice(lane.inputPosition)}
						</div>
					</div>

					<div class="lane-progress" aria-label={`進捗 ${lane.progress.toFixed(0)}%`}>
						<span style={`width: ${lane.progress}%`}></span>
					</div>
					<dl class="monitor-metrics">
						<div>
							<dt>正タイプ</dt>
							<dd>{lane.correctTypes}</dd>
						</div>
						<div>
							<dt>ミス</dt>
							<dd>{lane.incorrectTypes}</dd>
						</div>
						<div>
							<dt>速度</dt>
							<dd>{lane.wpm.toFixed(0)}</dd>
						</div>
						<div>
							<dt>正確率</dt>
							<dd>{(lane.accuracy * 100).toFixed(1)}%</dd>
						</div>
					</dl>
				</section>
			{/each}
		</div>
	{/if}
</main>
