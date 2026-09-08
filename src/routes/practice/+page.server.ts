import { env } from '$env/dynamic/private';
import specification from '../../../docs/typing-problem-presets-v1.json' with { type: 'json' };
import type { PageServerLoad } from './$types';

type ProblemPreset = {
	problem_set_id: string;
	title: string;
	role: string;
	match_number?: number;
	reserve_priority?: number;
	problems: Array<{ display_text: string; reading: string }>;
};

export const load: PageServerLoad = () => {
	if (!env.TOURNAMENT_NAME) throw new Error('TOURNAMENT_NAME is not set');
	const presets = specification.presets as ProblemPreset[];
	if (presets.length === 0) throw new Error('Practice problem presets were not found');

	return {
		tournamentName: env.TOURNAMENT_NAME,
		presets: presets.map((preset) => ({
			id: preset.problem_set_id,
			title: preset.title,
			category:
				preset.role === 'main'
					? `本戦 第${preset.match_number}試合`
					: `予備 第${preset.reserve_priority}候補`,
			problems: preset.problems.map((problem) => ({
				displayText: problem.display_text,
				reading: problem.reading
			}))
		})),
		codeProblems: [
			'#include <stdio.h>',
			'int main(void) {',
			'    int score = 100;',
			'    const char *message = "hello, world";',
			'    printf("%s\\n", message);',
			'    printf("score: %d\\n", score);',
			'    return 0;',
			'}'
		].map((source) => ({ displayText: source, reading: source.replaceAll(' ', '') }))
	};
};
