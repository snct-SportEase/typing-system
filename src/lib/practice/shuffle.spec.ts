import { describe, expect, it } from 'vitest';
import { shuffleProblems } from './shuffle.js';

describe('shuffleProblems', () => {
	it('プリセット自体を変更せずに出題順を並べ替える', () => {
		const problems = ['A', 'B', 'C', 'D'];

		expect(shuffleProblems(problems, () => 0)).toEqual(['B', 'C', 'D', 'A']);
		expect(problems).toEqual(['A', 'B', 'C', 'D']);
	});
});
