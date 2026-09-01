import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { WebSocket as ClientWebSocket } from 'ws';

test.describe.configure({ mode: 'serial' });

if (!process.env.TOURNAMENT_NAME || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
	try {
		process.loadEnvFile?.();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}
const tournamentName = process.env.TOURNAMENT_NAME;
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL ?? 'data/e2e.db';
const serverPort = Number(process.env.PORT ?? 3000);
const webSocketUrl = `ws://127.0.0.1:${serverPort}/ws`;
if (!tournamentName || !adminUsername || !adminPassword) {
	throw new Error('TOURNAMENT_NAME, ADMIN_USERNAME, and ADMIN_PASSWORD must be set');
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

test.beforeAll(async ({ request }) => {
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
});

function subscribeToAdminStatus(authorization?: string) {
	const webSocket = new ClientWebSocket(webSocketUrl, {
		headers: authorization ? { authorization } : undefined
	});
	const closed = new Promise<{ code: number; reason: string }>((resolve) =>
		webSocket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
	);
	const result = new Promise<{ type: string; code?: string }>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('WebSocket subscription timed out')), 3_000);
		webSocket.once('error', reject);
		webSocket.on('message', (payload) => {
			const message = JSON.parse(payload.toString()) as { type: string; data?: { code?: string } };
			if (message.type !== 'competition.admin-status' && message.type !== 'system.error') return;
			clearTimeout(timeout);
			resolve({ type: message.type, code: message.data?.code });
		});
		webSocket.once('open', () => webSocket.send(JSON.stringify({ type: 'admin.subscribe' })));
	});
	return { webSocket, result, closed };
}

async function closeWebSockets(webSockets: ClientWebSocket[]) {
	await Promise.all(
		webSockets.map(
			(webSocket) =>
				new Promise<void>((resolve) => {
					if (webSocket.readyState === ClientWebSocket.CLOSED) return resolve();
					webSocket.once('close', () => resolve());
					webSocket.close();
					setTimeout(() => {
						webSocket.terminate();
						resolve();
					}, 1_000).unref();
				})
		)
	);
}

function clearCompetitionResults() {
	const database = new Database(databaseUrl);
	database.pragma('busy_timeout = 5000');
	database.transaction(() => {
		database.prepare('delete from result_exports').run();
		database.prepare('delete from match_confirmations').run();
		database.prepare('delete from match_disqualifications').run();
		database.prepare('delete from match_operations').run();
		database.prepare('delete from match_attempt_results').run();
		database.prepare('delete from match_attempts').run();
		database.prepare('delete from match_results').run();
	})();
	database.close();
}

test('loads the configured tournament and reports database connectivity', async ({
	page,
	request
}) => {
	await page.goto('/');

	await expect(page.locator('h1')).toHaveText(tournamentName);
	await expect(page.getByRole('heading', { name: '出場枠' })).toBeVisible();
	await expect(page.getByText('1-1', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('専教', { exact: true }).first()).toBeVisible();

	const response = await request.get('/api/health');
	expect(response.ok()).toBe(true);
	await expect(response.json()).resolves.toMatchObject({ status: 'ok', database: 'connected' });
});

test('rejects unauthenticated admin WebSocket subscriptions', async () => {
	const { webSocket, result, closed } = subscribeToAdminStatus();
	try {
		await expect(result).resolves.toEqual({
			type: 'system.error',
			code: 'admin_auth_required'
		});
		await expect(closed).resolves.toEqual({ code: 1008, reason: 'admin_auth_required' });
	} finally {
		if (webSocket.readyState !== ClientWebSocket.CLOSED) webSocket.terminate();
	}
});

test('caps authenticated admin WebSocket subscriptions', async () => {
	const subscriptions = Array.from({ length: 9 }, () => subscribeToAdminStatus(adminAuthorization));
	try {
		const results = await Promise.all(subscriptions.map((subscription) => subscription.result));
		expect(results.filter((result) => result.type === 'competition.admin-status')).toHaveLength(8);
		expect(results.filter((result) => result.code === 'admin_subscriber_limit')).toHaveLength(1);
	} finally {
		await closeWebSockets(subscriptions.map((subscription) => subscription.webSocket));
	}
});

test('survives a malformed WebSocket text frame', async ({ request }) => {
	const socket = net.createConnection({ host: '127.0.0.1', port: serverPort });
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('error', reject);
	});
	const key = randomBytes(16).toString('base64');
	socket.write(
		`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${serverPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
	);
	await new Promise<void>((resolve, reject) => {
		let response = '';
		const timeout = setTimeout(() => reject(new Error('WebSocket upgrade timed out')), 3_000);
		socket.on('data', (chunk) => {
			response += chunk.toString('latin1');
			if (!response.includes('\r\n\r\n')) return;
			clearTimeout(timeout);
			resolve();
		});
	});

	// Masked text frame containing invalid UTF-8 (C3 28).
	socket.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0xc3, 0x28]));
	await new Promise((resolve) => setTimeout(resolve, 250));
	socket.destroy();

	const health = await request.get('/api/health');
	expect(health.ok()).toBe(true);
});

test('requires a replacement terminal to become ready again', async ({ browser, page: first }) => {
	clearCompetitionResults();
	const replacementContext = await browser.newContext();
	try {
		await first.goto('/competition');
		await first.getByLabel('出場クラス').selectOption('1-1');
		await first.getByRole('button', { name: '端末を接続' }).click();
		await first.getByRole('button', { name: '準備完了' }).click();
		await expect(first.getByText('全員の準備を待っています')).toBeVisible();

		const replacement = await replacementContext.newPage();
		await replacement.goto('/competition');
		await replacement.getByLabel('出場クラス').selectOption('1-1');
		await replacement.getByRole('button', { name: '端末を接続' }).click();
		await expect(replacement.getByText('接続済み', { exact: true })).toBeVisible();
		await expect(replacement.getByRole('button', { name: '準備完了' })).toBeVisible();
		await expect(first.getByText('この出場クラスは別の端末で接続されました。')).toBeVisible();
	} finally {
		await replacementContext.close();
	}
});

test('protects the admin screen and saves valid assignments', async ({ browser, request }) => {
	const unauthorized = await request.get('/admin');
	expect(unauthorized.status()).toBe(401);
	expect(unauthorized.headers()['www-authenticate']).toContain('Basic');

	const context = await browser.newContext({
		httpCredentials: { username: adminUsername, password: adminPassword }
	});
	const page = await context.newPage();
	await page.goto('/admin');

	await expect(page.getByRole('heading', { name: '大会管理' })).toBeVisible();
	await expect(
		page.locator('.match-editor').first().getByRole('heading', { name: '第1試合' })
	).toBeVisible();
	await expect(page.locator('select[name="source_1_1"]')).toHaveValue('IS2');
	await page.getByRole('button', { name: '保存' }).first().click();
	await expect(page.getByRole('status')).toHaveText('保存しました。');

	await page.goto('/');
	await expect(page.getByRole('heading', { name: '試合・レーン情報' })).toBeVisible();
	const firstMatch = page.getByRole('region', { name: '第1試合' });
	await expect(firstMatch.getByText('1', { exact: true })).toBeVisible();
	await expect(firstMatch.getByText('1年生', { exact: true })).toBeVisible();
	await expect(firstMatch.getByText('1-1', { exact: true })).toBeVisible();

	await context.close();
});

test('confirms finished matches manually before publishing overall standings', async ({
	browser,
	page
}) => {
	const database = new Database(databaseUrl);
	const insertResult = database.prepare(`
		insert into match_results (
			match_number, lane_number, team_name, representative_source,
			correct_types, incorrect_types, completed_problems,
			wpm, accuracy, raw_score, score, rank,
			problem_set_id, problem_set_version, finished_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	const teams = [
		{ name: '1年生', source: '1-1' },
		{ name: '2年生', source: 'IS2' },
		{ name: '3年生', source: 'IS3' },
		{ name: '4年生', source: 'IS4' },
		{ name: '5年生', source: 'IS5' },
		{ name: '専攻科・教員', source: '専教' }
	];
	database.transaction(() => {
		database.prepare('delete from result_exports').run();
		database.prepare('delete from match_confirmations').run();
		database.prepare('delete from match_disqualifications').run();
		database.prepare('delete from match_operations').run();
		database.prepare('delete from match_attempt_results').run();
		database.prepare('delete from match_attempts').run();
		database.prepare('delete from match_results').run();
		for (const matchNumber of [1, 2, 3]) {
			for (const [teamIndex, team] of teams.entries()) {
				const laneNumber = teamIndex + 1;
				const score = 150 - laneNumber * 10 + matchNumber;
				insertResult.run(
					matchNumber,
					laneNumber,
					team.name,
					team.source,
					420 - laneNumber * 10,
					5 + laneNumber,
					12,
					140 - laneNumber * 5,
					0.98 - laneNumber * 0.002,
					score + 0.5,
					score,
					laneNumber,
					`match-${matchNumber}-main-v1`,
					1,
					Date.now()
				);
			}
		}
	})();
	database.close();

	const adminContext = await browser.newContext({
		httpCredentials: { username: adminUsername, password: adminPassword }
	});
	const admin = await adminContext.newPage();
	try {
		await page.goto('/');
		await expect(page.getByText('未確定', { exact: true })).toHaveCount(3);
		await expect(page.getByRole('heading', { name: '総合順位' })).toHaveCount(0);

		await admin.goto('/admin');
		admin.on('dialog', (dialog) => dialog.accept());
		expect((await admin.request.get('/admin/results.json')).status()).toBe(409);
		const firstMatch = admin.locator('.confirmation-match').first();
		await firstMatch.getByLabel('第1試合の失格対象').selectOption('1');
		await firstMatch.getByPlaceholder('失格の理由').fill('競技規定違反');
		await firstMatch.getByRole('button', { name: '失格', exact: true }).click();
		await expect(admin.getByRole('status')).toContainText('失格を実行しました');
		await expect(
			admin
				.locator('.confirmation-match')
				.first()
				.locator('.confirmation-row')
				.filter({ hasText: '1年生' })
				.locator('strong')
				.first()
		).toHaveText('失格');
		for (const matchNumber of [1, 2, 3]) {
			const match = admin.locator('.confirmation-match').nth(matchNumber - 1);
			await expect(match.getByText('未確定', { exact: true })).toBeVisible();
			await match.getByRole('button', { name: '結果を確定' }).click();
			await expect(admin.getByRole('status')).toHaveText(
				`第${matchNumber}試合の結果を確定しました。`
			);
		}
		await expect(admin.getByRole('heading', { name: '確定結果JSON' })).toBeVisible();
		await expect(admin.getByRole('link', { name: 'JSONを出力' })).toBeVisible();
		const firstExportResponse = await admin.request.get('/admin/results.json');
		expect(firstExportResponse.status()).toBe(200);
		expect(firstExportResponse.headers()['content-disposition']).toContain(
			'filename="typing-results.json"'
		);
		const firstExport = await firstExportResponse.json();
		expect(Object.keys(firstExport)).toEqual(['schema_version', 'export_id', 'teams']);
		expect(firstExport.schema_version).toBe('typing-results-v1');
		expect(firstExport.teams).toHaveLength(6);
		expect(firstExport.teams[0]).toEqual({
			team_name: '2年生',
			match_1_score: 131,
			match_2_score: 132,
			match_3_score: 133,
			total_score: 396,
			rank: 1
		});
		expect(JSON.stringify(firstExport)).not.toContain('representative_source');

		const secondExportResponse = await admin.request.get('/admin/results.json');
		expect(secondExportResponse.headers()['x-export-id']).toBe(firstExport.export_id);
		expect(await secondExportResponse.text()).toBe(await firstExportResponse.text());
		await admin.reload();
		await expect(admin.getByRole('link', { name: 'JSONを再出力' })).toBeVisible();
		await expect(admin.locator('.export-history-row')).toContainText('2回');

		await expect(page.getByRole('heading', { name: '総合順位' })).toBeVisible();
		await expect(page.locator('.overall-total').first()).toContainText('396');
		await expect(page.getByRole('region', { name: '第1試合' }).getByText('失格')).toBeVisible();
	} finally {
		await adminContext.close();
		const cleanupDatabase = new Database(databaseUrl);
		cleanupDatabase.transaction(() => {
			cleanupDatabase.prepare('delete from result_exports').run();
			cleanupDatabase.prepare('delete from match_confirmations').run();
			cleanupDatabase.prepare('delete from match_disqualifications').run();
			cleanupDatabase.prepare('delete from match_operations').run();
			cleanupDatabase.prepare('delete from match_attempt_results').run();
			cleanupDatabase.prepare('delete from match_attempts').run();
			cleanupDatabase.prepare('delete from match_results').run();
		})();
		cleanupDatabase.close();
	}
});

test('synchronizes six competition terminals with monitoring', async ({ browser }) => {
	clearCompetitionResults();

	const monitorContext = await browser.newContext();
	const monitor = await monitorContext.newPage();
	await monitor.goto('/monitoring');
	const navigation = monitor.getByRole('navigation', { name: 'メインナビゲーション' });
	await expect(navigation).toContainText('モニタリング');
	await expect(navigation).toContainText('競技');

	const terminals = [];
	const terminalContexts = [];
	for (const representativeSource of ['1-1', 'IS2', 'IS3', 'IS4', 'IS5', '専教']) {
		const terminalContext = await browser.newContext();
		terminalContexts.push(terminalContext);
		const terminal = await terminalContext.newPage();
		terminals.push(terminal);
		await terminal.goto('/competition');
		await terminal.getByLabel('出場クラス').selectOption(representativeSource);
		await terminal.getByRole('button', { name: '端末を接続' }).click();
		await terminal.getByRole('button', { name: '準備完了' }).click();
		if (representativeSource === '1-1') {
			await terminal.reload();
			await expect(terminal.getByLabel('出場クラス')).toHaveValue('1-1');
			await expect(terminal.getByText('接続済み', { exact: true })).toBeVisible();
			await terminal.getByRole('button', { name: '準備完了' }).click();
			await expect(terminal.getByText('全員の準備を待っています')).toBeVisible();
		}
	}

	await expect(monitor.getByText('6/6 準備')).toBeVisible();
	await expect(terminals[0].getByText('全員の準備を待っています')).toBeVisible();
	await expect(terminals[0].getByText('競技中', { exact: true })).toHaveCount(0);

	const adminContext = await browser.newContext({
		httpCredentials: { username: adminUsername, password: adminPassword }
	});
	const admin = await adminContext.newPage();
	await admin.goto('/admin');
	const firstMatchControl = admin
		.locator('.competition-control-row')
		.filter({ hasText: '第1試合' });
	await expect(firstMatchControl.locator('.competition-count')).toHaveText([/6\/6/, /6\/6/]);
	admin.on('dialog', (dialog) => dialog.accept());
	await firstMatchControl.getByRole('button', { name: '一括開始' }).click();
	await expect(admin.getByRole('status')).toHaveText('第1試合を開始しました。');
	const lockedAssignmentResult = await admin.evaluate(
		async (assignments) => {
			const response = await fetch('/admin?/saveAssignments', {
				method: 'POST',
				redirect: 'manual',
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams(assignments)
			});
			return response.json();
		},
		{
			source_1_0: '1-2',
			source_1_1: 'IS2',
			source_1_2: 'IS3',
			source_1_3: 'IS4',
			source_1_4: 'IS5',
			source_1_5: '専教',
			source_2_0: '1-1',
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
		}
	);
	expect(lockedAssignmentResult).toMatchObject({ type: 'failure', status: 409 });

	await expect(terminals[0].getByText('競技中', { exact: true })).toBeVisible({ timeout: 6_000 });
	await terminals[1].reload();
	await expect(terminals[1].getByLabel('出場クラス')).toHaveValue('IS2');
	await expect(terminals[1].getByRole('heading', { name: /2年生/ })).toBeVisible();
	await expect(terminals[1].getByText('競技中', { exact: true })).toBeVisible();
	await terminals[0].getByLabel('タイピング入力').pressSequentially('aozora', { delay: 50 });

	const firstLane = monitor.getByRole('region', { name: 'レーン1 1年生' });
	await expect(firstLane.getByText('靴音')).toBeVisible();
	await expect(firstLane.locator('.monitor-metrics dd').first()).toHaveText('6');
	await expect(firstLane.getByText(/位$/)).toHaveCount(0);
	await expect(terminals[0].getByText('最終順位')).toHaveCount(0);

	await firstMatchControl.getByRole('button', { name: '中断', exact: true }).click();
	await expect(terminals[0].getByText('競技中断', { exact: true })).toBeVisible();
	await expect(firstMatchControl.getByText('中断', { exact: true })).toBeVisible();

	await firstMatchControl.getByPlaceholder('無効化の理由').fill('通信障害');
	await firstMatchControl.getByRole('button', { name: '無効化' }).click();
	await expect(terminals[0].getByText('試技無効', { exact: true })).toBeVisible();

	await firstMatchControl.getByPlaceholder('再試合の理由').fill('通信復旧後に再実施');
	await firstMatchControl.getByRole('button', { name: '再試合' }).click();
	await expect(firstMatchControl).toContainText('試技2 / typing-reserve-01');
	for (const terminal of terminals) {
		await expect(terminal.getByRole('button', { name: '準備完了' })).toBeVisible();
		await terminal.getByRole('button', { name: '準備完了' }).click();
	}
	await expect(firstMatchControl.locator('.competition-count')).toHaveText([/6\/6/, /6\/6/]);
	await firstMatchControl.getByRole('button', { name: '一括開始' }).click();
	await expect(terminals[0].getByText('競技中', { exact: true })).toBeVisible({ timeout: 6_000 });
	await firstMatchControl.getByRole('button', { name: '強制終了' }).click();
	await expect(terminals[0].getByText('強制終了', { exact: true })).toBeVisible();
	await expect(admin.getByRole('heading', { name: '試行・操作履歴' })).toBeVisible();
	await expect(admin.locator('.attempt-history-item')).toHaveCount(2);
	const retryAttempt = admin.locator('.attempt-history-item').filter({
		hasText: 'typing-reserve-01'
	});
	await retryAttempt.locator('summary').click();
	await expect(retryAttempt.locator('.attempt-result-row')).toHaveCount(7);
	await expect(admin.locator('.operation-history-row')).toHaveCount(6);

	for (const terminalContext of terminalContexts) await terminalContext.close();
	await adminContext.close();
	await monitorContext.close();
});
