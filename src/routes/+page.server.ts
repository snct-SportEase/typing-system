import { env } from '$env/dynamic/private';
import { getMatchConfirmations, getMatchResults } from '$lib/server/tournament/match-results';
import { getSavedAssignments } from '$lib/server/tournament/saved-assignments';
import { createTeamStandings } from '$lib/server/tournament/team-ranking';
import { teams } from '$lib/server/tournament/team-structure';

export const load = () => {
	if (!env.TOURNAMENT_NAME) throw new Error('TOURNAMENT_NAME is not set');

	const results = getMatchResults();
	const confirmedMatchNumbers = getMatchConfirmations().map(
		(confirmation) => confirmation.matchNumber
	);
	const confirmedMatchNumberSet = new Set(confirmedMatchNumbers);
	return {
		tournamentName: env.TOURNAMENT_NAME,
		teams,
		assignments: getSavedAssignments(),
		results,
		confirmedMatchNumbers,
		teamStandings: createTeamStandings(
			results
				.filter((result) => confirmedMatchNumberSet.has(result.matchNumber))
				.map((result) => ({
					...result,
					rawScore: result.officialRawScore,
					accuracy: result.officialAccuracy
				})),
			teams.map((team) => team.name)
		)
	};
};
