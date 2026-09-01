import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const databaseUrl = env.DATABASE_URL ?? 'data/typing-system.db';
mkdirSync(dirname(databaseUrl), { recursive: true });
const client = new Database(databaseUrl);

client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');
client.pragma('busy_timeout = 5000');

export const db = drizzle(client, { schema });

export function checkDatabase(): boolean {
	return client.prepare('select 1').pluck().get() === 1;
}
