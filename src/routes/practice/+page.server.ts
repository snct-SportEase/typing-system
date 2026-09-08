import { env } from '$env/dynamic/private';
import specification from '../../../docs/typing-problem-presets-v1.json' with { type: 'json' };
import type { PageServerLoad } from './$types';

type ProblemPreset = {
	role: string;
	match_number?: number;
	problems: Array<{ display_text: string; reading: string }>;
};

export const load: PageServerLoad = () => {
	if (!env.TOURNAMENT_NAME) throw new Error('TOURNAMENT_NAME is not set');
	const preset = (specification.presets as ProblemPreset[]).find(
		(candidate) => candidate.role === 'main' && candidate.match_number === 1
	);
	if (!preset) throw new Error('Practice problem preset was not found');

	return {
		tournamentName: env.TOURNAMENT_NAME,
		problems: preset.problems.map((problem) => ({
			displayText: problem.display_text,
			reading: problem.reading
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
		].map((source) => ({ displayText: source, reading: source }))
	};
};
