import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const appMetadata = sqliteTable('app_metadata', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const matchAssignments = sqliteTable(
	'match_assignments',
	{
		matchNumber: integer('match_number').notNull(),
		teamName: text('team_name').notNull(),
		representativeSource: text('representative_source').notNull(),
		laneNumber: integer('lane_number').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.matchNumber, table.teamName] }),
		uniqueIndex('match_assignments_match_lane_unique').on(table.matchNumber, table.laneNumber)
	]
);

export const matchResults = sqliteTable(
	'match_results',
	{
		matchNumber: integer('match_number').notNull(),
		laneNumber: integer('lane_number').notNull(),
		teamName: text('team_name').notNull(),
		representativeSource: text('representative_source').notNull(),
		correctTypes: integer('correct_types').notNull(),
		incorrectTypes: integer('incorrect_types').notNull(),
		completedProblems: integer('completed_problems').notNull(),
		wpm: real('wpm').notNull(),
		accuracy: real('accuracy').notNull(),
		rawScore: real('raw_score').notNull(),
		score: integer('score').notNull(),
		rank: integer('rank').notNull(),
		problemSetId: text('problem_set_id').notNull(),
		problemSetVersion: integer('problem_set_version').notNull(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.matchNumber, table.laneNumber] })]
);

export const matchConfirmations = sqliteTable('match_confirmations', {
	matchNumber: integer('match_number').primaryKey(),
	confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }).notNull(),
	confirmedBy: text('confirmed_by').notNull()
});

export const matchAttempts = sqliteTable(
	'match_attempts',
	{
		matchNumber: integer('match_number').notNull(),
		attemptNumber: integer('attempt_number').notNull(),
		problemSetId: text('problem_set_id').notNull(),
		problemSetVersion: integer('problem_set_version').notNull(),
		status: text('status').notNull(),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
		reason: text('reason'),
		operatedBy: text('operated_by')
	},
	(table) => [primaryKey({ columns: [table.matchNumber, table.attemptNumber] })]
);

export const matchAttemptResults = sqliteTable(
	'match_attempt_results',
	{
		matchNumber: integer('match_number').notNull(),
		attemptNumber: integer('attempt_number').notNull(),
		laneNumber: integer('lane_number').notNull(),
		teamName: text('team_name').notNull(),
		representativeSource: text('representative_source').notNull(),
		correctTypes: integer('correct_types').notNull(),
		incorrectTypes: integer('incorrect_types').notNull(),
		completedProblems: integer('completed_problems').notNull(),
		wpm: real('wpm').notNull(),
		accuracy: real('accuracy').notNull(),
		rawScore: real('raw_score').notNull(),
		score: integer('score').notNull(),
		rank: integer('rank'),
		capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.matchNumber, table.attemptNumber, table.laneNumber] })]
);

export const matchDisqualifications = sqliteTable(
	'match_disqualifications',
	{
		matchNumber: integer('match_number').notNull(),
		laneNumber: integer('lane_number').notNull(),
		reason: text('reason').notNull(),
		disqualifiedAt: integer('disqualified_at', { mode: 'timestamp_ms' }).notNull(),
		disqualifiedBy: text('disqualified_by').notNull()
	},
	(table) => [primaryKey({ columns: [table.matchNumber, table.laneNumber] })]
);

export const matchOperations = sqliteTable('match_operations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	matchNumber: integer('match_number').notNull(),
	attemptNumber: integer('attempt_number').notNull(),
	action: text('action').notNull(),
	laneNumber: integer('lane_number'),
	statusBefore: text('status_before'),
	statusAfter: text('status_after'),
	reason: text('reason'),
	operatedAt: integer('operated_at', { mode: 'timestamp_ms' }).notNull(),
	operatedBy: text('operated_by').notNull()
});

export const resultExports = sqliteTable(
	'result_exports',
	{
		exportId: text('export_id').primaryKey(),
		resultFingerprint: text('result_fingerprint').notNull(),
		contentSha256: text('content_sha256').notNull(),
		payload: text('payload').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		createdBy: text('created_by').notNull(),
		lastExportedAt: integer('last_exported_at', { mode: 'timestamp_ms' }).notNull(),
		lastExportedBy: text('last_exported_by').notNull(),
		exportCount: integer('export_count').notNull()
	},
	(table) => [uniqueIndex('result_exports_fingerprint_unique').on(table.resultFingerprint)]
);
