/**
 * @param {import('better-sqlite3').Database} database
 * @param {number} matchNumber
 * @param {string} confirmedBy
 * @param {number} confirmedAt
 */
export function confirmMatchResults(database, matchNumber, confirmedBy, confirmedAt = Date.now()) {
	const confirm = database.transaction(() => {
		const resultCount = database
			.prepare('select count(*) from match_results where match_number = ?')
			.pluck()
			.get(matchNumber);
		if (resultCount !== 6) return { confirmed: false, reason: 'incomplete_results' };

		const existing = database
			.prepare('select 1 from match_confirmations where match_number = ?')
			.get(matchNumber);
		if (existing) return { confirmed: true, alreadyConfirmed: true };

		database
			.prepare(
				`insert into match_attempts (
				 match_number, attempt_number, problem_set_id, problem_set_version, status,
				 started_at, ended_at, created_at, updated_at
				)
				select match_number, 1, min(problem_set_id), min(problem_set_version), 'finished',
				 null, max(finished_at), ?, ? from match_results where match_number = ?
				on conflict(match_number, attempt_number) do nothing`
			)
			.run(confirmedAt, confirmedAt, matchNumber);
		const attempt = /** @type {{ attemptNumber: number, status: string } | undefined} */ (
			database
				.prepare(
					`select attempt_number as attemptNumber, status from match_attempts
					 where match_number = ? order by attempt_number desc limit 1`
				)
				.get(matchNumber)
		);
		if (!attempt) throw new Error(`Attempt for match ${matchNumber} was not found`);
		database
			.prepare(
				`insert or ignore into match_attempt_results (
				 match_number, attempt_number, lane_number, team_name, representative_source,
				 correct_types, incorrect_types, completed_problems, wpm, accuracy, raw_score, score,
				 rank, captured_at
				)
				select match_number, ?, lane_number, team_name, representative_source,
				 correct_types, incorrect_types, completed_problems, wpm, accuracy, raw_score, score,
				 rank, ? from match_results where match_number = ?`
			)
			.run(attempt.attemptNumber, confirmedAt, matchNumber);

		database
			.prepare(
				'insert into match_confirmations (match_number, confirmed_at, confirmed_by) values (?, ?, ?)'
			)
			.run(matchNumber, confirmedAt, confirmedBy);
		database
			.prepare(
				`update match_attempts set status = 'replaced', updated_at = ?
				 where match_number = ? and attempt_number < ? and status = 'invalidated'`
			)
			.run(confirmedAt, matchNumber, attempt.attemptNumber);
		database
			.prepare(
				`update match_attempts set status = 'confirmed', updated_at = ?, operated_by = ?
				 where match_number = ? and attempt_number = ?`
			)
			.run(confirmedAt, confirmedBy, matchNumber, attempt.attemptNumber);
		database
			.prepare(
				`insert into match_operations (
				 match_number, attempt_number, action, status_before, status_after,
				 operated_at, operated_by
				) values (?, ?, 'confirm', ?, 'confirmed', ?, ?)`
			)
			.run(matchNumber, attempt.attemptNumber, attempt.status, confirmedAt, confirmedBy);
		return { confirmed: true, alreadyConfirmed: false };
	});

	return confirm();
}
