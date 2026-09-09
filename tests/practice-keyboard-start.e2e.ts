import { expect, test } from '@playwright/test';

for (const key of ['Space', 'Enter']) {
	test(`starts practice with ${key}`, async ({ page }) => {
		await page.clock.install({ time: new Date('2026-09-09T00:00:00Z') });
		await page.goto('/practice');

		await page.keyboard.press(key);

		await expect(page.locator('.practice-status')).toHaveText('3');
		await page.clock.fastForward(3_000);
		await expect(page.locator('.practice-status')).toHaveText('練習中');
	});
}
