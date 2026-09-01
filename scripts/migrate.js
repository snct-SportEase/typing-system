import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

try {
	process.loadEnvFile?.();
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}

const databaseUrl = process.env.DATABASE_URL ?? 'data/typing-system.db';
mkdirSync(dirname(databaseUrl), { recursive: true });

const client = new Database(databaseUrl);
client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');
client.pragma('busy_timeout = 5000');

try {
	migrate(drizzle(client), { migrationsFolder: 'drizzle' });
} finally {
	client.close();
}
