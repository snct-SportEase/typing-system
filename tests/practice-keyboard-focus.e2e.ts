import { expect, test } from '@playwright/test';

test('continues accepting input after the typing surface loses focus', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-09-09T00:00:00Z') });
	await page.goto('/practice');
	await page.getByRole('button', { name: '練習を開始' }).click();
	await page.clock.fastForward(3_000);

	const input = page.getByLabel('練習入力');
	await expect(input).toBeFocused();

	const firstTwoKeys = (await page.locator('.romanized-input').textContent())?.slice(0, 2);
	expect(firstTwoKeys).toHaveLength(2);
	await input.press(firstTwoKeys![0]);
	await expect(page.locator('.romanized-input span')).toHaveText(firstTwoKeys![0]);

	await page.locator('.problem-text').click();
	await expect(input).not.toBeFocused();
	await page.keyboard.press(firstTwoKeys![1]);

	await expect(page.locator('.romanized-input span')).toHaveText(firstTwoKeys!);
});
