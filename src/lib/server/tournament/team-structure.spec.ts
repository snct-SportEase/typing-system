import { describe, expect, it } from 'vitest';
import { participantSlots, teams } from './team-structure';

describe('fixed participant slots', () => {
	it('loads the six teams from the canonical document', () => {
		expect(teams).toHaveLength(6);
		expect(teams.map((team) => team.name)).toEqual([
			'1年生',
			'2年生',
			'3年生',
			'4年生',
			'5年生',
			'専攻科・教員'
		]);
	});

	it('uses representative sources as identifiers without personal names', () => {
		expect(participantSlots).toHaveLength(16);
		expect(participantSlots.map((slot) => slot.id)).toContain('1-1');
		expect(participantSlots.map((slot) => slot.id)).toContain('IS2');
		expect(participantSlots.map((slot) => slot.id)).toContain('専教');
		expect(participantSlots.every((slot) => !('name' in slot))).toBe(true);
	});

	it('assigns one fixed lane to each team', () => {
		expect(teams.map((team) => [team.name, team.laneNumber])).toEqual([
			['1年生', 1],
			['2年生', 2],
			['3年生', 3],
			['4年生', 4],
			['5年生', 5],
			['専攻科・教員', 6]
		]);
	});
});
