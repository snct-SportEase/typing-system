import { expect, test } from '@playwright/test';

test('freezes the timer and input speed after stopping practice', async ({ page }) => {
	await page.clock.install({ time: new Date('2026-09-09T00:00:00Z') });
	await page.goto('/practice');
	await page.getByRole('button', { name: '練習を開始' }).click();
	await page.clock.fastForward(3_000);

	const input = page.getByLabel('練習入力');
	const firstFourKeys = (await page.locator('.romanized-input').textContent())?.slice(0, 4);
	expect(firstFourKeys).toHaveLength(4);
	await input.pressSequentially(firstFourKeys!);
	await page.clock.fastForward(1_500);

	await page.getByRole('button', { name: '練習を停止' }).click();
	await expect(page.getByText('練習終了', { exact: true })).toBeVisible();

	const timer = page.locator('.practice-terminal header time');
	const inputSpeed = page
		.locator('.typing-metrics div')
		.filter({ hasText: '入力速度' })
		.locator('dd');
	const stoppedTime = await timer.textContent();
	const stoppedInputSpeed = await inputSpeed.textContent();

	await page.clock.fastForward(10_000);

	await expect(timer).toHaveText(stoppedTime!);
	await expect(inputSpeed).toHaveText(stoppedInputSpeed!);
});
