import { expect, test } from '@playwright/test';

test('shows zero input speed and accuracy before practice starts', async ({ page }) => {
	await page.goto('/practice');

	const metrics = page.locator('.typing-metrics');
	await expect(metrics.locator('div').filter({ hasText: '入力速度' }).locator('dd')).toHaveText('0');
	await expect(metrics.locator('div').filter({ hasText: '正確率' }).locator('dd')).toHaveText('0.0%');
});
