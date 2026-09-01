import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { confirmMatchResults } from './result-confirmation.js';

function createDatabase() {
	const database = new Database(':memory:');
	database.exec(`
		create table match_results (
			match_number integer not null,
			lane_number integer not null,
			team_name text not null default '',
			representative_source text not null default '',
			correct_types integer not null default 0,
			incorrect_types integer not null default 0,
			completed_problems integer not null default 0,
			wpm real not null default 0,
			accuracy real not null default 0,
			raw_score real not null default 0,
			score integer not null default 0,
			rank integer not null default 1,
			problem_set_id text not null default 'typing-main-01',
			problem_set_version integer not null default 1,
			finished_at integer not null default 500,
			primary key (match_number, lane_number)
		);
		create table match_confirmations (
			match_number integer primary key,
			confirmed_at integer not null,
			confirmed_by text not null
		);
		create table match_attempts (
			match_number integer not null, attempt_number integer not null,
			problem_set_id text not null, problem_set_version integer not null, status text not null,
			started_at integer, ended_at integer, created_at integer not null, updated_at integer not null,
			reason text, operated_by text, primary key (match_number, attempt_number)
		);
		create table match_attempt_results (
			match_number integer not null, attempt_number integer not null, lane_number integer not null,
			team_name text not null, representative_source text not null, correct_types integer not null,
			incorrect_types integer not null, completed_problems integer not null, wpm real not null,
			accuracy real not null, raw_score real not null, score integer not null, rank integer,
			captured_at integer not null,
			primary key (match_number, attempt_number, lane_number)
		);
		create table match_operations (
			id integer primary key autoincrement, match_number integer not null,
			attempt_number integer not null, action text not null, lane_number integer,
			status_before text, status_after text, reason text, operated_at integer not null,
			operated_by text not null
		)
	`);
	return database;
}

describe('match result confirmation', () => {
	it('requires all six results', () => {
		const database = createDatabase();
		for (let laneNumber = 1; laneNumber <= 5; laneNumber += 1) {
			database
				.prepare('insert into match_results (match_number, lane_number) values (1, ?)')
				.run(laneNumber);
		}

		expect(confirmMatchResults(database, 1, 'admin', 1_000)).toEqual({
			confirmed: false,
			reason: 'incomplete_results'
		});
		expect(database.prepare('select * from match_confirmations').all()).toEqual([]);
		database.close();
	});

	it('confirms six results once and preserves the original audit values', () => {
		const database = createDatabase();
		for (let laneNumber = 1; laneNumber <= 6; laneNumber += 1) {
			database
				.prepare('insert into match_results (match_number, lane_number) values (1, ?)')
				.run(laneNumber);
		}

		expect(confirmMatchResults(database, 1, 'admin', 1_000)).toEqual({
			confirmed: true,
			alreadyConfirmed: false
		});
		expect(confirmMatchResults(database, 1, 'another-admin', 2_000)).toEqual({
			confirmed: true,
			alreadyConfirmed: true
		});
		expect(
			database
				.prepare(
					'select match_number as matchNumber, confirmed_at as confirmedAt, confirmed_by as confirmedBy from match_confirmations'
				)
				.all()
		).toEqual([{ matchNumber: 1, confirmedAt: 1_000, confirmedBy: 'admin' }]);
		expect(
			database.prepare('select status from match_attempts where match_number = 1').pluck().get()
		).toBe('confirmed');
		expect(
			database
				.prepare(
					'select action, status_before as statusBefore, status_after as statusAfter from match_operations'
				)
				.get()
		).toEqual({ action: 'confirm', statusBefore: 'finished', statusAfter: 'confirmed' });
		expect(database.prepare('select count(*) from match_attempt_results').pluck().get()).toBe(6);
		database.close();
	});
});
