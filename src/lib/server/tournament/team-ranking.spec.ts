import { describe, expect, it } from 'vitest';
import { createTeamStandings, type MatchResultForTeamRanking } from './team-ranking';

function resultsForTeam(
	teamName: string,
	values: Pick<MatchResultForTeamRanking, 'score' | 'rawScore' | 'accuracy' | 'incorrectTypes'>
) {
	return [1, 2, 3].map((matchNumber) => ({ matchNumber, teamName, ...values }));
}

describe('team standings', () => {
	it('does not publish standings until all three matches are complete', () => {
		expect(
			createTeamStandings(resultsForTeam('1年生', baseResult()).slice(0, 2), ['1年生'])
		).toEqual([]);
	});

	it('sums the three integer scores and uses the specified tie breakers', () => {
		const results = [
			...resultsForTeam('1年生', baseResult({ score: 100, rawScore: 100.1 })),
			...resultsForTeam('2年生', baseResult({ score: 100, rawScore: 100.2 })),
			...resultsForTeam('3年生', baseResult({ score: 90, rawScore: 90.5 }))
		];

		expect(createTeamStandings(results, ['1年生', '2年生', '3年生'])).toMatchObject([
			{ teamName: '2年生', matchScores: [100, 100, 100], totalScore: 300, rank: 1 },
			{ teamName: '1年生', matchScores: [100, 100, 100], totalScore: 300, rank: 2 },
			{ teamName: '3年生', matchScores: [90, 90, 90], totalScore: 270, rank: 3 }
		]);
	});

	it('shares a rank only when every team comparison value is equal', () => {
		const results = [
			...resultsForTeam('1年生', baseResult()),
			...resultsForTeam('2年生', baseResult()),
			...resultsForTeam('3年生', baseResult({ score: 90, rawScore: 90 }))
		];

		expect(
			createTeamStandings(results, ['1年生', '2年生', '3年生']).map(({ rank }) => rank)
		).toEqual([1, 1, 3]);
	});

	it('uses average accuracy and then incorrect types when other totals tie', () => {
		const results = [
			...resultsForTeam('1年生', baseResult({ accuracy: 0.98, incorrectTypes: 4 })),
			...resultsForTeam('2年生', baseResult({ accuracy: 0.99, incorrectTypes: 6 })),
			...resultsForTeam('3年生', baseResult({ accuracy: 0.98, incorrectTypes: 3 }))
		];

		expect(
			createTeamStandings(results, ['1年生', '2年生', '3年生']).map(({ teamName, rank }) => ({
				teamName,
				rank
			}))
		).toEqual([
			{ teamName: '2年生', rank: 1 },
			{ teamName: '3年生', rank: 2 },
			{ teamName: '1年生', rank: 3 }
		]);
	});
});

function baseResult(
	overrides: Partial<
		Pick<MatchResultForTeamRanking, 'score' | 'rawScore' | 'accuracy' | 'incorrectTypes'>
	> = {}
) {
	return { score: 100, rawScore: 100.5, accuracy: 0.98, incorrectTypes: 4, ...overrides };
}
