export type CompetitionStatus =
	| 'waiting'
	| 'countdown'
	| 'running'
	| 'finished'
	| 'interrupted'
	| 'force_finished'
	| 'invalidated';

export type LaneStatus =
	| 'disconnected'
	| 'connected'
	| 'ready'
	| 'countdown'
	| 'running'
	| 'finished'
	| 'interrupted'
	| 'force_finished'
	| 'invalidated';

export type LaneSnapshot = {
	laneNumber: number;
	teamName: string;
	representativeSource: string;
	connected: boolean;
	ready: boolean;
	status: LaneStatus;
	problemIndex: number;
	problemCount: number;
	displayText: string;
	reading: string;
	romanizedText: string;
	inputPosition: number;
	correctTypes: number;
	incorrectTypes: number;
	completedProblems: number;
	accuracy: number;
	wpm: number;
	rawScore: number;
	score: number;
	progress: number;
	rank: number | null;
};

export type CompetitionSnapshot = {
	matchNumber: number;
	attemptNumber: number;
	problemSetId: string;
	problemSetVersion: number;
	durationSeconds: number;
	status: CompetitionStatus;
	serverTime: number;
	startsAt: number | null;
	endsAt: number | null;
	connectedCount: number;
	readyCount: number;
	lanes: LaneSnapshot[];
};

export type CompetitionAdminStatus = {
	matchNumber: number;
	attemptNumber: number;
	problemSetId: string;
	status: CompetitionStatus;
	connectedCount: number;
	readyCount: number;
};

export type CompetitionServerMessage =
	| { type: 'competition.snapshot'; data: CompetitionSnapshot }
	| { type: 'competition.finished'; data: { matchNumber: number } }
	| { type: 'competition.confirmed'; data: { matchNumber: number } }
	| { type: 'competition.invalidated'; data: { matchNumber: number } }
	| { type: 'competition.disqualified'; data: { matchNumber: number } }
	| { type: 'competition.retry-prepared'; data: { matchNumber: number } }
	| { type: 'competition.admin-status'; data: { matches: CompetitionAdminStatus[] } }
	| { type: 'typing.joined'; data: { matchNumber: number; laneNumber: number } }
	| {
			type: 'typing.input-result';
			data: { accepted: boolean; correct?: boolean; completedProblem?: boolean };
	  }
	| { type: 'system.error'; data: { code: string } };

export function webSocketUrl(): string {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${window.location.host}/ws`;
}
