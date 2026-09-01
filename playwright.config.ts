import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
process.env.DATABASE_URL ??= 'data/e2e.db';

export default defineConfig({
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
	use: { baseURL: `http://127.0.0.1:${port}` },
	webServer: {
		command: 'npm run build && npm run start',
		port,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}'
});
