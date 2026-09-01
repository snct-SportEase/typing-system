import { describe, expect, it } from 'vitest';
import {
	changedLockedMatchNumbers,
	createDefaultAssignments,
	validateAssignments
} from './match-assignments';

describe('match assignments', () => {
	it('creates a valid three-match assignment', () => {
		const assignments = createDefaultAssignments();
		expect(assignments).toHaveLength(18);
		expect(validateAssignments(assignments)).toEqual([]);
	});

	it('rejects repeated classes and lanes', () => {
		const assignments = createDefaultAssignments();
		assignments.find(
			(assignment) => assignment.matchNumber === 2 && assignment.teamName === '1年生'
		)!.representativeSource = '1-1';
		assignments.find(
			(assignment) => assignment.matchNumber === 1 && assignment.teamName === '2年生'
		)!.laneNumber = 1;

		expect(validateAssignments(assignments)).toEqual(
			expect.arrayContaining([
				'1年生は3クラスを1試合ずつ割り当ててください。',
				'第1試合のレーンを1〜6で重複なく設定してください。'
			])
		);
	});

	it('detects changes only in locked matches', () => {
		const current = createDefaultAssignments();
		const next = structuredClone(current);
		next.find(
			(assignment) => assignment.matchNumber === 1 && assignment.teamName === '1年生'
		)!.representativeSource = '1-2';
		next.find(
			(assignment) => assignment.matchNumber === 2 && assignment.teamName === '2年生'
		)!.representativeSource = 'IT2';

		expect(changedLockedMatchNumbers(current, next, [1, 3])).toEqual([1]);
	});
});
