import { WebSocket } from 'ws';

const registryKey = Symbol.for('typing-system.result-subscribers');
const existingSubscribers = Reflect.get(globalThis, registryKey);
/** @type {Set<WebSocket>} */
const subscribers = existingSubscribers instanceof Set ? existingSubscribers : new Set();
Reflect.set(globalThis, registryKey, subscribers);

/** @param {WebSocket} webSocket */
export function addResultSubscriber(webSocket) {
	subscribers.add(webSocket);
}

/** @param {WebSocket} webSocket */
export function removeResultSubscriber(webSocket) {
	subscribers.delete(webSocket);
}

/** @param {{ type: 'competition.finished' | 'competition.confirmed' | 'competition.invalidated' | 'competition.disqualified' | 'competition.retry-prepared', data: { matchNumber: number } }} message */
export function publishResultNotification(message) {
	const payload = JSON.stringify(message);
	for (const subscriber of subscribers) {
		if (subscriber.readyState === WebSocket.OPEN) subscriber.send(payload);
	}
}
