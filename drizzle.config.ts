import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'data/typing-system.db';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'sqlite',
	out: './drizzle',
	dbCredentials: { url: databaseUrl },
	verbose: true,
	strict: true
});
