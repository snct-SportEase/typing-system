import { expect, test } from '@playwright/test';

test('shows the KeySprint brand assets', async ({ page, request }) => {
	await page.goto('/');

	const logo = page.locator('.brand-logo').first();
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute('src', '/KeySprint-logo_real.png');
	await expect(page).toHaveTitle(/\| KeySprint$/);

	const favicon = page.locator('link[rel="icon"]');
	await expect(favicon).toHaveAttribute('href', '/KeySprint-logo-icon_real.png');

	const admin = await request.get('/admin');
	expect(admin.status()).toBe(401);
	expect(admin.headers()['www-authenticate']).toContain('KeySprint Admin');
});
