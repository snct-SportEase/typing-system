export type MatchResultForTeamRanking = {
	matchNumber: number;
	teamName: string;
	score: number;
	rawScore: number;
	accuracy: number;
	incorrectTypes: number;
};

export type TeamStanding = {
	teamName: string;
	matchScores: [number, number, number];
	totalScore: number;
	rawScoreTotal: number;
	accuracyAverage: number;
	incorrectTypesTotal: number;
	rank: number;
};

export function createTeamStandings(
	results: MatchResultForTeamRanking[],
	expectedTeamNames: string[]
): TeamStanding[] {
	const expectedResultCount = expectedTeamNames.length * 3;
	if (results.length !== expectedResultCount) return [];

	const summaries = expectedTeamNames.map((teamName) => {
		const teamResults = results
			.filter((result) => result.teamName === teamName)
			.sort((left, right) => left.matchNumber - right.matchNumber);
		if (
			teamResults.length !== 3 ||
			teamResults.some((result, index) => result.matchNumber !== index + 1)
		) {
			return null;
		}

		const matchScores = teamResults.map((result) => result.score) as [number, number, number];
		return {
			teamName,
			matchScores,
			totalScore: matchScores.reduce((total, score) => total + score, 0),
			rawScoreTotal: teamResults.reduce((total, result) => total + result.rawScore, 0),
			accuracyAverage:
				teamResults.reduce((total, result) => total + result.accuracy, 0) / teamResults.length,
			incorrectTypesTotal: teamResults.reduce((total, result) => total + result.incorrectTypes, 0)
		};
	});
	if (summaries.some((summary) => summary === null)) return [];

	const completeSummaries = summaries.filter((summary) => summary !== null);
	const standings = completeSummaries.map((summary) => ({
		...summary,
		rank:
			1 +
			completeSummaries.filter((candidate) => compareTeamSummaries(candidate, summary) < 0).length
	}));

	return standings.sort(
		(left, right) =>
			compareTeamSummaries(left, right) || left.teamName.localeCompare(right.teamName, 'ja')
	);
}

function compareTeamSummaries(left: Omit<TeamStanding, 'rank'>, right: Omit<TeamStanding, 'rank'>) {
	if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
	if (left.rawScoreTotal !== right.rawScoreTotal) return right.rawScoreTotal - left.rawScoreTotal;
	if (left.accuracyAverage !== right.accuracyAverage) {
		return right.accuracyAverage - left.accuracyAverage;
	}
	return left.incorrectTypesTotal - right.incorrectTypesTotal;
}
