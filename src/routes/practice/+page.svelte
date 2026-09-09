<script lang="ts">
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import {
		applyTypingEvent,
		createTypingState,
		getTypingView
	} from '$lib/competition/typing-engine.js';
	import { calculateScore } from '$lib/competition/scoring.js';
	import { shuffleProblems } from '$lib/practice/shuffle.js';
	import { onMount, tick, untrack } from 'svelte';

	let { data } = $props();
	const durationSeconds = 180;
	const countdownSeconds = 3;
	const practicePresets = untrack(() => data.presets);
	const codeProblems = untrack(() => data.codeProblems);
	let practiceMode = $state<'typing' | 'c'>('typing');
	let selectedPresetId = $state(practicePresets[0].id);
	let status = $state<'idle' | 'countdown' | 'running' | 'finished'>('idle');
	let now = $state(Date.now());
	let startsAt = $state(0);
	let endsAt = $state(0);
	let typingState = createTypingState(practicePresets[0].problems);
	let view = $state(getTypingView(typingState));
	let lastInputCorrect = $state<boolean | null>(null);
	let typingSurface = $state<HTMLInputElement>();

	onMount(() => {
		const timer = setInterval(() => {
			if (status !== 'countdown' && status !== 'running') return;
			now = Math.min(Date.now(), endsAt);
			if (now >= endsAt) {
				status = 'finished';
				return;
			}
			if (status === 'countdown' && now >= startsAt) {
				status = 'running';
				void tick().then(() => typingSurface?.focus());
			}
		}, 100);
		return () => clearInterval(timer);
	});

	function startPractice() {
		const problems =
			practiceMode === 'c' ? codeProblems : shuffleProblems(selectedPreset().problems);
		typingState = createTypingState(problems);
		view = getTypingView(typingState);
		lastInputCorrect = null;
		const countdownStartedAt = Date.now();
		startsAt = countdownStartedAt + countdownSeconds * 1_000;
		endsAt = startsAt + durationSeconds * 1_000;
		now = countdownStartedAt;
		status = 'countdown';
	}

	function stopPractice() {
		if (status === 'countdown') {
			status = 'idle';
			startsAt = 0;
			endsAt = 0;
			now = Date.now();
			return;
		}
		if (status !== 'running') return;
		now = Math.min(Date.now(), endsAt);
		status = 'finished';
	}

	function changePracticeMode(event: Event & { currentTarget: HTMLSelectElement }) {
		practiceMode = event.currentTarget.value as 'typing' | 'c';
		resetProblems();
	}

	function changePreset(event: Event & { currentTarget: HTMLSelectElement }) {
		selectedPresetId = event.currentTarget.value;
		resetProblems();
	}

	function selectedPreset() {
		return practicePresets.find((preset) => preset.id === selectedPresetId) ?? practicePresets[0];
	}

	function resetProblems() {
		typingState = createTypingState(
			practiceMode === 'c' ? codeProblems : selectedPreset().problems
		);
		view = getTypingView(typingState);
		lastInputCorrect = null;
		status = 'idle';
	}

	function handleStartShortcut(event: KeyboardEvent) {
		if (status !== 'idle' && status !== 'finished') return;
		if (event.key !== ' ' && event.key !== 'Enter') return;
		if (
			event.defaultPrevented ||
			event.repeat ||
			event.isComposing ||
			event.shiftKey ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey
		) {
			return;
		}
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('button, select, textarea, a, input:not(.typing-capture)')
		) {
			return;
		}
		event.preventDefault();
		startPractice();
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
		if (status === 'idle' || status === 'countdown') return durationSeconds;
		return Math.max(0, Math.ceil((endsAt - now) / 1_000));
	}

	function countdown() {
		if (status !== 'countdown') return 0;
		return Math.max(0, Math.ceil((startsAt - now) / 1_000));
	}

	function elapsedMinutes() {
		if (status === 'idle' || status === 'countdown') return 0;
		return Math.max(1 / 60, (Math.min(now, endsAt) - startsAt) / 60_000);
	}

	function wpm() {
		const elapsed = elapsedMinutes();
		return elapsed === 0 ? 0 : view.correctTypes / 5 / elapsed;
	}

	function accuracy() {
		const total = view.correctTypes + view.incorrectTypes;
		return total === 0 ? 0 : view.correctTypes / total;
	}

	function score() {
		return calculateScore(view.correctTypes, view.incorrectTypes, durationSeconds);
	}

	function formatTime(seconds: number) {
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function statusText() {
		if (status === 'idle') return '開始前';
		if (status === 'countdown') return `${countdown()}`;
		if (status === 'running') return '練習中';
		return '練習終了';
	}

	function inputGuideText() {
		return practiceMode === 'c' ? view.displayText : view.romanizedText;
	}

	function inputGuidePosition() {
		if (practiceMode !== 'c') return view.inputPosition;
		let sourceIndex = 0;
		let inputIndex = 0;
		while (sourceIndex < view.displayText.length && inputIndex < view.inputPosition) {
			if (view.displayText[sourceIndex] !== ' ') inputIndex += 1;
			sourceIndex += 1;
		}
		return sourceIndex;
	}
</script>

<svelte:window onkeydown={handleStartShortcut} />

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
				<select
					value={practiceMode}
					disabled={status === 'countdown' || status === 'running'}
					onchange={changePracticeMode}
				>
					<option value="typing">タイピング</option>
					<option value="c">C言語写経</option>
				</select>
			</label>
			<label>
				<span>問題プリセット</span>
				<select
					aria-label="問題プリセット"
					value={selectedPresetId}
					disabled={status === 'countdown' || status === 'running' || practiceMode === 'c'}
					onchange={changePreset}
				>
					{#each practicePresets as preset (preset.id)}
						<option value={preset.id}>{preset.category}：{preset.title}</option>
					{/each}
				</select>
			</label>
			{#if status === 'countdown' || status === 'running'}
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
			<span class="practice-status" aria-live="polite">{statusText()}</span>
			<time>{formatTime(remainingSeconds())}</time>
		</header>

		<div class="practice-stage">
			{#if status === 'finished'}
				<div class="practice-result-panel" role="status">
					<p class="eyebrow">RESULT</p>
					<h2>練習結果</h2>
					<strong>{view.completedProblems}<small>問完了</small></strong>
					<dl>
						<div>
							<dt>スコア</dt>
							<dd>{score()}</dd>
						</div>
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
							<dd>{wpm().toFixed(1)} WPM</dd>
						</div>
						<div>
							<dt>正確率</dt>
							<dd>{(accuracy() * 100).toFixed(1)}%</dd>
						</div>
					</dl>
				</div>
			{:else}
				<p class="problem-counter">問題 {view.problemIndex + 1} / {view.problemCount}</p>
				<p class="problem-text" class:is-code={practiceMode === 'c'}>{view.displayText}</p>
				{#if practiceMode === 'typing'}<p class="problem-reading">{view.reading}</p>{/if}
				<p class="romanized-input" class:is-code={practiceMode === 'c'}>
					<span>{inputGuideText().slice(0, inputGuidePosition())}</span>{inputGuideText().slice(
						inputGuidePosition()
					)}
				</p>
			{/if}
		</div>

		{#if status === 'idle'}
			<p class="practice-overlay">「練習を開始」を押すか、Space / Enter キーを押してください</p>
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
