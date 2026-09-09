import { expect, test } from '@playwright/test';

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const serverPort = Number(process.env.PORT ?? 3000);

if (!adminUsername || !adminPassword) {
	throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set');
}

const adminAuthorization = `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64')}`;
const defaultAssignmentForm = {
	source_1_0: '1-1',
	source_1_1: 'IS2',
	source_1_2: 'IS3',
	source_1_3: 'IS4',
	source_1_4: 'IS5',
	source_1_5: '専教',
	source_2_0: '1-2',
	source_2_1: 'IT2',
	source_2_2: 'IT3',
	source_2_3: 'IT4',
	source_2_4: 'IT5',
	source_2_5: '専教',
	source_3_0: '1-3',
	source_3_1: 'IE2',
	source_3_2: 'IE3',
	source_3_3: 'IE4',
	source_3_4: 'IE5',
	source_3_5: '専教'
};

test('disables the connect button after the terminal connects', async ({ page, request }) => {
	const response = await request.post('/admin?/saveAssignments', {
		headers: {
			authorization: adminAuthorization,
			accept: 'application/json',
			origin: `http://127.0.0.1:${serverPort}`,
			'x-sveltekit-action': 'true'
		},
		form: defaultAssignmentForm
	});
	expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);

	await page.goto('/competition');
	const connectButton = page.getByRole('button', { name: '端末を接続' });
	await expect(connectButton).toBeEnabled();

	await connectButton.click();
	await expect(page.getByText('接続済み', { exact: true })).toBeVisible();
	await expect(connectButton).toBeDisabled();
});
