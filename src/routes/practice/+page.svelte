<script lang="ts">
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import {
		applyTypingEvent,
		createTypingState,
		getTypingView
	} from '$lib/competition/typing-engine.js';
	import { onMount, tick, untrack } from 'svelte';

	let { data } = $props();
	const durationSeconds = 180;
	const practiceProblems = untrack(() => data.problems);
	const codeProblems = untrack(() => data.codeProblems);
	let practiceMode = $state<'typing' | 'c'>('typing');
	let status = $state<'idle' | 'running' | 'finished'>('idle');
	let now = $state(Date.now());
	let startsAt = $state(0);
	let endsAt = $state(0);
	let typingState = createTypingState(practiceProblems);
	let view = $state(getTypingView(typingState));
	let lastInputCorrect = $state<boolean | null>(null);
	let typingSurface = $state<HTMLInputElement>();

	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
			if (status === 'running' && now >= endsAt) status = 'finished';
		}, 100);
		return () => clearInterval(timer);
	});

	function startPractice() {
		typingState = createTypingState(practiceMode === 'c' ? codeProblems : practiceProblems);
		view = getTypingView(typingState);
		lastInputCorrect = null;
		startsAt = Date.now();
		endsAt = startsAt + durationSeconds * 1_000;
		now = startsAt;
		status = 'running';
		void tick().then(() => typingSurface?.focus());
	}

	function stopPractice() {
		if (status !== 'running') return;
		now = Math.min(Date.now(), endsAt);
		status = 'finished';
	}

	function changePracticeMode(event: Event & { currentTarget: HTMLSelectElement }) {
		practiceMode = event.currentTarget.value as 'typing' | 'c';
		typingState = createTypingState(practiceMode === 'c' ? codeProblems : practiceProblems);
		view = getTypingView(typingState);
		lastInputCorrect = null;
		status = 'idle';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (status !== 'running') return;
		event.preventDefault();
		if (practiceMode === 'c' && event.key === ' ') return;
		const receivedAt = Date.now();
		const result = applyTypingEvent(
			typingState,
			{
				type: 'key',
				key: event.key,
				repeat: event.repeat,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				meta: event.metaKey,
				composing: event.isComposing
			},
			receivedAt,
			startsAt,
			endsAt
		);
		if (!result.accepted) return;
		lastInputCorrect = result.correct ?? null;
		view = getTypingView(typingState);
	}

	function remainingSeconds() {
		if (status === 'idle') return durationSeconds;
		return Math.max(0, Math.ceil((endsAt - now) / 1_000));
	}

	function elapsedMinutes() {
		if (status === 'idle') return 0;
		return Math.max(1 / 60, (Math.min(now, endsAt) - startsAt) / 60_000);
	}

	function wpm() {
		return view.correctTypes / 5 / elapsedMinutes();
	}

	function accuracy() {
		const total = view.correctTypes + view.incorrectTypes;
		return total === 0 ? 1 : view.correctTypes / total;
	}

	function formatTime(seconds: number) {
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>タイピング練習 | {data.tournamentName}</title>
	<meta name="description" content="大会と同じ入力ルールでタイピングを練習できます" />
</svelte:head>

<PublicHeader tournamentName={data.tournamentName} current="practice" />

<main class="practice-main">
	<section class="practice-intro" aria-labelledby="practice-heading">
		<div>
			<p class="eyebrow">PRACTICE</p>
			<h1 id="practice-heading">タイピング練習</h1>
			<p>本番と同じ180秒で、通常入力またはC言語の写経を練習できます。</p>
		</div>
		<div class="practice-controls">
			<label>
				<span>練習モード</span>
				<select value={practiceMode} disabled={status === 'running'} onchange={changePracticeMode}>
					<option value="typing">タイピング</option>
					<option value="c">C言語写経</option>
				</select>
			</label>
			{#if status === 'running'}
				<button class="danger-button" type="button" onclick={stopPractice}>練習を停止</button>
			{:else}
				<button class="primary-button" type="button" onclick={startPractice}>
					{status === 'idle' ? '練習を開始' : 'もう一度練習'}
				</button>
			{/if}
		</div>
	</section>

	<section
		class="practice-terminal"
		class:is-running={status === 'running'}
		class:is-incorrect={lastInputCorrect === false}
		aria-label="タイピング練習画面"
	>
		<input
			class="typing-capture"
			aria-label="練習入力"
			readonly
			value=""
			bind:this={typingSurface}
			onkeydown={handleKeydown}
			onpaste={(event) => event.preventDefault()}
			oncontextmenu={(event) => event.preventDefault()}
		/>
		<header>
			<span class="practice-status">
				{status === 'idle' ? '開始前' : status === 'running' ? '練習中' : '練習終了'}
			</span>
			<time>{formatTime(remainingSeconds())}</time>
		</header>

		<div class="practice-stage">
			<p class="problem-counter">問題 {view.problemIndex + 1} / {view.problemCount}</p>
			<p class="problem-text" class:is-code={practiceMode === 'c'}>{view.displayText}</p>
			{#if practiceMode === 'typing'}<p class="problem-reading">{view.reading}</p>{/if}
			<p class="romanized-input">
				<span>{view.romanizedText.slice(0, view.inputPosition)}</span>{view.romanizedText.slice(
					view.inputPosition
				)}
			</p>
		</div>

		{#if status === 'idle'}
			<p class="practice-overlay">「練習を開始」を押してください</p>
		{:else if status === 'finished'}
			<div class="practice-summary" role="status">
				<strong>練習終了</strong>
				<span>{view.completedProblems}問完了・{wpm().toFixed(1)} WPM</span>
			</div>
		{/if}

		<dl class="typing-metrics">
			<div>
				<dt>正タイプ</dt>
				<dd>{view.correctTypes}</dd>
			</div>
			<div>
				<dt>ミス</dt>
				<dd>{view.incorrectTypes}</dd>
			</div>
			<div>
				<dt>入力速度</dt>
				<dd>{wpm().toFixed(0)}</dd>
			</div>
			<div>
				<dt>正確率</dt>
				<dd>{(accuracy() * 100).toFixed(1)}%</dd>
			</div>
		</dl>
	</section>
</main>
