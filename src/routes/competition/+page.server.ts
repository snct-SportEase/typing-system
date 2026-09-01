import { env } from '$env/dynamic/private';
import { getSavedAssignments } from '$lib/server/tournament/saved-assignments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (!env.TOURNAMENT_NAME) throw new Error('TOURNAMENT_NAME is not set');
	return { tournamentName: env.TOURNAMENT_NAME, assignments: getSavedAssignments() };
};
