import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTeamStandings, type TeamStanding } from './team-ranking';
import { teams } from './team-structure';

const schemaVersion = 'typing-results-v1';
const maxJsonBytes = 16 * 1024;
const expectedTeamNames = teams.map((team) => team.name);

type ResultVersionRow = {
	matchNumber: number;
	laneNumber: number;
	teamName: string;
	score: number;
	rawScore: number;
	accuracy: number;
	incorrectTypes: number;
	finishedAt: number;
	confirmedAt: number;
	disqualifiedAt: number | null;
};

type ExportRow = {
	exportId: string;
	resultFingerprint: string;
	contentSha256: string;
	payload: string;
	createdAt: number;
	createdBy: string;
	lastExportedAt: number;
	lastExportedBy: string;
	exportCount: number;
};

export type ResultExportTeam = {
	team_name: string;
	match_1_score: number;
	match_2_score: number;
	match_3_score: number;
	total_score: number;
	rank: number;
};

export type ResultExportDocument = {
	schema_version: typeof schemaVersion;
	export_id: string;
	teams: ResultExportTeam[];
};

export function getResultExportState(database: Database.Database) {
	const snapshot = createResultSnapshot(database);
	const exports = listResultExports(database);
	return {
		ready: snapshot.ready,
		confirmedMatchNumbers: snapshot.confirmedMatchNumbers,
		standings: snapshot.standings,
		currentExport: snapshot.resultFingerprint
			? (exports.find((entry) => entry.resultFingerprint === snapshot.resultFingerprint) ?? null)
			: null,
		exports
	};
}

export function createOrReuseResultExport(
	database: Database.Database,
	exportedBy: string,
	exportedAt = Date.now()
) {
	return database.transaction(() => {
		const snapshot = createResultSnapshot(database);
		if (!snapshot.ready || !snapshot.resultFingerprint) {
			return {
				exported: false as const,
				reason: 'results_not_confirmed' as const,
				confirmedMatchNumbers: snapshot.confirmedMatchNumbers
			};
		}

		const existing = getExportByFingerprint(database, snapshot.resultFingerprint);
		if (existing) {
			database
				.prepare(
					`update result_exports set last_exported_at = ?, last_exported_by = ?,
					 export_count = export_count + 1 where export_id = ?`
				)
				.run(exportedAt, exportedBy, existing.exportId);
			return {
				exported: true as const,
				reexported: true,
				exportId: existing.exportId,
				payload: existing.payload,
				contentSha256: existing.contentSha256
			};
		}

		const exportId = randomUUID();
		const document = createExportDocument(exportId, snapshot.standings);
		const payload = `${JSON.stringify(document, null, 2)}\n`;
		if (Buffer.byteLength(payload, 'utf8') > maxJsonBytes) {
			throw new Error('Result JSON exceeds 16 KiB');
		}
		const contentSha256 = sha256(payload);
		database
			.prepare(
				`insert into result_exports (
				 export_id, result_fingerprint, content_sha256, payload,
				 created_at, created_by, last_exported_at, last_exported_by, export_count
				) values (?, ?, ?, ?, ?, ?, ?, ?, 1)`
			)
			.run(
				exportId,
				snapshot.resultFingerprint,
				contentSha256,
				payload,
				exportedAt,
				exportedBy,
				exportedAt,
				exportedBy
			);
		return {
			exported: true as const,
			reexported: false,
			exportId,
			payload,
			contentSha256
		};
	})();
}

function createResultSnapshot(database: Database.Database) {
	const confirmedMatchNumbers = database
		.prepare('select match_number from match_confirmations order by match_number')
		.pluck()
		.all() as number[];
	const rows = database
		.prepare(
			`select r.match_number as matchNumber, r.lane_number as laneNumber,
			 r.team_name as teamName, r.score, r.raw_score as rawScore,
			 r.accuracy, r.incorrect_types as incorrectTypes, r.finished_at as finishedAt,
			 c.confirmed_at as confirmedAt, d.disqualified_at as disqualifiedAt
			 from match_results r
			 join match_confirmations c on c.match_number = r.match_number
			 left join match_disqualifications d
			   on d.match_number = r.match_number and d.lane_number = r.lane_number
			 order by r.match_number, r.lane_number`
		)
		.all() as ResultVersionRow[];
	const standings = createTeamStandings(
		rows.map((row) => ({
			matchNumber: row.matchNumber,
			teamName: row.teamName,
			score: row.disqualifiedAt === null ? row.score : 0,
			rawScore: row.disqualifiedAt === null ? row.rawScore : 0,
			accuracy: row.disqualifiedAt === null ? row.accuracy : 0,
			incorrectTypes: row.incorrectTypes
		})),
		expectedTeamNames
	);
	const ready =
		confirmedMatchNumbers.length === 3 &&
		confirmedMatchNumbers.every((matchNumber, index) => matchNumber === index + 1) &&
		rows.length === 18 &&
		standings.length === 6;

	return {
		ready,
		confirmedMatchNumbers,
		standings: ready ? standings : [],
		resultFingerprint: ready ? sha256(JSON.stringify(rows)) : null
	};
}

function createExportDocument(exportId: string, standings: TeamStanding[]): ResultExportDocument {
	return {
		schema_version: schemaVersion,
		export_id: exportId,
		teams: standings.map((standing) => {
			const values = [...standing.matchScores, standing.totalScore, standing.rank];
			if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 2_147_483_647)) {
				throw new Error(`Invalid export score for ${standing.teamName}`);
			}
			return {
				team_name: standing.teamName,
				match_1_score: standing.matchScores[0],
				match_2_score: standing.matchScores[1],
				match_3_score: standing.matchScores[2],
				total_score: standing.totalScore,
				rank: standing.rank
			};
		})
	};
}

function listResultExports(database: Database.Database) {
	const rows = database
		.prepare(
			`select export_id as exportId, result_fingerprint as resultFingerprint,
			 content_sha256 as contentSha256, payload, created_at as createdAt,
			 created_by as createdBy, last_exported_at as lastExportedAt,
			 last_exported_by as lastExportedBy, export_count as exportCount
			 from result_exports order by created_at desc`
		)
		.all() as ExportRow[];
	return rows.map(exportMetadata);
}

function getExportByFingerprint(database: Database.Database, resultFingerprint: string) {
	return database
		.prepare(
			`select export_id as exportId, result_fingerprint as resultFingerprint,
			 content_sha256 as contentSha256, payload, created_at as createdAt,
			 created_by as createdBy, last_exported_at as lastExportedAt,
			 last_exported_by as lastExportedBy, export_count as exportCount
			 from result_exports where result_fingerprint = ?`
		)
		.get(resultFingerprint) as ExportRow | undefined;
}

function exportMetadata(row: ExportRow) {
	return {
		exportId: row.exportId,
		resultFingerprint: row.resultFingerprint,
		contentSha256: row.contentSha256,
		createdAt: new Date(row.createdAt),
		createdBy: row.createdBy,
		lastExportedAt: new Date(row.lastExportedAt),
		lastExportedBy: row.lastExportedBy,
		exportCount: row.exportCount
	};
}

function sha256(value: string) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
