import { expect, test } from '@playwright/test';

test('counts down for three seconds before practice accepts input', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-09-09T00:00:00Z') });
	await page.goto('/practice');
	await page.getByRole('button', { name: '練習を開始' }).click();

	const status = page.locator('.practice-status');
	const timer = page.locator('.practice-terminal header time');
	const input = page.getByLabel('練習入力');
	const correctTypes = page.locator('.typing-metrics div').filter({ hasText: '正タイプ' });
	const firstKey = (await page.locator('.romanized-input').textContent())?.[0];
	expect(firstKey).toBeTruthy();

	await expect(status).toHaveText('3');
	await expect(timer).toHaveText('3:00');
	await input.press(firstKey!);
	await expect(correctTypes).toContainText('0');

	await page.clock.fastForward(1_000);
	await expect(status).toHaveText('2');
	await page.clock.fastForward(1_000);
	await expect(status).toHaveText('1');
	await page.clock.fastForward(1_000);
	await expect(status).toHaveText('練習中');
	await expect(timer).toHaveText('3:00');

	await input.press(firstKey!);
	await expect(correctTypes).toContainText('1');
});
