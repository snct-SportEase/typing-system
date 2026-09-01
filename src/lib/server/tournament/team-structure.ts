import teamStructureDocument from '../../../../docs/typing-team-structure-v1.json';
import { z } from 'zod';

const fixedTeamSchema = z.object({
	team_name: z.string().min(1),
	representative_sources: z.array(z.string().min(1)).min(1),
	representative_count: z.number().int().positive(),
	participation_rule: z.literal('each_representative_plays_one_match')
});

const variableTeamSchema = z.object({
	team_name: z.string().min(1),
	representative_sources: z.array(z.string().min(1)).length(1),
	minimum_representatives: z.number().int().positive(),
	maximum_representatives: z.number().int().positive(),
	participation_rule: z.literal('one_representative_per_match_repetition_allowed')
});

const teamStructureSchema = z.object({
	schema_version: z.literal('typing-team-structure-v1'),
	representative_assignment: z.literal('decided_by_each_team'),
	match_assignment_is_fixed_by_system: z.literal(false),
	teams: z.array(z.union([fixedTeamSchema, variableTeamSchema])).length(6)
});

const teamStructure = teamStructureSchema.parse(teamStructureDocument);

export type ParticipantSlot = {
	id: string;
	representativeSource: string;
};

export type TeamDefinition = {
	name: string;
	laneNumber: number;
	representativeSources: string[];
	participantSlots: ParticipantSlot[];
};

export const teams: TeamDefinition[] = teamStructure.teams.map((team, teamIndex) => {
	if ('representative_count' in team) {
		if (team.representative_count !== team.representative_sources.length) {
			throw new Error(`${team.team_name}: representative count does not match its sources`);
		}

		return {
			name: team.team_name,
			laneNumber: teamIndex + 1,
			representativeSources: team.representative_sources,
			participantSlots: team.representative_sources.map((source) => ({
				id: source,
				representativeSource: source
			}))
		};
	}

	const source = team.representative_sources[0];
	if (team.minimum_representatives > team.maximum_representatives) {
		throw new Error(`${team.team_name}: invalid representative range`);
	}

	return {
		name: team.team_name,
		laneNumber: teamIndex + 1,
		representativeSources: team.representative_sources,
		participantSlots: [{ id: source, representativeSource: source }]
	};
});

export const participantSlots = teams.flatMap((team) => team.participantSlots);
