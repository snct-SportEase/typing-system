import { createServer } from 'node:http';
import { validateProductionConfiguration } from './configuration.js';
import { attachRealtimeServer } from './realtime.js';

try {
	process.loadEnvFile?.();
} catch (error) {
	if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') throw error;
}
validateProductionConfiguration(process.env);

process.env.PROTOCOL_HEADER ??= 'x-forwarded-proto';
const handlerModulePath = '../build/handler.js';
/** @type {import('node:http').RequestListener} */
const handler = (await import(handlerModulePath)).handler;
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const server = createServer((request, response) => {
	request.headers['x-forwarded-proto'] ??= 'http';
	handler(request, response);
});
const webSocketServer = attachRealtimeServer(server);

server.listen(port, host, () => {
	console.log(`Typing System listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		webSocketServer.close();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(1), 30_000).unref();
	});
}
