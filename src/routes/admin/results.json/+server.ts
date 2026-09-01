import { env } from '$env/dynamic/private';
import { createOrReuseResultExport } from '$lib/server/tournament/result-export';
import Database from 'better-sqlite3';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	if (!env.ADMIN_USERNAME) throw new Error('ADMIN_USERNAME is not set');
	const database = new Database(env.DATABASE_URL ?? 'data/typing-system.db');
	database.pragma('busy_timeout = 5000');
	try {
		const result = createOrReuseResultExport(database, env.ADMIN_USERNAME);
		if (!result.exported) {
			error(409, '第1〜第3試合の結果確定後に出力できます。');
		}
		return new Response(result.payload, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': 'attachment; filename="typing-results.json"',
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff',
				'x-export-id': result.exportId,
				'x-content-sha256': result.contentSha256
			}
		});
	} finally {
		database.close();
	}
};
