import { describe, expect, it } from 'vitest';
import { createOfficialMatchResults } from './match-results';

describe('official match results', () => {
	it('sets a disqualified result to zero and recalculates shared ranks', () => {
		const results = [
			result(1, 120, 120.5, 0.98, 130, 2),
			result(2, 90, 90.5, 0.95, 110, 4),
			result(3, 0, 0, 0, 0, 8)
		];
		const official = createOfficialMatchResults(results, [
			{
				matchNumber: 1,
				laneNumber: 1,
				reason: '規定違反',
				disqualifiedAt: new Date(2_000),
				disqualifiedBy: 'admin'
			}
		]);

		expect(
			official.map(({ laneNumber, score, rank, disqualified }) => ({
				laneNumber,
				score,
				rank,
				disqualified
			}))
		).toEqual([
			{ laneNumber: 2, score: 90, rank: 1, disqualified: false },
			{ laneNumber: 1, score: 0, rank: 2, disqualified: true },
			{ laneNumber: 3, score: 0, rank: 3, disqualified: false }
		]);
		expect(official.find((entry) => entry.laneNumber === 1)?.calculatedScore).toBe(120);
	});
});

function result(
	laneNumber: number,
	score: number,
	rawScore: number,
	accuracy: number,
	wpm: number,
	incorrectTypes: number
) {
	return {
		matchNumber: 1,
		laneNumber,
		teamName: `${laneNumber}年生`,
		representativeSource: `IS${laneNumber}`,
		correctTypes: score,
		incorrectTypes,
		completedProblems: 1,
		wpm,
		accuracy,
		rawScore,
		score,
		rank: laneNumber,
		problemSetId: 'typing-main-01',
		problemSetVersion: 1,
		finishedAt: new Date(1_000)
	};
}
