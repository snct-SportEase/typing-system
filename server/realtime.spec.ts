import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { attachRealtimeServer } from './realtime.js';

describe('realtime server upgrades', () => {
	it('destroys upgrade sockets for paths other than /ws', () => {
		const server = createServer();
		attachRealtimeServer(server);
		const destroy = vi.fn();

		server.emit(
			'upgrade',
			{ url: '/not-websocket' } as IncomingMessage,
			{ destroy } as unknown as Socket,
			Buffer.alloc(0)
		);

		expect(destroy).toHaveBeenCalledOnce();
	});

	it('destroys malformed upgrade URLs without throwing', () => {
		const server = createServer();
		attachRealtimeServer(server);
		const destroy = vi.fn();

		expect(() =>
			server.emit(
				'upgrade',
				{ url: '//[' } as IncomingMessage,
				{ destroy } as unknown as Socket,
				Buffer.alloc(0)
			)
		).not.toThrow();
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('handles malformed-frame errors without crashing', () => {
		const server = createServer();
		const webSocketServer = attachRealtimeServer(server);
		const webSocket = new EventEmitter() as EventEmitter & {
			readyState: number;
			send: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		};
		webSocket.readyState = WebSocket.OPEN;
		webSocket.send = vi.fn();
		webSocket.close = vi.fn();

		webSocketServer.emit(
			'connection',
			webSocket as unknown as WebSocket,
			{ headers: {} } as IncomingMessage
		);

		expect(() => webSocket.emit('error', new Error('invalid frame'))).not.toThrow();
	});

	it('requires the existing admin Basic credentials for admin subscriptions', () => {
		const previousUsername = process.env.ADMIN_USERNAME;
		const previousPassword = process.env.ADMIN_PASSWORD;
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.ADMIN_USERNAME = 'admin';
		process.env.ADMIN_PASSWORD = 'secret';
		process.env.DATABASE_URL = ':memory:';
		const server = createServer();
		const webSocketServer = attachRealtimeServer(server);
		const createSocket = () => {
			const socket = new EventEmitter() as EventEmitter & {
				readyState: number;
				send: ReturnType<typeof vi.fn>;
				close: ReturnType<typeof vi.fn>;
			};
			socket.readyState = WebSocket.OPEN;
			socket.send = vi.fn();
			socket.close = vi.fn();
			return socket;
		};

		try {
			const unauthorized = createSocket();
			webSocketServer.emit(
				'connection',
				unauthorized as unknown as WebSocket,
				{ headers: {} } as IncomingMessage
			);
			unauthorized.emit('message', Buffer.from('{"type":"admin.subscribe"}'), false);
			expect(unauthorized.close).toHaveBeenCalledWith(1008, 'admin_auth_required');

			const authorized = createSocket();
			webSocketServer.emit(
				'connection',
				authorized as unknown as WebSocket,
				{
					headers: { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` }
				} as IncomingMessage
			);
			authorized.emit('message', Buffer.from('{"type":"admin.subscribe"}'), false);
			expect(authorized.close).not.toHaveBeenCalled();
			expect(authorized.send).toHaveBeenCalledWith(expect.stringContaining('admin-status'));
		} finally {
			if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
			else process.env.ADMIN_USERNAME = previousUsername;
			if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
			else process.env.ADMIN_PASSWORD = previousPassword;
			if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabaseUrl;
		}
	});
});
