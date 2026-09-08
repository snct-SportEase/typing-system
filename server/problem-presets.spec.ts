import specification from '../docs/typing-problem-presets-v1.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

describe('competition problem presets', () => {
	it('各プリセットを日本語30問と英語10問の計40問で構成する', () => {
		for (const preset of specification.presets) {
			const englishProblems = preset.problems.filter((problem) => /^[ -~]+$/.test(problem.reading));
			const englishTypes = englishProblems.reduce<Record<string, number>>((counts, problem) => {
				counts[problem.type] = (counts[problem.type] ?? 0) + 1;
				return counts;
			}, {});

			expect(preset.version, preset.problem_set_id).toBe(3);
			expect(preset.problems, preset.problem_set_id).toHaveLength(40);
			expect(englishProblems, preset.problem_set_id).toHaveLength(10);
			expect(englishTypes, preset.problem_set_id).toEqual({
				word: 4,
				short_sentence: 3,
				long_sentence: 3
			});
			expect(preset.problems.map((problem) => problem.order)).toEqual(
				Array.from({ length: 40 }, (_, index) => index + 1)
			);
		}
	});
});
