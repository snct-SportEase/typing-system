import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
	disqualifyLane,
	getLatestAttempt,
	getUsedProblemSetIds,
	invalidateMatch,
	prepareRetry,
	recordAttemptStarted,
	recordStoppedAttempt
} from './competition-operations.js';

let database: Database.Database | undefined;

afterEach(() => database?.close());

describe('competition operations', () => {
	it('retains an interrupted attempt and prepares a retry with another problem set', () => {
		database = createDatabase();
		recordAttemptStarted(
			database,
			{
				matchNumber: 1,
				attemptNumber: 1,
				problemSetId: 'typing-main-01',
				problemSetVersion: 1,
				startsAt: 1_000
			},
			'admin',
			900
		);
		recordStoppedAttempt(
			database,
			snapshot(),
			1,
			'interrupted',
			'running',
			'admin',
			'機器不調',
			2_000
		);

		expect(invalidateMatch(database, 1, 'admin', '再試合対象', 2_100)).toMatchObject({
			invalidated: true,
			attemptNumber: 1
		});
		expect(
			prepareRetry(
				database,
				1,
				{ problemSetId: 'typing-reserve-01', problemSetVersion: 1 },
				'admin',
				'再試合',
				2_200
			)
		).toEqual({ prepared: true, attemptNumber: 2 });

		expect(getLatestAttempt(database, 1)).toMatchObject({
			attemptNumber: 2,
			problemSetId: 'typing-reserve-01',
			status: 'retry_waiting'
		});
		expect(getUsedProblemSetIds(database)).toEqual(['typing-main-01', 'typing-reserve-01']);
		expect(
			database.prepare('select action from match_operations order by id').pluck().all()
		).toEqual(['start', 'interrupt', 'invalidate', 'retry']);
		expect(
			database
				.prepare(
					`select status_before as statusBefore, status_after as statusAfter
					 from match_operations order by id`
				)
				.all()
		).toEqual([
			{ statusBefore: 'waiting', statusAfter: 'running' },
			{ statusBefore: 'running', statusAfter: 'interrupted' },
			{ statusBefore: 'interrupted', statusAfter: 'invalidated' },
			{ statusBefore: 'invalidated', statusAfter: 'retry_waiting' }
		]);
		expect(database.prepare('select count(*) from match_attempt_results').pluck().get()).toBe(2);
	});

	it('records a disqualification without deleting the measured result', () => {
		database = createDatabase();
		database
			.prepare(
				`insert into match_results values
				 (1, 3, '3年生', 'IS3', 300, 4, 2, 100, 0.98, 98.5, 98, 1,
				  'typing-main-01', 1, 3000)`
			)
			.run();

		expect(disqualifyLane(database, 1, 3, 'admin', '規定違反', 4_000)).toEqual({
			disqualified: true,
			alreadyDisqualified: false
		});
		expect(database.prepare('select score from match_results').pluck().get()).toBe(98);
		expect(
			database
				.prepare('select lane_number as laneNumber, reason from match_disqualifications')
				.get()
		).toEqual({ laneNumber: 3, reason: '規定違反' });
	});
});

function snapshot() {
	return {
		matchNumber: 1,
		problemSetId: 'typing-main-01',
		problemSetVersion: 1,
		startsAt: 1_000,
		lanes: [1, 2].map((laneNumber) => ({
			laneNumber,
			teamName: `${laneNumber}年生`,
			representativeSource: `IS${laneNumber}`,
			correctTypes: 100,
			incorrectTypes: laneNumber,
			completedProblems: 1,
			wpm: 80,
			accuracy: 0.98,
			rawScore: 70.5,
			score: 70,
			rank: null
		}))
	};
}

function createDatabase() {
	const value = new Database(':memory:');
	value.exec(`
		create table match_confirmations (
			match_number integer primary key, confirmed_at integer not null, confirmed_by text not null
		);
		create table match_results (
			match_number integer not null, lane_number integer not null, team_name text not null,
			representative_source text not null, correct_types integer not null,
			incorrect_types integer not null, completed_problems integer not null, wpm real not null,
			accuracy real not null, raw_score real not null, score integer not null, rank integer not null,
			problem_set_id text not null, problem_set_version integer not null, finished_at integer not null,
			primary key (match_number, lane_number)
		);
		create table match_attempts (
			match_number integer not null, attempt_number integer not null, problem_set_id text not null,
			problem_set_version integer not null, status text not null, started_at integer, ended_at integer,
			created_at integer not null, updated_at integer not null, reason text, operated_by text,
			primary key (match_number, attempt_number)
		);
		create table match_attempt_results (
			match_number integer not null, attempt_number integer not null, lane_number integer not null,
			team_name text not null, representative_source text not null, correct_types integer not null,
			incorrect_types integer not null, completed_problems integer not null, wpm real not null,
			accuracy real not null, raw_score real not null, score integer not null, rank integer,
			captured_at integer not null, primary key (match_number, attempt_number, lane_number)
		);
		create table match_disqualifications (
			match_number integer not null, lane_number integer not null, reason text not null,
			disqualified_at integer not null, disqualified_by text not null,
			primary key (match_number, lane_number)
		);
		create table match_operations (
			id integer primary key autoincrement, match_number integer not null,
			attempt_number integer not null, action text not null, lane_number integer,
			status_before text, status_after text, reason text,
			operated_at integer not null, operated_by text not null
		);
	`);
	return value;
}
