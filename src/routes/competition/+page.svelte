<script lang="ts">
	import { onMount, tick } from 'svelte';
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import {
		webSocketUrl,
		type CompetitionServerMessage,
		type CompetitionSnapshot,
		type LaneSnapshot
	} from '$lib/competition/types';

	let { data } = $props();
	let selectedMatch = $state(1);
	let selectedClass = $state('');
	let snapshot = $state<CompetitionSnapshot | null>(null);
	let connectionState = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
	let errorMessage = $state('');
	let lastInputCorrect = $state<boolean | null>(null);
	let now = $state(Date.now());
	let clockOffset = $state(0);
	let webSocket: WebSocket | null = null;
	let typingSurface = $state<HTMLInputElement>();
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let connectionAttempt = 0;
	let stopped = false;
	let shouldReconnect = false;
	const terminalStorageKey = 'typing-system:competition-terminal';

	let availableAssignments = $derived(
		data.assignments.filter((candidate) => candidate.matchNumber === selectedMatch)
	);
	let effectiveSelectedClass = $derived(
		availableAssignments.some((candidate) => candidate.representativeSource === selectedClass)
			? selectedClass
			: (availableAssignments[0]?.representativeSource ?? '')
	);
	let assignment = $derived(
		data.assignments.find(
			(candidate) =>
				candidate.matchNumber === selectedMatch &&
				candidate.representativeSource === effectiveSelectedClass
		)
	);
	let selectedLane = $derived(assignment?.laneNumber ?? 0);
	let ownLane = $derived<LaneSnapshot | undefined>(
		snapshot?.matchNumber === selectedMatch
			? snapshot.lanes.find((lane) => lane.laneNumber === selectedLane)
			: undefined
	);
	let selectionLocked = $derived(
		ownLane?.ready || snapshot?.status === 'countdown' || snapshot?.status === 'running'
	);

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 100);
		const storedTerminal = readStoredTerminal();
		if (
			storedTerminal &&
			data.assignments.some(
				(assignment) =>
					assignment.matchNumber === storedTerminal.matchNumber &&
					assignment.representativeSource === storedTerminal.representativeSource
			)
		) {
			selectedMatch = storedTerminal.matchNumber;
			selectedClass = storedTerminal.representativeSource;
			if (storedTerminal.connected) {
				void tick().then(() => {
					if (!stopped && assignment) {
						shouldReconnect = true;
						openSocket();
					}
				});
			}
		}
		return () => {
			stopped = true;
			shouldReconnect = false;
			clearInterval(clock);
			clearTimeout(reconnectTimer);
			webSocket?.close();
		};
	});

	$effect(() => {
		if (ownLane?.status === 'running') typingSurface?.focus();
	});

	function connectTerminal() {
		if (!assignment) return;
		shouldReconnect = false;
		webSocket?.close();
		shouldReconnect = true;
		writeStoredTerminal(true);
		openSocket();
	}

	function openSocket() {
		const attempt = ++connectionAttempt;
		const matchNumber = selectedMatch;
		const laneNumber = selectedLane;
		connectionState = 'connecting';
		errorMessage = '';
		const socket = new WebSocket(webSocketUrl());
		webSocket = socket;
		socket.addEventListener('open', () => {
			if (attempt !== connectionAttempt) return;
			connectionState = 'connected';
			socket.send(
				JSON.stringify({
					type: 'typing.join',
					data: { matchNumber, laneNumber }
				})
			);
		});
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data)) as CompetitionServerMessage;
			if (message.type === 'competition.snapshot') {
				snapshot = message.data;
				clockOffset = message.data.serverTime - Date.now();
			}
			if (message.type === 'typing.input-result') {
				lastInputCorrect = message.data.correct ?? null;
			}
			if (message.type === 'system.error') {
				connectionState = 'error';
				errorMessage =
					message.data.code === 'lane_reconnected'
						? 'この出場クラスは別の端末で接続されました。'
						: '競技端末を接続できませんでした。';
				if (message.data.code === 'lane_reconnected') {
					shouldReconnect = false;
					writeStoredTerminal(false);
					socket.close();
				}
			}
		});
		socket.addEventListener('close', () => {
			if (attempt !== connectionAttempt || stopped) return;
			if (connectionState !== 'error') connectionState = 'connecting';
			if (shouldReconnect) reconnectTimer = setTimeout(openSocket, 1_000);
		});
	}

	function ready() {
		if (webSocket?.readyState !== WebSocket.OPEN) return;
		webSocket.send(JSON.stringify({ type: 'typing.ready' }));
	}

	function changeMatch(event: Event & { currentTarget: HTMLSelectElement }) {
		disconnectTerminal();
		selectedMatch = Number(event.currentTarget.value);
		selectedClass = '';
		writeStoredTerminal(false);
	}

	function changeClass(event: Event & { currentTarget: HTMLSelectElement }) {
		disconnectTerminal();
		selectedClass = event.currentTarget.value;
		writeStoredTerminal(false);
	}

	function disconnectTerminal() {
		shouldReconnect = false;
		connectionAttempt += 1;
		webSocket?.close();
		webSocket = null;
		snapshot = null;
		connectionState = 'idle';
		errorMessage = '';
	}

	function writeStoredTerminal(connected: boolean) {
		const representativeSource = effectiveSelectedClass;
		if (!representativeSource) return;
		sessionStorage.setItem(
			terminalStorageKey,
			JSON.stringify({ matchNumber: selectedMatch, representativeSource, connected })
		);
	}

	function readStoredTerminal(): {
		matchNumber: number;
		representativeSource: string;
		connected: boolean;
	} | null {
		try {
			const value = JSON.parse(sessionStorage.getItem(terminalStorageKey) ?? 'null') as unknown;
			if (!value || typeof value !== 'object') return null;
			const stored = value as Record<string, unknown>;
			if (
				!Number.isInteger(stored.matchNumber) ||
				Number(stored.matchNumber) < 1 ||
				Number(stored.matchNumber) > 3 ||
				typeof stored.representativeSource !== 'string' ||
				typeof stored.connected !== 'boolean'
			) {
				return null;
			}
			return {
				matchNumber: Number(stored.matchNumber),
				representativeSource: stored.representativeSource,
				connected: stored.connected
			};
		} catch {
			return null;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (ownLane?.status !== 'running' || webSocket?.readyState !== WebSocket.OPEN) return;
		event.preventDefault();
		webSocket.send(
			JSON.stringify({
				type: 'typing.input',
				data: {
					key: event.key,
					repeat: event.repeat,
					shift: event.shiftKey,
					ctrl: event.ctrlKey,
					alt: event.altKey,
					meta: event.metaKey,
					composing: event.isComposing
				}
			})
		);
	}

	function remainingSeconds() {
		if (!snapshot?.endsAt) return snapshot?.durationSeconds ?? 180;
		return Math.max(0, Math.ceil((snapshot.endsAt - (now + clockOffset)) / 1_000));
	}

	function countdown() {
		if (!snapshot?.startsAt) return 0;
		return Math.max(0, Math.ceil((snapshot.startsAt - (now + clockOffset)) / 1_000));
	}

	function formatTime(seconds: number) {
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function statusText() {
		if (connectionState === 'idle') return '端末未接続';
		if (connectionState === 'connecting') return '接続中';
		if (connectionState === 'error') return '接続エラー';
		if (snapshot?.status === 'finished') return '競技終了';
		if (snapshot?.status === 'interrupted') return '競技中断';
		if (snapshot?.status === 'force_finished') return '強制終了';
		if (snapshot?.status === 'invalidated') return '試技無効';
		if (snapshot?.status === 'countdown') return `${countdown()}`;
		if (ownLane?.status === 'running') return '競技中';
		if (ownLane?.ready) return '全員の準備を待っています';
		return '接続済み';
	}
</script>

<svelte:head>
	<title>競技 | {data.tournamentName}</title>
	<meta name="description" content={`${data.tournamentName}のタイピング競技画面`} />
</svelte:head>

<PublicHeader tournamentName={data.tournamentName} current="competition" />

<main class="competition-main">
	<section class="terminal-setup" aria-labelledby="terminal-heading">
		<div>
			<p class="eyebrow">PLAYER TERMINAL</p>
			<h1 id="terminal-heading">競技端末</h1>
		</div>
		<label>
			<span>試合</span>
			<select value={selectedMatch} disabled={selectionLocked} onchange={changeMatch}>
				{#each [1, 2, 3] as matchNumber (matchNumber)}<option value={matchNumber}
						>第{matchNumber}試合</option
					>{/each}
			</select>
		</label>
		<label>
			<span>出場クラス</span>
			<select value={effectiveSelectedClass} disabled={selectionLocked} onchange={changeClass}>
				{#each availableAssignments as candidate (`${candidate.matchNumber}-${candidate.representativeSource}`)}<option
						value={candidate.representativeSource}
						>{candidate.representativeSource}（{candidate.teamName}）</option
					>{/each}
			</select>
		</label>
		<button type="button" onclick={connectTerminal} disabled={!assignment || selectionLocked}>
			端末を接続
		</button>
	</section>

	{#if !assignment}
		<section class="empty-state">
			<p>選択した試合の出場クラス情報が設定されていません。</p>
		</section>
	{:else}
		<div
			class="typing-terminal"
			class:is-running={ownLane?.status === 'running'}
			class:is-incorrect={lastInputCorrect === false}
		>
			<input
				class="typing-capture"
				aria-label="タイピング入力"
				readonly
				value=""
				bind:this={typingSurface}
				onkeydown={handleKeydown}
				onpaste={(event) => event.preventDefault()}
				oncopy={(event) => event.preventDefault()}
				oncut={(event) => event.preventDefault()}
				ondrop={(event) => event.preventDefault()}
				oncontextmenu={(event) => event.preventDefault()}
			/>
			<header class="terminal-header">
				<div>
					<p>レーン {selectedLane}</p>
					<h2>{assignment.teamName} <span>{assignment.representativeSource}</span></h2>
				</div>
				<div class="terminal-status" aria-live="polite">{statusText()}</div>
				<time>{formatTime(remainingSeconds())}</time>
			</header>

			<div class="typing-stage">
				<p class="problem-counter">
					問題 {(ownLane?.problemIndex ?? 0) + 1} / {ownLane?.problemCount ?? 36}
				</p>
				<p class="problem-text">{ownLane?.displayText ?? '競技開始を待っています'}</p>
				<p class="problem-reading">{ownLane?.reading ?? ''}</p>
				<p class="romanized-input">
					<span>{ownLane?.romanizedText.slice(0, ownLane.inputPosition) ?? ''}</span
					>{ownLane?.romanizedText.slice(ownLane.inputPosition) ?? ''}
				</p>
			</div>

			{#if snapshot?.status === 'finished' && ownLane?.rank}
				<div class="competition-result" role="status">
					<p>最終順位</p>
					<strong>{ownLane.rank}<span>位</span></strong>
					<small>総合スコア {ownLane.score}</small>
				</div>
			{/if}

			{#if connectionState === 'connected' && !ownLane?.ready && snapshot?.status !== 'finished'}
				<div class="ready-action">
					<button type="button" class="primary-button" onclick={ready}>準備完了</button>
				</div>
			{/if}
			{#if errorMessage}<p class="terminal-error" role="alert">{errorMessage}</p>{/if}

			<dl class="typing-metrics">
				<div>
					<dt>正タイプ</dt>
					<dd>{ownLane?.correctTypes ?? 0}</dd>
				</div>
				<div>
					<dt>ミス</dt>
					<dd>{ownLane?.incorrectTypes ?? 0}</dd>
				</div>
				<div>
					<dt>入力速度</dt>
					<dd>{ownLane?.wpm.toFixed(0) ?? '0'}</dd>
				</div>
				<div>
					<dt>正確率</dt>
					<dd>{((ownLane?.accuracy ?? 0) * 100).toFixed(1)}%</dd>
				</div>
			</dl>
		</div>
	{/if}
</main>
