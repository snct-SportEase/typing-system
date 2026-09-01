const controllerKey = Symbol.for('typing-system.competition-controller');

/** @param {{ start: (matchNumber: number, operatedBy: string) => CompetitionStartResult, operate: (operation: CompetitionOperation) => CompetitionOperationResult, lockedAssignmentMatchNumbers?: () => number[] }} controller */
export function registerCompetitionController(controller) {
	Reflect.set(globalThis, controllerKey, controller);
}

/** @param {number} matchNumber @param {string} operatedBy @returns {CompetitionStartResult} */
export function requestCompetitionStart(matchNumber, operatedBy) {
	const controller = Reflect.get(globalThis, controllerKey);
	if (!controller || typeof controller.start !== 'function') {
		return { started: false, reason: 'controller_unavailable' };
	}
	return controller.start(matchNumber, operatedBy);
}

/** @param {CompetitionOperation} operation @returns {CompetitionOperationResult} */
export function requestCompetitionOperation(operation) {
	const controller = Reflect.get(globalThis, controllerKey);
	if (!controller || typeof controller.operate !== 'function') {
		return { completed: false, reason: 'controller_unavailable' };
	}
	return controller.operate(operation);
}

export function requestLockedAssignmentMatchNumbers() {
	const controller = Reflect.get(globalThis, controllerKey);
	if (!controller || typeof controller.lockedAssignmentMatchNumbers !== 'function') return [];
	return controller.lockedAssignmentMatchNumbers();
}

/**
 * @typedef {
 *   | { started: true }
 *   | { started: false, reason: 'controller_unavailable' | 'room_not_initialized' | 'assignments_incomplete' | 'not_ready' | 'invalid_status', status?: string, connectedCount?: number, readyCount?: number }
 * } CompetitionStartResult
 */

/**
 * @typedef {{
 *   action: 'interrupt' | 'force_finish' | 'invalidate' | 'retry' | 'disqualify',
 *   matchNumber: number,
 *   laneNumber?: number,
 *   reason: string,
 *   operatedBy: string
 * }} CompetitionOperation
 */

/**
 * @typedef {
 *   | { completed: true, attemptNumber?: number, problemSetId?: string }
 *   | { completed: false, reason: string }
 * } CompetitionOperationResult
 */
