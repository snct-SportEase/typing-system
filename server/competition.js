import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { registerCompetitionController } from './competition-controls.js';
import {
	disqualifyLane,
	getLatestAttempt,
	getUsedProblemSetIds,
	invalidateMatch,
	prepareRetry,
	recordAttemptStarted,
	recordStoppedAttempt,
	saveAttemptResults
} from './competition-operations.js';
import {
	addResultSubscriber,
	publishResultNotification,
	removeResultSubscriber
} from './result-notifications.js';
import { applyTypingEvent, createTypingState, getTypingView } from './typing-engine.js';

/**
 * @typedef {{ problem_id: string, display_text: string, reading: string }} ProblemPresetEntry
 * @typedef {{ problem_set_id: string, version: number, role: 'main' | 'reserve', match_number?: number, reserve_priority?: number, problems: ProblemPresetEntry[] }} ProblemPreset
 * @typedef {{ laneNumber: number, teamName: string, representativeSource: string }} Assignment
 * @typedef {{ laneNumber: number, correctTypes: number, incorrectTypes: number, completedProblems: number, wpm: number, accuracy: number, rawScore: number, score: number, rank: number }} PersistedMatchResult
 * @typedef {{ laneNumber: number, teamName: string, representativeSource: string, correctTypes: number, incorrectTypes: number, completedProblems: number, wpm: number, accuracy: number, rawScore: number, score: number, rank: number | null }} FinishedLaneResult
 * @typedef {{ matchNumber: number, problemSetId: string, problemSetVersion: number, startsAt?: number | null, lanes: FinishedLaneResult[] }} FinishedResultSnapshot
 */

/** @type {{ duration_seconds: number, presets: ProblemPreset[] }} */
const problemPresets = JSON.parse(
	readFileSync(new URL('../docs/typing-problem-presets-v1.json', import.meta.url), 'utf8')
);
const durationSeconds = problemPresets.duration_seconds;
const countdownMilliseconds = 3_000;
const maxAdminSubscribers = 8;
const inputRatePerSecond = 25;
const inputBurstCapacity = 3;
/** @type {Map<number, ProblemPreset>} */
const mainPresets = new Map(
	problemPresets.presets
		.filter((preset) => preset.role === 'main' && preset.match_number !== undefined)
		.map((preset) => [preset.match_number ?? 0, preset])
);
const reservePresets = problemPresets.presets
	.filter((preset) => preset.role === 'reserve')
	.sort((left, right) => (left.reserve_priority ?? 0) - (right.reserve_priority ?? 0));
const allPresets = new Map(problemPresets.presets.map((preset) => [preset.problem_set_id, preset]));

export function createCompetitionManager() {
	const rooms = new Map();
	const connections = new WeakMap();
	const adminSubscribers = new Set();
	/** @type {ReturnType<typeof createAdminStatusMessage> | undefined} */
	let cachedAdminStatusMessage;
	let cachedAdminStatusUntil = 0;

	const manager = {
		/** @param {WebSocket} webSocket @param {any} message */
		handle(webSocket, message) {
			if (message.type === 'admin.subscribe') {
				if (connections.get(webSocket)?.role === 'admin') return true;
				if (adminSubscribers.size >= maxAdminSubscribers) {
					send(webSocket, {
						type: 'system.error',
						data: { code: 'admin_subscriber_limit' }
					});
					webSocket.close(1013, 'admin_subscriber_limit');
					return true;
				}
				leaveCurrentConnection(webSocket);
				adminSubscribers.add(webSocket);
				connections.set(webSocket, { role: 'admin' });
				sendAdminStatus(webSocket);
				return true;
			}

			if (message.type === 'results.subscribe') {
				leaveCurrentConnection(webSocket);
				addResultSubscriber(webSocket);
				connections.set(webSocket, { role: 'results' });
				return true;
			}

			if (message.type === 'monitor.subscribe') {
				leaveCurrentConnection(webSocket);
				const room = roomFor(message.data.matchNumber);
				room.monitors.add(webSocket);
				connections.set(webSocket, { role: 'monitor', room });
				sendSnapshot(room, webSocket);
				return true;
			}

			if (message.type === 'typing.join') {
				leaveCurrentConnection(webSocket);
				const room = roomFor(message.data.matchNumber);
				const lane = room.lanes.get(message.data.laneNumber);
				if (!lane) {
					send(webSocket, {
						type: 'system.error',
						data: { code: 'assignment_not_found' }
					});
					return true;
				}

				if (lane.webSocket && lane.webSocket !== webSocket) {
					const replacedWebSocket = lane.webSocket;
					connections.delete(replacedWebSocket);
					send(replacedWebSocket, {
						type: 'system.error',
						data: { code: 'lane_reconnected' }
					});
					replacedWebSocket.close(4001, 'lane_reconnected');
				}
				if (lane.webSocket !== webSocket && room.status === 'waiting') lane.ready = false;
				lane.webSocket = webSocket;
				lane.connected = true;
				connections.set(webSocket, { role: 'player', room, lane });
				send(webSocket, {
					type: 'typing.joined',
					data: { matchNumber: room.matchNumber, laneNumber: lane.laneNumber }
				});
				broadcastSnapshot(room);
				broadcastAdminStatus();
				return true;
			}

			const connection = connections.get(webSocket);
			if (message.type === 'typing.ready') {
				if (connection?.role !== 'player' || connection.room.status !== 'waiting') return true;
				connection.lane.ready = true;
				broadcastSnapshot(connection.room);
				broadcastAdminStatus();
				return true;
			}

			if (message.type === 'typing.input') {
				if (connection?.role !== 'player' || connection.room.status !== 'running') return true;
				const now = Date.now();
				if (now >= connection.room.endsAt) finishRoom(connection.room);
				else if (!consumeInputAllowance(connection.lane, now)) return true;
				else {
					const result = applyTypingEvent(
						connection.lane.typingState,
						{ type: 'key', ...message.data },
						now,
						connection.room.startsAt,
						connection.room.endsAt
					);
					if (result.accepted) {
						send(webSocket, { type: 'typing.input-result', data: result });
						broadcastSnapshot(connection.room);
					}
				}
				return true;
			}

			return false;
		},

		/** @param {WebSocket} webSocket */
		disconnect(webSocket) {
			leaveCurrentConnection(webSocket);
		},

		lockedAssignmentMatchNumbers() {
			return [...rooms.values()]
				.filter((room) => room.status !== 'waiting')
				.map((room) => room.matchNumber);
		},

		/** @param {number} matchNumber @param {string} operatedBy */
		start(matchNumber, operatedBy) {
			const room = rooms.get(matchNumber);
			if (!room) return { started: false, reason: 'room_not_initialized' };
			return startRoom(room, operatedBy);
		},

		/** @param {import('./competition-controls.js').CompetitionOperation} operation */
		operate(operation) {
			const room = rooms.get(operation.matchNumber);
			if (operation.action === 'interrupt' || operation.action === 'force_finish') {
				if (!room) return { completed: false, reason: 'room_not_initialized' };
				return stopCompetition(room, operation.action, operation.operatedBy, operation.reason);
			}

			const database = openDatabase();
			try {
				if (operation.action === 'invalidate') {
					const result = invalidateMatch(
						database,
						operation.matchNumber,
						operation.operatedBy,
						operation.reason
					);
					if (!result.invalidated) return { completed: false, reason: result.reason };
					if (room) setRoomTerminalStatus(room, 'invalidated');
					publishResultNotification({
						type: 'competition.invalidated',
						data: { matchNumber: operation.matchNumber }
					});
					broadcastAdminStatus();
					return { completed: true, attemptNumber: result.attemptNumber };
				}

				if (operation.action === 'retry') {
					const usedProblemSetIds = new Set(getUsedProblemSetIds(database));
					const preset = reservePresets.find(
						(candidate) => !usedProblemSetIds.has(candidate.problem_set_id)
					);
					if (!preset) return { completed: false, reason: 'reserve_exhausted' };
					const result = prepareRetry(
						database,
						operation.matchNumber,
						{ problemSetId: preset.problem_set_id, problemSetVersion: preset.version },
						operation.operatedBy,
						operation.reason
					);
					if (!result.prepared || result.attemptNumber === undefined) {
						return { completed: false, reason: result.reason };
					}
					if (room) resetRoom(room, preset, result.attemptNumber);
					publishResultNotification({
						type: 'competition.retry-prepared',
						data: { matchNumber: operation.matchNumber }
					});
					broadcastAdminStatus();
					return {
						completed: true,
						attemptNumber: result.attemptNumber,
						problemSetId: preset.problem_set_id
					};
				}

				if (operation.action === 'disqualify') {
					if (!operation.laneNumber) return { completed: false, reason: 'invalid_lane' };
					const result = disqualifyLane(
						database,
						operation.matchNumber,
						operation.laneNumber,
						operation.operatedBy,
						operation.reason
					);
					if (!result.disqualified) return { completed: false, reason: result.reason };
					publishResultNotification({
						type: 'competition.disqualified',
						data: { matchNumber: operation.matchNumber }
					});
					return { completed: true };
				}
			} finally {
				database.close();
			}
			return { completed: false, reason: 'unsupported_operation' };
		}
	};
	registerCompetitionController(manager);
	return manager;

	/** @param {number} matchNumber */
	function roomFor(matchNumber) {
		let room = rooms.get(matchNumber);
		if (room) {
			synchronizeWaitingRoomAssignments(room);
			return room;
		}

		const latestAttempt = readLatestAttempt(matchNumber);
		const preset = latestAttempt
			? allPresets.get(latestAttempt.problemSetId)
			: mainPresets.get(matchNumber);
		if (!preset) throw new Error(`Problem preset for match ${matchNumber} was not found`);
		const problems = preset.problems.map((problem) => ({
			displayText: problem.display_text,
			reading: problem.reading
		}));
		const assignments = loadAssignments(matchNumber);
		const persistedResults = new Map(
			latestAttempt && ['finished', 'confirmed'].includes(latestAttempt.status)
				? loadMatchResults(matchNumber).map((result) => [result.laneNumber, result])
				: []
		);
		room = {
			matchNumber,
			attemptNumber: latestAttempt?.attemptNumber ?? 1,
			problemSetId: preset.problem_set_id,
			problemSetVersion: preset.version,
			status: restoredRoomStatus(latestAttempt?.status),
			startsAt: latestAttempt?.startedAt ?? null,
			endsAt: latestAttempt?.endedAt ?? null,
			startOperatedBy: null,
			ticker: null,
			problems,
			monitors: new Set(),
			notifyAdmin: broadcastAdminStatus,
			lanes: new Map(
				assignments.map((assignment) => [
					assignment.laneNumber,
					{
						...assignment,
						connected: false,
						ready: false,
						webSocket: null,
						persistedResult: persistedResults.get(assignment.laneNumber) ?? null,
						inputTokens: inputBurstCapacity,
						inputTokenUpdatedAt: Date.now(),
						typingState: createTypingState(problems)
					}
				])
			)
		};
		rooms.set(matchNumber, room);
		return room;
	}

	/** @param {any} room */
	function synchronizeWaitingRoomAssignments(room) {
		if (room.status !== 'waiting') return;

		const assignments = loadAssignments(room.matchNumber);
		const assignedLaneNumbers = new Set(assignments.map((assignment) => assignment.laneNumber));
		for (const assignment of assignments) {
			const lane = room.lanes.get(assignment.laneNumber);
			if (lane) {
				lane.teamName = assignment.teamName;
				lane.representativeSource = assignment.representativeSource;
				continue;
			}
			room.lanes.set(assignment.laneNumber, {
				...assignment,
				connected: false,
				ready: false,
				webSocket: null,
				persistedResult: null,
				inputTokens: inputBurstCapacity,
				inputTokenUpdatedAt: Date.now(),
				typingState: createTypingState(room.problems)
			});
		}

		for (const [laneNumber, lane] of room.lanes) {
			if (!assignedLaneNumbers.has(laneNumber) && !lane.connected) {
				room.lanes.delete(laneNumber);
			}
		}
	}

	/** @param {WebSocket} webSocket */
	function leaveCurrentConnection(webSocket) {
		const connection = connections.get(webSocket);
		if (!connection) return;
		connections.delete(webSocket);

		if (connection.role === 'monitor') {
			connection.room.monitors.delete(webSocket);
			return;
		}
		if (connection.role === 'results') {
			removeResultSubscriber(webSocket);
			return;
		}
		if (connection.role === 'admin') {
			adminSubscribers.delete(webSocket);
			return;
		}

		if (connection.lane.webSocket !== webSocket) return;
		connection.lane.webSocket = null;
		connection.lane.connected = false;
		connection.lane.ready = false;
		if (connection.room.status === 'countdown' && Date.now() < connection.room.startsAt) {
			connection.room.status = 'waiting';
			connection.room.startsAt = null;
			connection.room.endsAt = null;
			connection.room.startOperatedBy = null;
			connection.lane.ready = false;
			stopTicker(connection.room);
		}
		broadcastSnapshot(connection.room);
		broadcastAdminStatus();
	}

	/** @param {WebSocket} webSocket */
	function sendAdminStatus(webSocket) {
		const now = Date.now();
		if (!cachedAdminStatusMessage || now >= cachedAdminStatusUntil) {
			cachedAdminStatusMessage = createAdminStatusMessage(rooms);
			cachedAdminStatusUntil = now + 1_000;
		}
		send(webSocket, cachedAdminStatusMessage);
	}

	function broadcastAdminStatus() {
		const message = createAdminStatusMessage(rooms);
		cachedAdminStatusMessage = message;
		cachedAdminStatusUntil = Date.now() + 1_000;
		for (const subscriber of adminSubscribers) send(subscriber, message);
	}
}

/** @param {any} room @param {string} operatedBy */
function startRoom(room, operatedBy) {
	if (room.status !== 'waiting') {
		return { started: false, reason: 'invalid_status', status: room.status };
	}
	if (room.lanes.size !== 6) return { started: false, reason: 'assignments_incomplete' };
	const lanes = [...room.lanes.values()];
	const connectedCount = lanes.filter((lane) => lane.connected).length;
	const readyCount = lanes.filter((lane) => lane.ready).length;
	if (connectedCount !== 6 || readyCount !== 6) {
		return { started: false, reason: 'not_ready', connectedCount, readyCount };
	}

	room.status = 'countdown';
	room.startsAt = Date.now() + countdownMilliseconds;
	room.endsAt = room.startsAt + durationSeconds * 1_000;
	room.startOperatedBy = operatedBy;
	room.ticker = setInterval(() => {
		const now = Date.now();
		const previousStatus = room.status;
		if (room.status === 'countdown' && now >= room.startsAt) {
			room.status = 'running';
			persistAttemptStart(room);
		}
		if (room.status === 'running' && now >= room.endsAt) finishRoom(room);
		else broadcastSnapshot(room);
		if (room.status !== previousStatus) room.notifyAdmin();
	}, 250);
	room.ticker.unref();
	broadcastSnapshot(room);
	room.notifyAdmin();
	return { started: true };
}

/** @param {Map<number, any>} rooms */
function createAdminStatusMessage(rooms) {
	return {
		type: 'competition.admin-status',
		data: {
			matches: [1, 2, 3].map((matchNumber) => {
				const room = rooms.get(matchNumber);
				const latestAttempt = room ? undefined : readLatestAttempt(matchNumber);
				const lanes = room ? [...room.lanes.values()] : [];
				return {
					matchNumber,
					attemptNumber: room?.attemptNumber ?? latestAttempt?.attemptNumber ?? 1,
					problemSetId:
						room?.problemSetId ??
						latestAttempt?.problemSetId ??
						mainPresets.get(matchNumber)?.problem_set_id ??
						'',
					status: room?.status ?? restoredRoomStatus(latestAttempt?.status),
					connectedCount: lanes.filter((lane) => lane.connected).length,
					readyCount: lanes.filter((lane) => lane.ready).length
				};
			})
		}
	};
}

/** @param {any} room */
function finishRoom(room) {
	if (room.status === 'finished') return;
	room.status = 'finished';
	stopTicker(room);
	try {
		persistRoomResults(room);
	} catch (error) {
		console.error(`Failed to persist results for match ${room.matchNumber}`, error);
	}
	broadcastSnapshot(room);
	room.notifyAdmin();
	publishResultNotification({
		type: 'competition.finished',
		data: { matchNumber: room.matchNumber }
	});
}

/**
 * @param {any} room
 * @param {'interrupt' | 'force_finish'} action
 * @param {string} operatedBy
 * @param {string} reason
 */
function stopCompetition(room, action, operatedBy, reason) {
	if (room.status !== 'countdown' && room.status !== 'running') {
		return { completed: false, reason: 'invalid_status' };
	}
	const status = action === 'interrupt' ? 'interrupted' : 'force_finished';
	const statusBefore = room.status;
	stopTicker(room);
	room.status = status;
	room.endsAt = Date.now();
	const snapshot = createRoomSnapshot(room);
	const database = openDatabase();
	try {
		recordStoppedAttempt(
			database,
			snapshot,
			room.attemptNumber,
			status,
			statusBefore,
			operatedBy,
			reason
		);
	} finally {
		database.close();
	}
	broadcastSnapshot(room);
	room.notifyAdmin();
	return { completed: true, attemptNumber: room.attemptNumber };
}

/** @param {any} room @param {'invalidated'} status */
function setRoomTerminalStatus(room, status) {
	stopTicker(room);
	room.status = status;
	room.endsAt ??= Date.now();
	broadcastSnapshot(room);
	room.notifyAdmin();
}

/** @param {any} room @param {ProblemPreset} preset @param {number} attemptNumber */
function resetRoom(room, preset, attemptNumber) {
	stopTicker(room);
	const problems = preset.problems.map((problem) => ({
		displayText: problem.display_text,
		reading: problem.reading
	}));
	room.attemptNumber = attemptNumber;
	room.problemSetId = preset.problem_set_id;
	room.problemSetVersion = preset.version;
	room.problems = problems;
	room.status = 'waiting';
	room.startsAt = null;
	room.endsAt = null;
	room.startOperatedBy = null;
	for (const lane of room.lanes.values()) {
		lane.ready = false;
		lane.persistedResult = null;
		lane.inputTokens = inputBurstCapacity;
		lane.inputTokenUpdatedAt = Date.now();
		lane.typingState = createTypingState(problems);
	}
	broadcastSnapshot(room);
	room.notifyAdmin();
}

function openDatabase() {
	const databasePath = process.env.DATABASE_URL ?? 'data/typing-system.db';
	const database = new Database(databasePath);
	database.pragma('busy_timeout = 5000');
	return database;
}

/** @param {any} room */
function persistAttemptStart(room) {
	const database = openDatabase();
	try {
		recordAttemptStarted(
			database,
			{
				matchNumber: room.matchNumber,
				attemptNumber: room.attemptNumber,
				problemSetId: room.problemSetId,
				problemSetVersion: room.problemSetVersion,
				startsAt: room.startsAt
			},
			room.startOperatedBy ?? 'system'
		);
	} catch (error) {
		console.error(`Failed to record start for match ${room.matchNumber}`, error);
	} finally {
		database.close();
	}
}

/** @param {number} matchNumber */
function readLatestAttempt(matchNumber) {
	let database;
	try {
		database = openDatabase();
		return getLatestAttempt(database, matchNumber);
	} catch (error) {
		const code = /** @type {{ code?: string }} */ (error).code;
		if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_ERROR') return undefined;
		throw error;
	} finally {
		database?.close();
	}
}

/** @param {string | undefined} status */
function restoredRoomStatus(status) {
	if (status === 'retry_waiting') return 'waiting';
	if (
		status === 'finished' ||
		status === 'confirmed' ||
		status === 'running' ||
		status === 'interrupted' ||
		status === 'force_finished' ||
		status === 'invalidated'
	) {
		if (status === 'running') return 'interrupted';
		if (status === 'confirmed') return 'finished';
		return status;
	}
	return 'waiting';
}

/** @param {any} room */
function persistRoomResults(room) {
	const databasePath = process.env.DATABASE_URL ?? 'data/typing-system.db';
	const database = new Database(databasePath);
	database.pragma('busy_timeout = 5000');
	try {
		saveMatchResults(
			database,
			createRoomSnapshot(room),
			room.endsAt ?? Date.now(),
			room.attemptNumber
		);
	} finally {
		database.close();
	}
}

/**
 * @param {import('better-sqlite3').Database} database
 * @param {FinishedResultSnapshot} snapshot
 * @param {number} finishedAt
 * @param {number} attemptNumber
 */
export function saveMatchResults(database, snapshot, finishedAt, attemptNumber = 1) {
	const isConfirmed = database.prepare('select 1 from match_confirmations where match_number = ?');
	const removePreviousResults = database.prepare(
		'delete from match_results where match_number = ?'
	);
	const insertResult = database.prepare(`
		insert into match_results (
			match_number, lane_number, team_name, representative_source,
			correct_types, incorrect_types, completed_problems,
			wpm, accuracy, raw_score, score, rank,
			problem_set_id, problem_set_version, finished_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const replaceResults = database.transaction(() => {
		if (isConfirmed.get(snapshot.matchNumber)) {
			throw new Error(`Results for match ${snapshot.matchNumber} are already confirmed`);
		}
		removePreviousResults.run(snapshot.matchNumber);
		for (const lane of snapshot.lanes) {
			if (lane.rank === null) throw new Error('A finished result must have a rank');
			insertResult.run(
				snapshot.matchNumber,
				lane.laneNumber,
				lane.teamName,
				lane.representativeSource,
				lane.correctTypes,
				lane.incorrectTypes,
				lane.completedProblems,
				lane.wpm,
				lane.accuracy,
				lane.rawScore,
				lane.score,
				lane.rank,
				snapshot.problemSetId,
				snapshot.problemSetVersion,
				finishedAt
			);
		}
		database
			.prepare(
				`insert into match_attempts (
				 match_number, attempt_number, problem_set_id, problem_set_version, status,
				 started_at, ended_at, created_at, updated_at
				) values (?, ?, ?, ?, 'finished', ?, ?, ?, ?)
				on conflict(match_number, attempt_number) do update set
				 status = 'finished', ended_at = excluded.ended_at, updated_at = excluded.updated_at`
			)
			.run(
				snapshot.matchNumber,
				attemptNumber,
				snapshot.problemSetId,
				snapshot.problemSetVersion,
				snapshot.startsAt ?? null,
				finishedAt,
				finishedAt,
				finishedAt
			);
		saveAttemptResults(database, snapshot, attemptNumber, finishedAt);
	});

	replaceResults();
}

/** @param {any} room */
function stopTicker(room) {
	if (!room.ticker) return;
	clearInterval(room.ticker);
	room.ticker = null;
}

/** @param {number} matchNumber @returns {Assignment[]} */
function loadAssignments(matchNumber) {
	const databasePath = process.env.DATABASE_URL ?? 'data/typing-system.db';
	let database;
	try {
		database = new Database(databasePath, { readonly: true, fileMustExist: true });
		return /** @type {Assignment[]} */ (
			database
				.prepare(
					`select team_name as teamName,
				        representative_source as representativeSource,
				        lane_number as laneNumber
				 from match_assignments
				 where match_number = ?
				 order by lane_number`
				)
				.all(matchNumber)
		);
	} catch (error) {
		const code = /** @type {{ code?: string }} */ (error).code;
		if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_ERROR') return [];
		throw error;
	} finally {
		database?.close();
	}
}

/** @param {number} matchNumber @returns {PersistedMatchResult[]} */
function loadMatchResults(matchNumber) {
	const databasePath = process.env.DATABASE_URL ?? 'data/typing-system.db';
	let database;
	try {
		database = new Database(databasePath, { readonly: true, fileMustExist: true });
		return /** @type {PersistedMatchResult[]} */ (
			database
				.prepare(
					`select lane_number as laneNumber, correct_types as correctTypes,
				        incorrect_types as incorrectTypes, completed_problems as completedProblems,
				        wpm, accuracy, raw_score as rawScore, score, rank
				 from match_results where match_number = ? order by lane_number`
				)
				.all(matchNumber)
		);
	} catch (error) {
		const code = /** @type {{ code?: string }} */ (error).code;
		if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_ERROR') return [];
		throw error;
	} finally {
		database?.close();
	}
}

/** @param {any} room */
function broadcastSnapshot(room) {
	const message = { type: 'competition.snapshot', data: createRoomSnapshot(room) };
	for (const monitor of room.monitors) send(monitor, message);
	for (const lane of room.lanes.values()) {
		if (lane.webSocket) send(lane.webSocket, message);
	}
}

/** @param {any} room @param {WebSocket} webSocket */
function sendSnapshot(room, webSocket) {
	send(webSocket, { type: 'competition.snapshot', data: createRoomSnapshot(room) });
}

/** @param {any} room */
function createRoomSnapshot(room) {
	const now = Date.now();
	const lanes = [...room.lanes.values()].map((lane) => createLaneSnapshot(room, lane, now));
	const ranks = createIndividualRanks(lanes);

	return {
		matchNumber: room.matchNumber,
		attemptNumber: room.attemptNumber,
		problemSetId: room.problemSetId,
		problemSetVersion: room.problemSetVersion,
		durationSeconds,
		status: room.status,
		serverTime: now,
		startsAt: room.startsAt,
		endsAt: room.endsAt,
		connectedCount: lanes.filter((lane) => lane.connected).length,
		readyCount: lanes.filter((lane) => lane.ready).length,
		lanes: lanes.map((lane) => ({
			...lane,
			rank: publishedRank(
				room.status,
				room.lanes.get(lane.laneNumber)?.persistedResult?.rank ?? ranks.get(lane.laneNumber)
			)
		}))
	};
}

/** @param {string} status @param {number | undefined} rank */
export function publishedRank(status, rank) {
	return status === 'finished' ? (rank ?? null) : null;
}

/** @param {{ laneNumber: number, score: number, correctTypes: number, incorrectTypes: number }[]} lanes */
export function createIndividualRanks(lanes) {
	return new Map(
		lanes.map((lane) => [
			lane.laneNumber,
			1 + lanes.filter((candidate) => compareIndividualResults(candidate, lane) < 0).length
		])
	);
}

/**
 * Returns a negative value when left ranks ahead of right.
 *
 * @param {{ score: number, correctTypes: number, incorrectTypes: number }} left
 * @param {{ score: number, correctTypes: number, incorrectTypes: number }} right
 */
export function compareIndividualResults(left, right) {
	if (left.score !== right.score) return right.score - left.score;

	const leftAttempts = left.correctTypes + left.incorrectTypes;
	const rightAttempts = right.correctTypes + right.incorrectTypes;
	const rawScoreComparison = compareFractions(
		BigInt(left.correctTypes) ** 4n,
		BigInt(Math.max(1, leftAttempts)) ** 3n,
		BigInt(right.correctTypes) ** 4n,
		BigInt(Math.max(1, rightAttempts)) ** 3n
	);
	if (rawScoreComparison !== 0) return -rawScoreComparison;

	const accuracyComparison = compareFractions(
		BigInt(left.correctTypes),
		BigInt(Math.max(1, leftAttempts)),
		BigInt(right.correctTypes),
		BigInt(Math.max(1, rightAttempts))
	);
	if (accuracyComparison !== 0) return -accuracyComparison;

	if (left.correctTypes !== right.correctTypes) return right.correctTypes - left.correctTypes;
	return left.incorrectTypes - right.incorrectTypes;
}

/** @param {bigint} leftNumerator @param {bigint} leftDenominator @param {bigint} rightNumerator @param {bigint} rightDenominator */
function compareFractions(leftNumerator, leftDenominator, rightNumerator, rightDenominator) {
	const left = leftNumerator * rightDenominator;
	const right = rightNumerator * leftDenominator;
	return left > right ? 1 : left < right ? -1 : 0;
}

/** @param {any} room @param {any} lane @param {number} now */
function createLaneSnapshot(room, lane, now) {
	const view = getTypingView(lane.typingState);
	if (room.status === 'finished' && lane.persistedResult) {
		return {
			laneNumber: lane.laneNumber,
			teamName: lane.teamName,
			representativeSource: lane.representativeSource,
			connected: lane.connected,
			ready: lane.ready,
			status: 'finished',
			...view,
			correctTypes: lane.persistedResult.correctTypes,
			incorrectTypes: lane.persistedResult.incorrectTypes,
			completedProblems: lane.persistedResult.completedProblems,
			accuracy: lane.persistedResult.accuracy,
			wpm: lane.persistedResult.wpm,
			rawScore: lane.persistedResult.rawScore,
			score: lane.persistedResult.score,
			progress: 0
		};
	}
	const elapsedSeconds =
		room.startsAt === null
			? 0
			: Math.max(0, Math.min(durationSeconds, (now - room.startsAt) / 1_000));
	const attempts = view.correctTypes + view.incorrectTypes;
	const accuracy = attempts === 0 ? 0 : view.correctTypes / attempts;
	const wpm = elapsedSeconds === 0 ? 0 : (view.correctTypes / elapsedSeconds) * 60;
	const rawScore = calculateRawScore(view.correctTypes, view.incorrectTypes);
	const score = Math.floor(rawScore);
	const currentLength = Math.max(view.romanizedText.length, 1);
	const progress =
		((view.problemIndex + Math.min(1, view.inputPosition / currentLength)) / view.problemCount) *
		100;

	return {
		laneNumber: lane.laneNumber,
		teamName: lane.teamName,
		representativeSource: lane.representativeSource,
		connected: lane.connected,
		ready: lane.ready,
		status: laneStatus(room, lane),
		...view,
		accuracy,
		wpm,
		rawScore,
		score,
		progress
	};
}

/** @param {number} correctTypes @param {number} incorrectTypes */
function calculateRawScore(correctTypes, incorrectTypes) {
	const attempts = correctTypes + incorrectTypes;
	if (attempts === 0) return 0;
	return (60 * correctTypes ** 4) / (durationSeconds * attempts ** 3);
}

/** @param {any} lane @param {number} now */
function consumeInputAllowance(lane, now) {
	const elapsedSeconds = Math.max(0, now - lane.inputTokenUpdatedAt) / 1_000;
	lane.inputTokens = Math.min(
		inputBurstCapacity,
		lane.inputTokens + elapsedSeconds * inputRatePerSecond
	);
	lane.inputTokenUpdatedAt = now;
	if (lane.inputTokens < 1) return false;
	lane.inputTokens -= 1;
	return true;
}

/** @param {any} room @param {any} lane */
function laneStatus(room, lane) {
	if (!lane.connected) return 'disconnected';
	if (room.status === 'waiting') return lane.ready ? 'ready' : 'connected';
	return room.status;
}

/** @param {WebSocket} webSocket @param {unknown} message */
function send(webSocket, message) {
	if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(message));
}
