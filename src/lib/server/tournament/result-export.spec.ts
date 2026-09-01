import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrReuseResultExport, getResultExportState } from './result-export';
import { teams } from './team-structure';

let database: Database.Database | undefined;

afterEach(() => database?.close());

describe('confirmed result JSON export', () => {
	it('is unavailable until all three matches are confirmed', () => {
		database = createDatabase();
		seedResults(database);
		database.prepare('insert into match_confirmations values (1, 1000, ?)').run('admin');

		expect(getResultExportState(database)).toMatchObject({
			ready: false,
			confirmedMatchNumbers: [1]
		});
		expect(createOrReuseResultExport(database, 'admin', 2_000)).toEqual({
			exported: false,
			reason: 'results_not_confirmed',
			confirmedMatchNumbers: [1]
		});
	});

	it('reuses an export ID for the same result and creates a new one after correction', () => {
		database = createDatabase();
		seedResults(database);
		for (const matchNumber of [1, 2, 3]) {
			database
				.prepare('insert into match_confirmations values (?, ?, ?)')
				.run(matchNumber, 1_000 + matchNumber, 'admin');
		}

		const first = createOrReuseResultExport(database, 'admin', 2_000);
		expect(first.exported).toBe(true);
		if (!first.exported) return;
		expect(first.exportId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		const document = JSON.parse(first.payload);
		expect(Object.keys(document)).toEqual(['schema_version', 'export_id', 'teams']);
		expect(document.schema_version).toBe('typing-results-v1');
		expect(document.teams).toHaveLength(6);
		expect(Object.keys(document.teams[0])).toEqual([
			'team_name',
			'match_1_score',
			'match_2_score',
			'match_3_score',
			'total_score',
			'rank'
		]);

		const second = createOrReuseResultExport(database, 'operator', 3_000);
		expect(second).toMatchObject({
			exported: true,
			reexported: true,
			exportId: first.exportId,
			payload: first.payload
		});
		expect(getResultExportState(database).currentExport).toMatchObject({
			exportId: first.exportId,
			exportCount: 2,
			lastExportedBy: 'operator'
		});

		database
			.prepare('insert into match_disqualifications values (1, 1, ?, 4000, ?)')
			.run('規定違反', 'admin');
		const corrected = createOrReuseResultExport(database, 'admin', 4_100);
		expect(corrected.exported).toBe(true);
		if (!corrected.exported) return;
		expect(corrected.exportId).not.toBe(first.exportId);
		expect(
			JSON.parse(corrected.payload).teams.find(
				(team: { team_name: string }) => team.team_name === '1年生'
			)
		).toMatchObject({ match_1_score: 0 });
		expect(getResultExportState(database).exports).toHaveLength(2);
	});
});

function seedResults(value: Database.Database) {
	const insert = value.prepare(
		`insert into match_results (
		 match_number, lane_number, team_name, score, raw_score, accuracy,
		 incorrect_types, finished_at
		) values (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const matchNumber of [1, 2, 3]) {
		for (const [teamIndex, team] of teams.entries()) {
			const score = 150 - teamIndex * 10 + matchNumber;
			insert.run(
				matchNumber,
				teamIndex + 1,
				team.name,
				score,
				score + 0.5,
				0.99 - teamIndex * 0.01,
				teamIndex,
				500 + matchNumber
			);
		}
	}
}

function createDatabase() {
	const value = new Database(':memory:');
	value.exec(`
		create table match_results (
			match_number integer not null, lane_number integer not null, team_name text not null,
			score integer not null, raw_score real not null, accuracy real not null,
			incorrect_types integer not null, finished_at integer not null,
			primary key (match_number, lane_number)
		);
		create table match_confirmations (
			match_number integer primary key, confirmed_at integer not null, confirmed_by text not null
		);
		create table match_disqualifications (
			match_number integer not null, lane_number integer not null, reason text not null,
			disqualified_at integer not null, disqualified_by text not null,
			primary key (match_number, lane_number)
		);
		create table result_exports (
			export_id text primary key, result_fingerprint text not null unique,
			content_sha256 text not null, payload text not null, created_at integer not null,
			created_by text not null, last_exported_at integer not null,
			last_exported_by text not null, export_count integer not null
		);
	`);
	return value;
}
