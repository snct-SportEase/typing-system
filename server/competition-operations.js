/**
 * @param {import('better-sqlite3').Database} database
 * @param {{ matchNumber: number, attemptNumber: number, problemSetId: string, problemSetVersion: number, startsAt: number }} attempt
 * @param {string} operatedBy
 * @param {number} operatedAt
 */
export function recordAttemptStarted(database, attempt, operatedBy, operatedAt = Date.now()) {
	database.transaction(() => {
		database
			.prepare(
				`insert into match_attempts (
					match_number, attempt_number, problem_set_id, problem_set_version,
					status, started_at, created_at, updated_at, operated_by
				) values (?, ?, ?, ?, 'running', ?, ?, ?, ?)
				on conflict(match_number, attempt_number) do update set
					status = 'running', started_at = excluded.started_at,
					updated_at = excluded.updated_at, operated_by = excluded.operated_by,
					reason = null`
			)
			.run(
				attempt.matchNumber,
				attempt.attemptNumber,
				attempt.problemSetId,
				attempt.problemSetVersion,
				attempt.startsAt,
				operatedAt,
				operatedAt,
				operatedBy
			);
		insertOperation(database, {
			matchNumber: attempt.matchNumber,
			attemptNumber: attempt.attemptNumber,
			action: 'start',
			statusBefore: 'waiting',
			statusAfter: 'running',
			operatedAt,
			operatedBy
		});
	})();
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {any} snapshot
 * @param {number} attemptNumber
 * @param {'interrupted' | 'force_finished'} status
 * @param {string} statusBefore
 * @param {string} operatedBy
 * @param {string} reason
 * @param {number} operatedAt
 */
export function recordStoppedAttempt(
	database,
	snapshot,
	attemptNumber,
	status,
	statusBefore,
	operatedBy,
	reason,
	operatedAt = Date.now()
) {
	database.transaction(() => {
		upsertAttempt(database, {
			matchNumber: snapshot.matchNumber,
			attemptNumber,
			problemSetId: snapshot.problemSetId,
			problemSetVersion: snapshot.problemSetVersion,
			status,
			startedAt: snapshot.startsAt,
			endedAt: operatedAt,
			reason,
			operatedBy,
			updatedAt: operatedAt
		});
		saveAttemptResults(database, snapshot, attemptNumber, operatedAt);
		insertOperation(database, {
			matchNumber: snapshot.matchNumber,
			attemptNumber,
			action: status === 'interrupted' ? 'interrupt' : 'force_finish',
			statusBefore,
			statusAfter: status,
			reason,
			operatedAt,
			operatedBy
		});
	})();
}

/** @param {import('better-sqlite3').Database} database @param {number} matchNumber @returns {MatchAttempt | undefined} */
export function getLatestAttempt(database, matchNumber) {
	return /** @type {MatchAttempt | undefined} */ (
		database
			.prepare(
				`select match_number as matchNumber, attempt_number as attemptNumber,
			        problem_set_id as problemSetId, problem_set_version as problemSetVersion,
			        status, started_at as startedAt, ended_at as endedAt
			 from match_attempts where match_number = ?
			 order by attempt_number desc limit 1`
			)
			.get(matchNumber)
	);
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {number} matchNumber
 * @param {string} operatedBy
 * @param {string} reason
 * @param {number} operatedAt
 */
export function invalidateMatch(
	database,
	matchNumber,
	operatedBy,
	reason,
	operatedAt = Date.now()
) {
	return database.transaction(() => {
		let attempt = getLatestAttempt(database, matchNumber);
		if (!attempt) attempt = createLegacyAttempt(database, matchNumber, operatedAt);
		if (!attempt) return { invalidated: false, reason: 'attempt_not_found' };
		if (attempt.status === 'invalidated') {
			return { invalidated: true, attemptNumber: attempt.attemptNumber, alreadyInvalidated: true };
		}

		copyCurrentResultsToHistory(database, matchNumber, attempt.attemptNumber, operatedAt);
		database
			.prepare(
				`update match_attempts set status = 'invalidated', ended_at = coalesce(ended_at, ?),
				 updated_at = ?, reason = ?, operated_by = ?
				 where match_number = ? and attempt_number = ?`
			)
			.run(operatedAt, operatedAt, reason, operatedBy, matchNumber, attempt.attemptNumber);
		database.prepare('delete from match_confirmations where match_number = ?').run(matchNumber);
		database.prepare('delete from match_disqualifications where match_number = ?').run(matchNumber);
		database.prepare('delete from match_results where match_number = ?').run(matchNumber);
		insertOperation(database, {
			matchNumber,
			attemptNumber: attempt.attemptNumber,
			action: 'invalidate',
			statusBefore: attempt.status,
			statusAfter: 'invalidated',
			reason,
			operatedAt,
			operatedBy
		});
		return { invalidated: true, attemptNumber: attempt.attemptNumber, alreadyInvalidated: false };
	})();
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {number} matchNumber
 * @param {{ problemSetId: string, problemSetVersion: number }} preset
 * @param {string} operatedBy
 * @param {string} reason
 * @param {number} operatedAt
 */
export function prepareRetry(
	database,
	matchNumber,
	preset,
	operatedBy,
	reason,
	operatedAt = Date.now()
) {
	return database.transaction(() => {
		const latest = getLatestAttempt(database, matchNumber);
		if (!latest || latest.status !== 'invalidated') {
			return { prepared: false, reason: 'match_not_invalidated' };
		}
		const attemptNumber = latest.attemptNumber + 1;
		database
			.prepare(
				`insert into match_attempts (
				 match_number, attempt_number, problem_set_id, problem_set_version,
				 status, created_at, updated_at, reason, operated_by
				) values (?, ?, ?, ?, 'retry_waiting', ?, ?, ?, ?)`
			)
			.run(
				matchNumber,
				attemptNumber,
				preset.problemSetId,
				preset.problemSetVersion,
				operatedAt,
				operatedAt,
				reason,
				operatedBy
			);
		insertOperation(database, {
			matchNumber,
			attemptNumber,
			action: 'retry',
			statusBefore: 'invalidated',
			statusAfter: 'retry_waiting',
			reason,
			operatedAt,
			operatedBy
		});
		return { prepared: true, attemptNumber };
	})();
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {number} matchNumber
 * @param {number} laneNumber
 * @param {string} operatedBy
 * @param {string} reason
 * @param {number} operatedAt
 */
export function disqualifyLane(
	database,
	matchNumber,
	laneNumber,
	operatedBy,
	reason,
	operatedAt = Date.now()
) {
	return database.transaction(() => {
		const result = database
			.prepare('select 1 from match_results where match_number = ? and lane_number = ?')
			.get(matchNumber, laneNumber);
		if (!result) return { disqualified: false, reason: 'result_not_found' };
		const existing = database
			.prepare('select 1 from match_disqualifications where match_number = ? and lane_number = ?')
			.get(matchNumber, laneNumber);
		if (existing) return { disqualified: true, alreadyDisqualified: true };
		const attempt = getLatestAttempt(database, matchNumber);
		const attemptNumber = attempt?.attemptNumber ?? 1;
		const confirmed = database
			.prepare('select 1 from match_confirmations where match_number = ?')
			.get(matchNumber);
		database
			.prepare(
				`insert into match_disqualifications (
				 match_number, lane_number, reason, disqualified_at, disqualified_by
				) values (?, ?, ?, ?, ?)`
			)
			.run(matchNumber, laneNumber, reason, operatedAt, operatedBy);
		insertOperation(database, {
			matchNumber,
			attemptNumber,
			action: 'disqualify',
			laneNumber,
			statusBefore: confirmed ? 'confirmed' : 'unconfirmed',
			statusAfter: 'disqualified',
			reason,
			operatedAt,
			operatedBy
		});
		return { disqualified: true, alreadyDisqualified: false };
	})();
}

/** @param {import('better-sqlite3').Database} database */
export function getUsedProblemSetIds(database) {
	return database.prepare('select problem_set_id from match_attempts').pluck().all();
}

/** @param {import('better-sqlite3').Database} database @param {any} values */
function upsertAttempt(database, values) {
	database
		.prepare(
			`insert into match_attempts (
			 match_number, attempt_number, problem_set_id, problem_set_version, status,
			 started_at, ended_at, created_at, updated_at, reason, operated_by
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			on conflict(match_number, attempt_number) do update set
			 status = excluded.status, started_at = coalesce(match_attempts.started_at, excluded.started_at),
			 ended_at = excluded.ended_at, updated_at = excluded.updated_at,
			 reason = excluded.reason, operated_by = excluded.operated_by`
		)
		.run(
			values.matchNumber,
			values.attemptNumber,
			values.problemSetId,
			values.problemSetVersion,
			values.status,
			values.startedAt,
			values.endedAt,
			values.updatedAt,
			values.updatedAt,
			values.reason,
			values.operatedBy
		);
}

/** @param {import('better-sqlite3').Database} database @param {any} snapshot @param {number} attemptNumber @param {number} capturedAt */
export function saveAttemptResults(database, snapshot, attemptNumber, capturedAt) {
	const insert = database.prepare(
		`insert into match_attempt_results (
		 match_number, attempt_number, lane_number, team_name, representative_source,
		 correct_types, incorrect_types, completed_problems, wpm, accuracy, raw_score, score, rank,
		 captured_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		on conflict(match_number, attempt_number, lane_number) do update set
		 correct_types = excluded.correct_types, incorrect_types = excluded.incorrect_types,
		 completed_problems = excluded.completed_problems, wpm = excluded.wpm,
		 accuracy = excluded.accuracy, raw_score = excluded.raw_score, score = excluded.score,
		 rank = excluded.rank, captured_at = excluded.captured_at`
	);
	for (const lane of snapshot.lanes) {
		insert.run(
			snapshot.matchNumber,
			attemptNumber,
			lane.laneNumber,
			lane.teamName,
			lane.representativeSource,
			lane.correctTypes,
			lane.incorrectTypes,
			lane.completedProblems,
			lane.wpm,
			lane.accuracy,
			lane.rawScore,
			lane.score,
			lane.rank,
			capturedAt
		);
	}
}

/** @param {import('better-sqlite3').Database} database @param {number} matchNumber @param {number} operatedAt @returns {MatchAttempt | undefined} */
function createLegacyAttempt(database, matchNumber, operatedAt) {
	const result =
		/** @type {{ problemSetId: string, problemSetVersion: number, endedAt: number } | undefined} */ (
			database
				.prepare(
					`select problem_set_id as problemSetId, problem_set_version as problemSetVersion,
			 finished_at as endedAt from match_results where match_number = ? limit 1`
				)
				.get(matchNumber)
		);
	if (!result) return undefined;
	upsertAttempt(database, {
		matchNumber,
		attemptNumber: 1,
		problemSetId: result.problemSetId,
		problemSetVersion: result.problemSetVersion,
		status: 'finished',
		startedAt: null,
		endedAt: result.endedAt,
		reason: null,
		operatedBy: null,
		updatedAt: operatedAt
	});
	return getLatestAttempt(database, matchNumber);
}

/** @param {import('better-sqlite3').Database} database @param {number} matchNumber @param {number} attemptNumber @param {number} capturedAt */
function copyCurrentResultsToHistory(database, matchNumber, attemptNumber, capturedAt) {
	database
		.prepare(
			`insert or ignore into match_attempt_results (
			 match_number, attempt_number, lane_number, team_name, representative_source,
			 correct_types, incorrect_types, completed_problems, wpm, accuracy, raw_score, score, rank,
			 captured_at
			)
			select match_number, ?, lane_number, team_name, representative_source,
			 correct_types, incorrect_types, completed_problems, wpm, accuracy, raw_score, score, rank, ?
			from match_results where match_number = ?`
		)
		.run(attemptNumber, capturedAt, matchNumber);
}

/** @param {import('better-sqlite3').Database} database @param {any} operation */
function insertOperation(database, operation) {
	database
		.prepare(
			`insert into match_operations (
			 match_number, attempt_number, action, lane_number, status_before, status_after,
			 reason, operated_at, operated_by
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			operation.matchNumber,
			operation.attemptNumber,
			operation.action,
			operation.laneNumber ?? null,
			operation.statusBefore ?? null,
			operation.statusAfter ?? null,
			operation.reason ?? null,
			operation.operatedAt,
			operation.operatedBy
		);
}
/**
 * @typedef {{
 *   matchNumber: number,
 *   attemptNumber: number,
 *   problemSetId: string,
 *   problemSetVersion: number,
 *   status: string,
 *   startedAt: number | null,
 *   endedAt: number | null
 * }} MatchAttempt
 */
