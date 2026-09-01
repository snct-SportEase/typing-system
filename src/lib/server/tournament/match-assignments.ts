import { teams } from './team-structure';

export type MatchAssignment = {
	matchNumber: number;
	teamName: string;
	representativeSource: string;
	laneNumber: number;
};

export function createDefaultAssignments(): MatchAssignment[] {
	return [1, 2, 3].flatMap((matchNumber) =>
		teams.map((team) => ({
			matchNumber,
			teamName: team.name,
			representativeSource:
				team.representativeSources[matchNumber - 1] ?? team.representativeSources[0],
			laneNumber: team.laneNumber
		}))
	);
}

export function validateAssignments(assignments: MatchAssignment[]): string[] {
	const issues: string[] = [];
	const expectedAssignmentCount = teams.length * 3;

	if (assignments.length !== expectedAssignmentCount) {
		issues.push(`試合割り当ては${expectedAssignmentCount}件必要です。`);
	}

	const assignmentKeys = new Set<string>();
	for (const assignment of assignments) {
		const team = teams.find((candidate) => candidate.name === assignment.teamName);
		if (!team) {
			issues.push(`不明なチームです: ${assignment.teamName}`);
			continue;
		}

		if (![1, 2, 3].includes(assignment.matchNumber)) {
			issues.push(`${team.name}: 試合番号が不正です。`);
		}

		if (!team.representativeSources.includes(assignment.representativeSource)) {
			issues.push(`${team.name}: 出場クラスが不正です。`);
		}

		if (!Number.isInteger(assignment.laneNumber) || assignment.laneNumber !== team.laneNumber) {
			issues.push(`${team.name}のレーンは${team.laneNumber}です。`);
		}

		const key = `${assignment.matchNumber}:${team.name}`;
		if (assignmentKeys.has(key)) issues.push(`割り当てが重複しています: ${key}`);
		assignmentKeys.add(key);
	}

	for (const matchNumber of [1, 2, 3]) {
		const matchEntries = assignments.filter((assignment) => assignment.matchNumber === matchNumber);
		const lanes = matchEntries.map((assignment) => assignment.laneNumber);
		if (matchEntries.length !== teams.length || new Set(lanes).size !== teams.length) {
			issues.push(`第${matchNumber}試合のレーンを1〜6で重複なく設定してください。`);
		}
	}

	for (const team of teams) {
		if (team.representativeSources.length === 1) continue;

		const assignedSources = assignments
			.filter((assignment) => assignment.teamName === team.name)
			.map((assignment) => assignment.representativeSource);
		if (
			assignedSources.length !== team.representativeSources.length ||
			new Set(assignedSources).size !== team.representativeSources.length
		) {
			issues.push(`${team.name}は3クラスを1試合ずつ割り当ててください。`);
		}
	}

	return [...new Set(issues)];
}

export function changedLockedMatchNumbers(
	currentAssignments: MatchAssignment[],
	nextAssignments: MatchAssignment[],
	lockedMatchNumbers: Iterable<number>
): number[] {
	return [...new Set(lockedMatchNumbers)].filter((matchNumber) => {
		const normalize = (assignments: MatchAssignment[]) =>
			assignments
				.filter((assignment) => assignment.matchNumber === matchNumber)
				.map(({ teamName, representativeSource, laneNumber }) => ({
					teamName,
					representativeSource,
					laneNumber
				}))
				.sort((left, right) => left.laneNumber - right.laneNumber);
		return (
			JSON.stringify(normalize(currentAssignments)) !== JSON.stringify(normalize(nextAssignments))
		);
	});
}
