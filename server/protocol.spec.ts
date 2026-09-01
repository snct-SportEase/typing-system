import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './protocol.js';

describe('realtime protocol', () => {
	it('accepts supported messages', () => {
		expect(parseClientMessage({ type: 'system.ping' }).success).toBe(true);
		expect(parseClientMessage({ type: 'results.subscribe' }).success).toBe(true);
		expect(parseClientMessage({ type: 'admin.subscribe' }).success).toBe(true);
		expect(
			parseClientMessage({ type: 'monitor.subscribe', data: { matchNumber: 2 } }).success
		).toBe(true);
		expect(
			parseClientMessage({ type: 'typing.join', data: { matchNumber: 1, laneNumber: 6 } }).success
		).toBe(true);
		expect(parseClientMessage({ type: 'typing.ready' }).success).toBe(true);
		expect(
			parseClientMessage({
				type: 'typing.input',
				data: { key: 'k', shift: false, repeat: false }
			}).success
		).toBe(true);
	});

	it.each([
		null,
		{},
		{ type: 'system.ping', extra: true },
		{ type: 'monitor.subscribe', data: { matchNumber: 4 } },
		{ type: 'typing.join', data: { matchNumber: 1, laneNumber: 0 } },
		{ type: 'typing.input' },
		{ type: 'typing.input', data: { key: 'a', injected: true } }
	])('rejects an unsupported payload: %j', (payload) => {
		expect(parseClientMessage(payload).success).toBe(false);
	});
});
