import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	matchAttempts,
	matchAttemptResults,
	matchConfirmations,
	matchDisqualifications,
	matchOperations,
	matchResults
} from '$lib/server/db/schema';

export function getMatchResults() {
	const results = db
		.select()
		.from(matchResults)
		.orderBy(asc(matchResults.matchNumber), asc(matchResults.rank), asc(matchResults.laneNumber))
		.all();
	const disqualifications = db.select().from(matchDisqualifications).all();
	return createOfficialMatchResults(results, disqualifications);
}

export function createOfficialMatchResults(
	results: (typeof matchResults.$inferSelect)[],
	disqualifications: (typeof matchDisqualifications.$inferSelect)[]
) {
	const disqualificationByLane = new Map(
		disqualifications.map((entry) => [`${entry.matchNumber}-${entry.laneNumber}`, entry])
	);

	return results
		.map((result) => {
			const disqualification = disqualificationByLane.get(
				`${result.matchNumber}-${result.laneNumber}`
			);
			return {
				...result,
				calculatedScore: result.score,
				officialRawScore: disqualification ? 0 : result.rawScore,
				officialAccuracy: disqualification ? 0 : result.accuracy,
				score: disqualification ? 0 : result.score,
				disqualified: Boolean(disqualification),
				disqualificationReason: disqualification?.reason ?? null
			};
		})
		.map((result, _index, allResults) => ({
			...result,
			rank:
				1 +
				allResults.filter(
					(candidate) =>
						candidate.matchNumber === result.matchNumber &&
						compareOfficialResults(candidate, result) < 0
				).length
		}))
		.sort(
			(left, right) =>
				left.matchNumber - right.matchNumber ||
				left.rank - right.rank ||
				left.laneNumber - right.laneNumber
		);
}

export function getMatchConfirmations() {
	return db.select().from(matchConfirmations).orderBy(asc(matchConfirmations.matchNumber)).all();
}

export function getMatchAttempts() {
	return db
		.select()
		.from(matchAttempts)
		.orderBy(asc(matchAttempts.matchNumber), asc(matchAttempts.attemptNumber))
		.all();
}

export function getMatchAttemptResults() {
	return db
		.select()
		.from(matchAttemptResults)
		.orderBy(
			asc(matchAttemptResults.matchNumber),
			asc(matchAttemptResults.attemptNumber),
			asc(matchAttemptResults.laneNumber)
		)
		.all();
}

export function getMatchOperations() {
	return db.select().from(matchOperations).orderBy(asc(matchOperations.operatedAt)).all();
}

type OfficialRankingMetrics = {
	score: number;
	rawScore: number;
	accuracy: number;
	wpm: number;
	incorrectTypes: number;
};

function compareOfficialResults(left: OfficialRankingMetrics, right: OfficialRankingMetrics) {
	if (left.score !== right.score) return right.score - left.score;
	if (left.rawScore !== right.rawScore) return right.rawScore - left.rawScore;
	if (left.accuracy !== right.accuracy) return right.accuracy - left.accuracy;
	if (left.wpm !== right.wpm) return right.wpm - left.wpm;
	return left.incorrectTypes - right.incorrectTypes;
}
