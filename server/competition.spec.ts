import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import {
	createCompetitionManager,
	createIndividualRanks,
	publishedRank,
	saveMatchResults
} from './competition.js';

type Result = {
	laneNumber: number;
	score: number;
	correctTypes: number;
	incorrectTypes: number;
};

function ranksFor(results: Result[]) {
	return [...createIndividualRanks(results).values()];
}

class TestSocket {
	readyState: number = WebSocket.OPEN;
	messages: Array<{ type: string; data: Record<string, unknown> }> = [];
	closeCode: number | undefined;
	closeReason: string | undefined;

	send(payload: string) {
		this.messages.push(JSON.parse(payload));
	}

	close(code: number, reason: string) {
		this.readyState = WebSocket.CLOSED;
		this.closeCode = code;
		this.closeReason = reason;
	}
}

describe('competition lane reconnection', () => {
	it('revokes the replaced connection before accepting the new connection', () => {
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'typing-system-reconnect-test-'));
		const databasePath = join(temporaryDirectory, 'test.db');
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = databasePath;
		const database = new Database(databasePath);
		database.exec(`
			create table match_attempts (
				match_number integer not null,
				attempt_number integer not null,
				problem_set_id text not null,
				problem_set_version integer not null,
				status text not null,
				started_at integer,
				ended_at integer,
				primary key (match_number, attempt_number)
			);
			create table match_assignments (
				match_number integer not null,
				team_name text not null,
				representative_source text not null,
				lane_number integer not null
			);
			insert into match_assignments values (1, '1年生', '1-1', 1);
		`);
		database.close();

		try {
			const manager = createCompetitionManager();
			const replaced = new TestSocket();
			const replacement = new TestSocket();
			const join = { type: 'typing.join', data: { matchNumber: 1, laneNumber: 1 } };

			manager.handle(replaced as unknown as WebSocket, join);
			manager.handle(replaced as unknown as WebSocket, { type: 'typing.ready' });
			manager.handle(replacement as unknown as WebSocket, join);
			manager.handle(replaced as unknown as WebSocket, { type: 'typing.ready' });

			const latestSnapshot = replacement.messages
				.filter((message) => message.type === 'competition.snapshot')
				.at(-1);
			const lane = (latestSnapshot?.data.lanes as Array<{ ready: boolean }>)[0];
			expect(replaced.closeCode).toBe(4001);
			expect(replaced.closeReason).toBe('lane_reconnected');
			expect(lane.ready).toBe(false);

			const admin = new TestSocket();
			manager.handle(admin as unknown as WebSocket, { type: 'admin.subscribe' });
			manager.handle(admin as unknown as WebSocket, { type: 'admin.subscribe' });
			expect(
				admin.messages.filter((message) => message.type === 'competition.admin-status')
			).toHaveLength(1);
		} finally {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	it('limits simultaneous admin subscribers', () => {
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = ':memory:';
		try {
			const manager = createCompetitionManager();
			const admins = Array.from({ length: 9 }, () => new TestSocket());
			for (const admin of admins) {
				manager.handle(admin as unknown as WebSocket, { type: 'admin.subscribe' });
			}

			expect(admins.slice(0, 8).every((admin) => admin.closeCode === undefined)).toBe(true);
			expect(admins[8].closeCode).toBe(1013);
			expect(admins[8].closeReason).toBe('admin_subscriber_limit');
		} finally {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
		}
	});

	it('drops typing bursts beyond the per-lane allowance', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'typing-system-rate-limit-test-'));
		const databasePath = join(temporaryDirectory, 'test.db');
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = databasePath;
		const database = new Database(databasePath);
		database.exec(`
			create table match_attempts (
				match_number integer not null, attempt_number integer not null,
				problem_set_id text not null, problem_set_version integer not null,
				status text not null, started_at integer, ended_at integer,
				created_at integer not null, updated_at integer not null,
				reason text, operated_by text,
				primary key (match_number, attempt_number)
			);
			create table match_operations (
				id integer primary key autoincrement, match_number integer not null,
				attempt_number integer not null, action text not null, lane_number integer,
				status_before text, status_after text, reason text,
				operated_at integer not null, operated_by text not null
			);
			create table match_assignments (
				match_number integer not null, team_name text not null,
				representative_source text not null, lane_number integer not null
			);
		`);
		for (let lane = 1; lane <= 6; lane += 1) {
			database
				.prepare('insert into match_assignments values (1, ?, ?, ?)')
				.run(`team-${lane}`, `source-${lane}`, lane);
		}
		database.close();

		try {
			const manager = createCompetitionManager();
			const players = Array.from({ length: 6 }, () => new TestSocket());
			for (let lane = 1; lane <= 6; lane += 1) {
				manager.handle(players[lane - 1] as unknown as WebSocket, {
					type: 'typing.join',
					data: { matchNumber: 1, laneNumber: lane }
				});
				manager.handle(players[lane - 1] as unknown as WebSocket, { type: 'typing.ready' });
			}
			expect(manager.start(1, 'test')).toEqual({ started: true });
			vi.advanceTimersByTime(3_000);

			for (const key of 'aozora') {
				manager.handle(players[0] as unknown as WebSocket, {
					type: 'typing.input',
					data: { key }
				});
			}
			const acceptedInputs = players[0].messages.filter(
				(message) => message.type === 'typing.input-result'
			);
			expect(acceptedInputs).toHaveLength(3);
		} finally {
			vi.useRealTimers();
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	it('reloads assignments cached before setup is complete', () => {
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'typing-system-assignment-test-'));
		const databasePath = join(temporaryDirectory, 'test.db');
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = databasePath;
		const database = new Database(databasePath);
		database.exec(`
			create table match_attempts (
				match_number integer not null,
				attempt_number integer not null,
				problem_set_id text not null,
				problem_set_version integer not null,
				status text not null,
				started_at integer,
				ended_at integer,
				primary key (match_number, attempt_number)
			);
			create table match_assignments (
				match_number integer not null,
				team_name text not null,
				representative_source text not null,
				lane_number integer not null
			);
		`);

		try {
			const manager = createCompetitionManager();
			const monitor = new TestSocket();
			manager.handle(monitor as unknown as WebSocket, {
				type: 'monitor.subscribe',
				data: { matchNumber: 1 }
			});
			database
				.prepare('insert into match_assignments values (?, ?, ?, ?)')
				.run(1, '1年生', '1-1', 1);

			const player = new TestSocket();
			manager.handle(player as unknown as WebSocket, {
				type: 'typing.join',
				data: { matchNumber: 1, laneNumber: 1 }
			});

			expect(player.messages.some((message) => message.type === 'typing.joined')).toBe(true);
			expect(
				player.messages.some(
					(message) =>
						message.type === 'system.error' && message.data.code === 'assignment_not_found'
				)
			).toBe(false);
		} finally {
			database.close();
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	it('restores persisted lane results for a finished room', () => {
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'typing-system-results-test-'));
		const databasePath = join(temporaryDirectory, 'test.db');
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = databasePath;
		const database = new Database(databasePath);
		database.exec(`
			create table match_attempts (
				match_number integer not null, attempt_number integer not null,
				problem_set_id text not null, problem_set_version integer not null,
				status text not null, started_at integer, ended_at integer,
				primary key (match_number, attempt_number)
			);
			create table match_assignments (
				match_number integer not null, team_name text not null,
				representative_source text not null, lane_number integer not null
			);
			create table match_results (
				match_number integer not null, lane_number integer not null,
				team_name text not null, representative_source text not null,
				correct_types integer not null, incorrect_types integer not null,
				completed_problems integer not null, wpm real not null, accuracy real not null,
				raw_score real not null, score integer not null, rank integer not null,
				problem_set_id text not null, problem_set_version integer not null,
				finished_at integer not null, primary key (match_number, lane_number)
			);
			insert into match_assignments values (1, '1年生', '1-1', 1);
			insert into match_attempts values
				(1, 1, 'typing-main-01', 1, 'confirmed', 1000, 181000);
			insert into match_results values
				(1, 1, '1年生', '1-1', 419, 5, 12, 139, 0.98, 195.5, 195, 1,
				 'typing-main-01', 1, 181000);
		`);
		database.close();

		try {
			const manager = createCompetitionManager();
			const monitor = new TestSocket();
			manager.handle(monitor as unknown as WebSocket, {
				type: 'monitor.subscribe',
				data: { matchNumber: 1 }
			});
			const snapshot = monitor.messages.find(
				(message) => message.type === 'competition.snapshot'
			)?.data;
			const restoredLane = (snapshot?.lanes as Array<Record<string, unknown>>)[0];

			expect(snapshot?.status).toBe('finished');
			expect(restoredLane).toMatchObject({
				status: 'finished',
				correctTypes: 419,
				incorrectTypes: 5,
				wpm: 139,
				score: 195,
				rank: 1
			});
		} finally {
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});
});

describe('individual competition ranking', () => {
	it('publishes ranks only after the competition finishes', () => {
		expect(publishedRank('waiting', 1)).toBeNull();
		expect(publishedRank('countdown', 1)).toBeNull();
		expect(publishedRank('running', 1)).toBeNull();
		expect(publishedRank('finished', 1)).toBe(1);
	});

	it('uses the raw score when integer scores are tied', () => {
		expect(
			ranksFor([
				{ laneNumber: 1, score: 100, correctTypes: 301, incorrectTypes: 0 },
				{ laneNumber: 2, score: 100, correctTypes: 300, incorrectTypes: 0 }
			])
		).toEqual([1, 2]);
	});

	it('uses accuracy when raw scores are tied', () => {
		expect(
			ranksFor([
				{ laneNumber: 1, score: 0, correctTypes: 8, incorrectTypes: 8 },
				{ laneNumber: 2, score: 0, correctTypes: 1, incorrectTypes: 0 }
			])
		).toEqual([2, 1]);
	});

	it('uses fewer incorrect types after the other metrics tie', () => {
		expect(
			ranksFor([
				{ laneNumber: 1, score: 0, correctTypes: 0, incorrectTypes: 2 },
				{ laneNumber: 2, score: 0, correctTypes: 0, incorrectTypes: 1 }
			])
		).toEqual([2, 1]);
	});

	it('shares a rank only when all comparison values are equal', () => {
		expect(
			ranksFor([
				{ laneNumber: 1, score: 100, correctTypes: 300, incorrectTypes: 0 },
				{ laneNumber: 2, score: 100, correctTypes: 300, incorrectTypes: 0 },
				{ laneNumber: 3, score: 50, correctTypes: 150, incorrectTypes: 0 }
			])
		).toEqual([1, 1, 3]);
	});
});

describe('finished competition results', () => {
	it('replaces the saved results for a match atomically', () => {
		const database = new Database(':memory:');
		database.exec(`
			create table match_confirmations (
				match_number integer primary key,
				confirmed_at integer not null,
				confirmed_by text not null
			);
			create table match_results (
				match_number integer not null,
				lane_number integer not null,
				team_name text not null,
				representative_source text not null,
				correct_types integer not null,
				incorrect_types integer not null,
				completed_problems integer not null,
				wpm real not null,
				accuracy real not null,
				raw_score real not null,
				score integer not null,
				rank integer not null,
				problem_set_id text not null,
				problem_set_version integer not null,
				finished_at integer not null,
				primary key (match_number, lane_number)
			);
			create table match_attempts (
				match_number integer not null,
				attempt_number integer not null,
				problem_set_id text not null,
				problem_set_version integer not null,
				status text not null,
				started_at integer,
				ended_at integer,
				created_at integer not null,
				updated_at integer not null,
				reason text,
				operated_by text,
				primary key (match_number, attempt_number)
			);
			create table match_attempt_results (
				match_number integer not null,
				attempt_number integer not null,
				lane_number integer not null,
				team_name text not null,
				representative_source text not null,
				correct_types integer not null,
				incorrect_types integer not null,
				completed_problems integer not null,
				wpm real not null,
				accuracy real not null,
				raw_score real not null,
				score integer not null,
				rank integer,
				captured_at integer not null,
				primary key (match_number, attempt_number, lane_number)
			)
		`);

		const result = (laneNumber: number, rank: number, score: number) => ({
			laneNumber,
			teamName: `${laneNumber}年生`,
			representativeSource: `IS${laneNumber}`,
			correctTypes: score,
			incorrectTypes: 0,
			completedProblems: 1,
			wpm: score / 3,
			accuracy: 1,
			rawScore: score + 0.5,
			score,
			rank
		});
		const snapshot = (lanes: ReturnType<typeof result>[]) => ({
			matchNumber: 1,
			problemSetId: 'match-1-main-v1',
			problemSetVersion: 1,
			lanes
		});

		saveMatchResults(database, snapshot([result(1, 1, 120), result(2, 1, 120)]), 1_000);
		saveMatchResults(database, snapshot([result(2, 1, 130)]), 2_000);

		expect(
			database
				.prepare(
					'select lane_number as laneNumber, rank, score, finished_at as finishedAt from match_results'
				)
				.all()
		).toEqual([{ laneNumber: 2, rank: 1, score: 130, finishedAt: 2_000 }]);

		database.prepare('insert into match_confirmations values (1, 2000, ?)').run('admin');
		expect(() => saveMatchResults(database, snapshot([result(1, 1, 140)]), 3_000)).toThrow(
			'Results for match 1 are already confirmed'
		);
		database.close();
	});
});
