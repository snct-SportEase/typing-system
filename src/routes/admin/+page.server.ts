import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { matchAssignments } from '$lib/server/db/schema';
import {
	changedLockedMatchNumbers,
	createDefaultAssignments,
	type MatchAssignment,
	validateAssignments
} from '$lib/server/tournament/match-assignments';
import {
	getMatchAttempts,
	getMatchAttemptResults,
	getMatchConfirmations,
	getMatchOperations,
	getMatchResults
} from '$lib/server/tournament/match-results';
import { getResultExportState } from '$lib/server/tournament/result-export';
import { teams } from '$lib/server/tournament/team-structure';
import { asc } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import Database from 'better-sqlite3';
import {
	requestCompetitionOperation,
	requestCompetitionStart,
	requestLockedAssignmentMatchNumbers
} from '../../../server/competition-controls.js';
import { confirmMatchResults } from '../../../server/result-confirmation.js';
import { publishResultNotification } from '../../../server/result-notifications.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (!env.TOURNAMENT_NAME) throw new Error('TOURNAMENT_NAME is not set');

	const savedAssignments = db
		.select()
		.from(matchAssignments)
		.orderBy(asc(matchAssignments.matchNumber), asc(matchAssignments.laneNumber))
		.all();
	const exportDatabase = new Database(env.DATABASE_URL ?? 'data/typing-system.db');
	exportDatabase.pragma('busy_timeout = 5000');
	let exportState;
	try {
		exportState = getResultExportState(exportDatabase);
	} finally {
		exportDatabase.close();
	}

	return {
		tournamentName: env.TOURNAMENT_NAME,
		teams,
		assignments: savedAssignments.length > 0 ? savedAssignments : createDefaultAssignments(),
		results: getMatchResults(),
		confirmations: getMatchConfirmations(),
		attempts: getMatchAttempts(),
		attemptResults: getMatchAttemptResults(),
		operations: getMatchOperations().reverse(),
		exportState
	};
};

export const actions = {
	saveAssignments: async ({ request }) => {
		const formData = await request.formData();
		const assignments: MatchAssignment[] = [1, 2, 3].flatMap((matchNumber) =>
			teams.map((team, teamIndex) => ({
				matchNumber,
				teamName: team.name,
				representativeSource: String(formData.get(`source_${matchNumber}_${teamIndex}`) ?? ''),
				laneNumber: team.laneNumber
			}))
		);

		const issues = validateAssignments(assignments);
		if (issues.length > 0) return fail(400, { issues, assignments });

		const currentAssignments = db.select().from(matchAssignments).all();
		const lockedMatchNumbers = new Set([
			...getMatchAttempts().map((attempt) => attempt.matchNumber),
			...getMatchResults().map((result) => result.matchNumber),
			...requestLockedAssignmentMatchNumbers()
		]);
		const changedLockedMatches = changedLockedMatchNumbers(
			currentAssignments,
			assignments,
			lockedMatchNumbers
		);
		if (changedLockedMatches.length > 0) {
			return fail(409, {
				issues: changedLockedMatches.map(
					(matchNumber) => `第${matchNumber}試合は開始済みのため割り当てを変更できません。`
				),
				assignments
			});
		}

		const updatedAt = new Date();
		db.transaction((transaction) => {
			transaction.delete(matchAssignments).run();
			transaction
				.insert(matchAssignments)
				.values(assignments.map((assignment) => ({ ...assignment, updatedAt })))
				.run();
		});

		return { saved: true };
	},
	startCompetition: async ({ request }) => {
		const formData = await request.formData();
		const matchNumber = Number(formData.get('matchNumber'));
		if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 3) {
			return fail(400, { startIssue: '試合番号が正しくありません。' });
		}
		if (getMatchResults().some((result) => result.matchNumber === matchNumber)) {
			return fail(409, { startIssue: `第${matchNumber}試合はすでに終了しています。` });
		}

		if (!env.ADMIN_USERNAME) throw new Error('ADMIN_USERNAME is not set');
		const result = requestCompetitionStart(matchNumber, env.ADMIN_USERNAME);
		if (!result.started) {
			const message =
				result.reason === 'not_ready'
					? `第${matchNumber}試合は全員の接続・準備が完了していません。`
					: result.reason === 'invalid_status'
						? `第${matchNumber}試合はすでに開始されています。`
						: result.reason === 'assignments_incomplete'
							? `第${matchNumber}試合の割り当てが不足しています。`
							: `第${matchNumber}試合の選手端末が接続されていません。`;
			return fail(409, { startIssue: message });
		}

		return { started: true, startedMatchNumber: matchNumber };
	},
	competitionOperation: async ({ request }) => {
		const formData = await request.formData();
		const action = String(formData.get('operation'));
		const matchNumber = Number(formData.get('matchNumber'));
		const laneNumber = Number(formData.get('laneNumber'));
		const reason = String(formData.get('reason') ?? '').trim();
		const allowedActions = [
			'interrupt',
			'force_finish',
			'invalidate',
			'retry',
			'disqualify'
		] as const;
		if (!allowedActions.includes(action as (typeof allowedActions)[number])) {
			return fail(400, { operationIssue: '操作の種類が正しくありません。' });
		}
		if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 3) {
			return fail(400, { operationIssue: '試合番号が正しくありません。' });
		}
		if (
			action === 'disqualify' &&
			(!Number.isInteger(laneNumber) || laneNumber < 1 || laneNumber > 6)
		) {
			return fail(400, { operationIssue: 'レーン番号が正しくありません。' });
		}
		if (['invalidate', 'retry', 'disqualify'].includes(action) && !reason) {
			return fail(400, { operationIssue: '理由を入力してください。' });
		}
		if (!env.ADMIN_USERNAME) throw new Error('ADMIN_USERNAME is not set');

		const result = requestCompetitionOperation({
			action: action as (typeof allowedActions)[number],
			matchNumber,
			laneNumber: action === 'disqualify' ? laneNumber : undefined,
			reason: reason || (action === 'interrupt' ? '管理者による中断' : '管理者による強制終了'),
			operatedBy: env.ADMIN_USERNAME
		});
		if (!result.completed) {
			const messages: Record<string, string> = {
				controller_unavailable: '競技サーバーに接続できません。',
				room_not_initialized: '選手端末が接続されていません。',
				invalid_status: '現在の試合状態では実行できません。',
				attempt_not_found: '対象の試技がありません。',
				match_not_invalidated: '再試合の前に試技を無効化してください。',
				reserve_exhausted: '利用できる予備問題がありません。',
				result_not_found: '対象の試合結果がありません。'
			};
			return fail(409, {
				operationIssue: messages[result.reason] ?? '操作を実行できませんでした。'
			});
		}

		return {
			operationCompleted: true,
			operationMatchNumber: matchNumber,
			operationAction: action,
			operationProblemSetId: result.problemSetId
		};
	},
	confirmResults: async ({ request }) => {
		const formData = await request.formData();
		const matchNumber = Number(formData.get('matchNumber'));
		if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 3) {
			return fail(400, { confirmationIssue: '試合番号が正しくありません。' });
		}
		if (!env.ADMIN_USERNAME) throw new Error('ADMIN_USERNAME is not set');

		const databaseUrl = env.DATABASE_URL ?? 'data/typing-system.db';
		const database = new Database(databaseUrl);
		database.pragma('busy_timeout = 5000');
		try {
			const result = confirmMatchResults(database, matchNumber, env.ADMIN_USERNAME);
			if (!result.confirmed) {
				return fail(409, {
					confirmationIssue: `第${matchNumber}試合は6名分の結果が揃っていません。`
				});
			}
		} finally {
			database.close();
		}

		publishResultNotification({
			type: 'competition.confirmed',
			data: { matchNumber }
		});
		return { confirmed: true, confirmedMatchNumber: matchNumber };
	}
} satisfies Actions;
