<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		webSocketUrl,
		type CompetitionAdminStatus,
		type CompetitionServerMessage,
		type CompetitionStatus
	} from '$lib/competition/types';
	import { onMount } from 'svelte';

	let { data, form } = $props();
	let currentAssignments = $derived(form?.assignments ?? data.assignments);
	let historyMatch = $state(0);
	let competitionStatuses = $state<CompetitionAdminStatus[]>(
		[1, 2, 3].map((matchNumber) => ({
			matchNumber,
			attemptNumber: 1,
			problemSetId: '',
			status: 'waiting',
			connectedCount: 0,
			readyCount: 0
		}))
	);

	function assignmentFor(matchNumber: number, teamName: string) {
		return currentAssignments.find(
			(assignment) => assignment.matchNumber === matchNumber && assignment.teamName === teamName
		);
	}

	function resultsFor(matchNumber: number) {
		return data.results.filter((result) => result.matchNumber === matchNumber);
	}

	function confirmationFor(matchNumber: number) {
		return data.confirmations.find((confirmation) => confirmation.matchNumber === matchNumber);
	}

	function competitionStatusFor(matchNumber: number) {
		return competitionStatuses.find((status) => status.matchNumber === matchNumber)!;
	}

	function displayedStatus(matchNumber: number): CompetitionStatus {
		return resultsFor(matchNumber).length === 6 &&
			competitionStatusFor(matchNumber).status === 'waiting'
			? 'finished'
			: competitionStatusFor(matchNumber).status;
	}

	function assignmentLocked(matchNumber: number) {
		return (
			data.attempts.some((attempt) => attempt.matchNumber === matchNumber) ||
			competitionStatusFor(matchNumber).status !== 'waiting'
		);
	}

	function statusLabel(status: CompetitionStatus) {
		return {
			waiting: '準備待ち',
			countdown: '開始待機',
			running: '競技中',
			finished: '終了',
			interrupted: '中断',
			force_finished: '強制終了',
			invalidated: '無効'
		}[status];
	}

	function canStart(matchNumber: number) {
		const status = competitionStatusFor(matchNumber);
		return (
			displayedStatus(matchNumber) === 'waiting' &&
			status.connectedCount === 6 &&
			status.readyCount === 6
		);
	}

	function startSubmission(event: SubmitEvent, matchNumber: number) {
		if (!window.confirm(`第${matchNumber}試合を一括開始します。よろしいですか？`)) {
			event.preventDefault();
		}
	}

	function confirmSubmission(event: SubmitEvent, matchNumber: number) {
		if (!window.confirm(`第${matchNumber}試合の結果を確定します。よろしいですか？`)) {
			event.preventDefault();
		}
	}

	function operationSubmission(event: SubmitEvent, matchNumber: number, label: string) {
		if (!window.confirm(`第${matchNumber}試合を${label}します。よろしいですか？`)) {
			event.preventDefault();
		}
	}

	function operationLabel(action: string) {
		return (
			{
				start: '開始',
				interrupt: '中断',
				force_finish: '強制終了',
				invalidate: '無効化',
				retry: '再試合設定',
				disqualify: '失格',
				confirm: '結果確定'
			}[action] ?? action
		);
	}

	function operationStatusLabel(status: string | null) {
		if (!status) return '-';
		return (
			{
				waiting: '準備待ち',
				running: '競技中',
				countdown: '開始待機',
				finished: '終了',
				unconfirmed: '未確定',
				confirmed: '確定',
				interrupted: '中断',
				force_finished: '強制終了',
				invalidated: '無効',
				retry_waiting: '再試合準備',
				disqualified: '失格',
				replaced: '差し替え済み'
			}[status] ?? status
		);
	}

	function attemptsForHistory() {
		return data.attempts
			.filter((attempt) => historyMatch === 0 || attempt.matchNumber === historyMatch)
			.slice()
			.sort(
				(left, right) =>
					right.matchNumber - left.matchNumber || right.attemptNumber - left.attemptNumber
			);
	}

	function attemptResultsFor(matchNumber: number, attemptNumber: number) {
		return data.attemptResults.filter(
			(result) => result.matchNumber === matchNumber && result.attemptNumber === attemptNumber
		);
	}

	function operationsForHistory() {
		return data.operations.filter(
			(operation) => historyMatch === 0 || operation.matchNumber === historyMatch
		);
	}

	function formatAuditTime(value: Date | null) {
		return value?.toLocaleString('ja-JP') ?? '-';
	}

	function attemptDuration(startedAt: Date | null, endedAt: Date | null) {
		if (!startedAt || !endedAt) return '-';
		return `${Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1_000).toFixed(1)}秒`;
	}

	onMount(() => {
		let stopped = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			socket = new WebSocket(webSocketUrl());
			socket.addEventListener('open', () => {
				socket?.send(JSON.stringify({ type: 'admin.subscribe' }));
			});
			socket.addEventListener('message', (event) => {
				const message = JSON.parse(event.data) as CompetitionServerMessage;
				if (message.type === 'competition.admin-status') {
					const stateChanged = message.data.matches.some(
						(status) =>
							status.status !== competitionStatusFor(status.matchNumber).status ||
							status.attemptNumber !== competitionStatusFor(status.matchNumber).attemptNumber
					);
					competitionStatuses = message.data.matches;
					if (stateChanged) void invalidateAll();
				} else if (message.type === 'competition.confirmed') {
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
	<title>大会管理 | {data.tournamentName}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<header class="app-header admin-header">
	<div>
		<p class="product-name">{data.tournamentName}</p>
		<h1>大会管理</h1>
	</div>
	<a class="header-link" href={resolve('/')}>大会概要</a>
</header>

<main class="admin-main">
	<form method="POST" action="?/saveAssignments">
		<div class="admin-toolbar">
			<div>
				<p class="eyebrow">MATCHES</p>
				<h2>試合割り当て</h2>
			</div>
			<button class="primary-button" type="submit">保存</button>
		</div>

		{#if form?.saved}
			<p class="form-notice is-success" role="status">保存しました。</p>
		{/if}

		{#if form?.issues}
			<div class="form-notice is-error" role="alert">
				{#each form.issues as issue (issue)}
					<p>{issue}</p>
				{/each}
			</div>
		{/if}

		{#each [1, 2, 3] as matchNumber (matchNumber)}
			<section class="match-editor" aria-labelledby={`match-${matchNumber}-heading`}>
				<h3 id={`match-${matchNumber}-heading`}>第{matchNumber}試合</h3>
				<div class="assignment-table">
					<div class="assignment-row assignment-header" aria-hidden="true">
						<span>チーム</span>
						<span>出場クラス</span>
						<span>レーン</span>
					</div>
					{#each data.teams as team, teamIndex (team.name)}
						{@const assignment = assignmentFor(matchNumber, team.name)}
						<div class="assignment-row">
							<strong>{team.name}</strong>
							<label>
								<span class="visually-hidden">第{matchNumber}試合 {team.name} 出場クラス</span>
								{#if assignmentLocked(matchNumber)}
									<input
										type="hidden"
										name={`source_${matchNumber}_${teamIndex}`}
										value={assignment?.representativeSource ?? ''}
									/>
								{/if}
								<select
									name={`source_${matchNumber}_${teamIndex}`}
									disabled={assignmentLocked(matchNumber)}
								>
									{#each team.representativeSources as source (source)}
										<option value={source} selected={assignment?.representativeSource === source}>
											{source}
										</option>
									{/each}
								</select>
							</label>
							<span class="fixed-lane">{team.laneNumber}</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<div class="save-footer">
			<button class="primary-button" type="submit">保存</button>
		</div>
	</form>

	<section class="competition-start" aria-labelledby="competition-start-heading">
		<div class="admin-toolbar">
			<div>
				<p class="eyebrow">CONTROL</p>
				<h2 id="competition-start-heading">競技開始</h2>
			</div>
		</div>

		{#if form?.started}
			<p class="form-notice is-success" role="status">
				第{form.startedMatchNumber}試合を開始しました。
			</p>
		{/if}
		{#if form?.startIssue}
			<p class="form-notice is-error" role="alert">{form.startIssue}</p>
		{/if}
		{#if form?.operationCompleted}
			<p class="form-notice is-success" role="status">
				第{form.operationMatchNumber}試合の{operationLabel(
					form.operationAction
				)}を実行しました。{#if form.operationProblemSetId}
					使用問題: {form.operationProblemSetId}{/if}
			</p>
		{/if}
		{#if form?.operationIssue}
			<p class="form-notice is-error" role="alert">{form.operationIssue}</p>
		{/if}

		<div class="competition-control-table">
			<div class="competition-control-row competition-control-header" aria-hidden="true">
				<span>試合</span>
				<span>状態</span>
				<span>接続</span>
				<span>準備</span>
				<span>操作</span>
			</div>
			{#each [1, 2, 3] as matchNumber (matchNumber)}
				{@const status = competitionStatusFor(matchNumber)}
				<div class="competition-control-row">
					<strong class="competition-match-label">
						第{matchNumber}試合
						<small>試技{status.attemptNumber} / {status.problemSetId || '-'}</small>
					</strong>
					<span class="competition-state" data-status={displayedStatus(matchNumber)}>
						{statusLabel(displayedStatus(matchNumber))}
					</span>
					<span class="competition-count"><small>接続</small>{status.connectedCount}/6</span>
					<span class="competition-count"><small>準備</small>{status.readyCount}/6</span>
					<div class="competition-operations">
						{#if displayedStatus(matchNumber) === 'waiting'}
							<form
								method="POST"
								action="?/startCompetition"
								onsubmit={(event) => startSubmission(event, matchNumber)}
							>
								<input type="hidden" name="matchNumber" value={matchNumber} />
								<button type="submit" disabled={!canStart(matchNumber)}>一括開始</button>
							</form>
						{:else if displayedStatus(matchNumber) === 'countdown' || displayedStatus(matchNumber) === 'running'}
							{#each [{ action: 'interrupt', label: '中断' }, { action: 'force_finish', label: '強制終了' }] as control (control.action)}
								<form
									method="POST"
									action="?/competitionOperation"
									onsubmit={(event) => operationSubmission(event, matchNumber, control.label)}
								>
									<input type="hidden" name="matchNumber" value={matchNumber} />
									<input type="hidden" name="operation" value={control.action} />
									<button class:danger-button={control.action === 'force_finish'} type="submit">
										{control.label}
									</button>
								</form>
							{/each}
						{:else if displayedStatus(matchNumber) === 'invalidated'}
							<form
								class="reason-operation"
								method="POST"
								action="?/competitionOperation"
								onsubmit={(event) => operationSubmission(event, matchNumber, '再試合として設定')}
							>
								<input type="hidden" name="matchNumber" value={matchNumber} />
								<input type="hidden" name="operation" value="retry" />
								<input name="reason" required placeholder="再試合の理由" />
								<button type="submit">再試合</button>
							</form>
						{:else}
							<form
								class="reason-operation"
								method="POST"
								action="?/competitionOperation"
								onsubmit={(event) => operationSubmission(event, matchNumber, '無効化')}
							>
								<input type="hidden" name="matchNumber" value={matchNumber} />
								<input type="hidden" name="operation" value="invalidate" />
								<input name="reason" required placeholder="無効化の理由" />
								<button class="danger-button" type="submit">無効化</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="result-confirmation" aria-labelledby="result-confirmation-heading">
		<div class="admin-toolbar">
			<div>
				<p class="eyebrow">RESULTS</p>
				<h2 id="result-confirmation-heading">試合結果の確定</h2>
			</div>
		</div>

		{#if form?.confirmed}
			<p class="form-notice is-success" role="status">
				第{form.confirmedMatchNumber}試合の結果を確定しました。
			</p>
		{/if}
		{#if form?.confirmationIssue}
			<p class="form-notice is-error" role="alert">{form.confirmationIssue}</p>
		{/if}

		{#each [1, 2, 3] as matchNumber (matchNumber)}
			{@const results = resultsFor(matchNumber)}
			{@const confirmation = confirmationFor(matchNumber)}
			<section class="confirmation-match" aria-labelledby={`confirmation-${matchNumber}-heading`}>
				<div class="confirmation-heading">
					<div>
						<h3 id={`confirmation-${matchNumber}-heading`}>第{matchNumber}試合</h3>
						{#if confirmation}
							<small>
								{confirmation.confirmedBy} / {confirmation.confirmedAt.toLocaleString('ja-JP')}
							</small>
						{/if}
					</div>
					<span class:confirmed={Boolean(confirmation)}>
						{confirmation ? '確定' : results.length === 6 ? '未確定' : '結果待ち'}
					</span>
				</div>

				{#if results.length === 6}
					<div class="confirmation-table">
						<div class="confirmation-row confirmation-header" aria-hidden="true">
							<span>順位</span>
							<span>チーム</span>
							<span>出場クラス</span>
							<span>正タイプ</span>
							<span>ミス</span>
							<span>WPM</span>
							<span>正確率</span>
							<span>スコア</span>
						</div>
						{#each results as result (`${result.matchNumber}-${result.laneNumber}`)}
							<div class="confirmation-row">
								<strong>{result.disqualified ? '失格' : `${result.rank}位`}</strong>
								<span>{result.teamName}</span>
								<code>{result.representativeSource}</code>
								<span>{result.correctTypes.toLocaleString()}</span>
								<span>{result.incorrectTypes.toLocaleString()}</span>
								<span>{result.wpm.toFixed(1)}</span>
								<span>{(result.accuracy * 100).toFixed(1)}%</span>
								<strong
									title={result.disqualified ? `計算値 ${result.calculatedScore}` : undefined}
								>
									{result.score.toLocaleString()}
								</strong>
							</div>
						{/each}
					</div>

					<div class="result-actions">
						<form
							class="disqualification-form"
							method="POST"
							action="?/competitionOperation"
							onsubmit={(event) => operationSubmission(event, matchNumber, '選手を失格に')}
						>
							<input type="hidden" name="matchNumber" value={matchNumber} />
							<input type="hidden" name="operation" value="disqualify" />
							<select name="laneNumber" aria-label={`第${matchNumber}試合の失格対象`}>
								{#each results.filter((result) => !result.disqualified) as result (result.laneNumber)}
									<option value={result.laneNumber}>
										レーン{result.laneNumber}
										{result.teamName} / {result.representativeSource}
									</option>
								{/each}
							</select>
							<input name="reason" required placeholder="失格の理由" />
							<button class="danger-button" type="submit"> 失格 </button>
						</form>
						<form
							class="confirmation-actions"
							method="POST"
							action="?/confirmResults"
							onsubmit={(event) => confirmSubmission(event, matchNumber)}
						>
							<input type="hidden" name="matchNumber" value={matchNumber} />
							<button type="submit" disabled={Boolean(confirmation)}>
								{confirmation ? '確定済み' : '結果を確定'}
							</button>
						</form>
					</div>
				{:else}
					<p class="confirmation-empty">競技終了後に6名分の結果が表示されます。</p>
				{/if}
			</section>
		{/each}
	</section>

	<section class="result-export" aria-labelledby="result-export-heading">
		<div class="admin-toolbar">
			<div>
				<p class="eyebrow">SPORT EASE</p>
				<h2 id="result-export-heading">確定結果JSON</h2>
			</div>
			<span class:ready={data.exportState.ready} class="export-readiness">
				{data.exportState.ready
					? '出力可能'
					: `${data.exportState.confirmedMatchNumbers.length}/3試合確定`}
			</span>
		</div>

		{#if data.exportState.ready}
			<div class="export-summary">
				<div>
					<small>スキーマ</small>
					<code>typing-results-v1</code>
				</div>
				<div>
					<small>現在のexport_id</small>
					<code>{data.exportState.currentExport?.exportId ?? '未出力'}</code>
				</div>
				<div>
					<small>最終出力</small>
					<span>
						{data.exportState.currentExport
							? data.exportState.currentExport.lastExportedAt.toLocaleString('ja-JP')
							: '-'}
					</span>
				</div>
				<a
					class="primary-button download-button"
					href={resolve('/admin/results.json')}
					download="typing-results.json"
				>
					{data.exportState.currentExport ? 'JSONを再出力' : 'JSONを出力'}
				</a>
			</div>

			<div class="export-preview-table">
				<div class="export-preview-row export-preview-header" aria-hidden="true">
					<span>順位</span>
					<span>チーム</span>
					<span>第1試合</span>
					<span>第2試合</span>
					<span>第3試合</span>
					<span>合計</span>
				</div>
				{#each data.exportState.standings as standing (standing.teamName)}
					<div class="export-preview-row">
						<strong>{standing.rank}位</strong>
						<strong>{standing.teamName}</strong>
						<span>{standing.matchScores[0].toLocaleString()}</span>
						<span>{standing.matchScores[1].toLocaleString()}</span>
						<span>{standing.matchScores[2].toLocaleString()}</span>
						<strong>{standing.totalScore.toLocaleString()}</strong>
					</div>
				{/each}
			</div>
		{:else}
			<p class="export-unavailable">第1〜第3試合の6名分の結果をすべて確定すると出力できます。</p>
		{/if}

		{#if data.exportState.exports.length > 0}
			<h3 class="history-subheading">出力履歴</h3>
			<div class="export-history-table">
				{#each data.exportState.exports as exported (exported.exportId)}
					<div class="export-history-row">
						<code>{exported.exportId}</code>
						<span><small>初回</small>{exported.createdAt.toLocaleString('ja-JP')}</span>
						<span><small>最終</small>{exported.lastExportedAt.toLocaleString('ja-JP')}</span>
						<strong>{exported.exportCount}回</strong>
						<code title={exported.contentSha256}>{exported.contentSha256.slice(0, 12)}…</code>
						<small>{exported.lastExportedBy}</small>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="operation-history" aria-labelledby="operation-history-heading">
		<div class="admin-toolbar">
			<div>
				<p class="eyebrow">AUDIT LOG</p>
				<h2 id="operation-history-heading">試行・操作履歴</h2>
			</div>
			<div class="history-match-tabs" aria-label="履歴の試合フィルター">
				{#each [0, 1, 2, 3] as matchNumber (matchNumber)}
					<button
						type="button"
						class:active={historyMatch === matchNumber}
						onclick={() => (historyMatch = matchNumber)}
					>
						{matchNumber === 0 ? 'すべて' : `第${matchNumber}試合`}
					</button>
				{/each}
			</div>
		</div>

		<h3 class="history-subheading">試行履歴</h3>
		{#if attemptsForHistory().length > 0}
			<div class="attempt-history-list">
				{#each attemptsForHistory() as attempt (`${attempt.matchNumber}-${attempt.attemptNumber}`)}
					{@const attemptResults = attemptResultsFor(attempt.matchNumber, attempt.attemptNumber)}
					<details class="attempt-history-item">
						<summary>
							<span class="attempt-identity">
								<strong>第{attempt.matchNumber}試合 / 試技{attempt.attemptNumber}</strong>
								<code>{attempt.problemSetId} v{attempt.problemSetVersion}</code>
							</span>
							<span class="attempt-status" data-status={attempt.status}>
								{operationStatusLabel(attempt.status)}
							</span>
							<span class="attempt-time">
								<small>開始</small>{formatAuditTime(attempt.startedAt)}
							</span>
							<span class="attempt-time">
								<small>終了</small>{formatAuditTime(attempt.endedAt)}
							</span>
							<span class="attempt-duration">
								<small>経過</small>{attemptDuration(attempt.startedAt, attempt.endedAt)}
							</span>
						</summary>
						{#if attempt.reason || attempt.operatedBy}
							<div class="attempt-note">
								<span><small>理由</small>{attempt.reason ?? '-'}</span>
								<span><small>操作者</small>{attempt.operatedBy ?? '-'}</span>
							</div>
						{/if}
						{#if attemptResults.length > 0}
							<div class="attempt-result-table">
								<div class="attempt-result-row attempt-result-header" aria-hidden="true">
									<span>レーン</span>
									<span>チーム</span>
									<span>出場クラス</span>
									<span>正タイプ</span>
									<span>ミス</span>
									<span>WPM</span>
									<span>正確率</span>
									<span>計測スコア</span>
									<span>順位</span>
								</div>
								{#each attemptResults as result (result.laneNumber)}
									<div class="attempt-result-row">
										<strong>{result.laneNumber}</strong>
										<span>{result.teamName}</span>
										<code>{result.representativeSource}</code>
										<span>{result.correctTypes.toLocaleString()}</span>
										<span>{result.incorrectTypes.toLocaleString()}</span>
										<span>{result.wpm.toFixed(1)}</span>
										<span>{(result.accuracy * 100).toFixed(1)}%</span>
										<strong>{result.score.toLocaleString()}</strong>
										<span>{result.rank === null ? '-' : `${result.rank}位`}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="attempt-result-empty">この試技の計測結果はまだありません。</p>
						{/if}
					</details>
				{/each}
			</div>
		{:else}
			<p class="confirmation-empty">試行履歴はありません。</p>
		{/if}

		<h3 class="history-subheading">操作履歴</h3>
		{#if operationsForHistory().length > 0}
			<div class="operation-history-table">
				{#each operationsForHistory() as operation (operation.id)}
					<div class="operation-history-row">
						<time datetime={operation.operatedAt.toISOString()}>
							{operation.operatedAt.toLocaleString('ja-JP')}
						</time>
						<strong>第{operation.matchNumber}試合 / 試技{operation.attemptNumber}</strong>
						<span>{operationLabel(operation.action)}</span>
						<span>
							{operationStatusLabel(operation.statusBefore)} → {operationStatusLabel(
								operation.statusAfter
							)}
						</span>
						<span>{operation.laneNumber ? `レーン${operation.laneNumber}` : '-'}</span>
						<span>{operation.reason ?? '-'}</span>
						<small>{operation.operatedBy}</small>
					</div>
				{/each}
			</div>
		{:else}
			<p class="confirmation-empty">操作履歴はありません。</p>
		{/if}
	</section>
</main>
