import { checkDatabase } from '$lib/server/db';
import { json } from '@sveltejs/kit';

export const GET = () => {
	const databaseConnected = checkDatabase();

	return json(
		{
			status: databaseConnected ? 'ok' : 'degraded',
			database: databaseConnected ? 'connected' : 'disconnected',
			timestamp: new Date().toISOString()
		},
		{ status: databaseConnected ? 200 : 503 }
	);
};
