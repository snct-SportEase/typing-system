import { expect, test } from '@playwright/test';

test('shows the KeySprint product name', async ({ page, request }) => {
	await page.goto('/');

	await expect(page.locator('.product-name').first()).toHaveText('KeySprint');
	await expect(page).toHaveTitle(/\| KeySprint$/);

	const admin = await request.get('/admin');
	expect(admin.status()).toBe(401);
	expect(admin.headers()['www-authenticate']).toContain('KeySprint Admin');
});
