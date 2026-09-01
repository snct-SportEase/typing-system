import { describe, expect, it } from 'vitest';
import { verifyBasicAuthorization } from './basic';

const credentials = { username: 'operator', password: 'correct:password' };

describe('Basic authorization', () => {
	it('accepts matching credentials', () => {
		const header = `Basic ${Buffer.from('operator:correct:password').toString('base64')}`;
		expect(verifyBasicAuthorization(header, credentials)).toBe(true);
	});

	it.each([
		null,
		'Bearer token',
		`Basic ${Buffer.from('operator:wrong').toString('base64')}`,
		`Basic ${Buffer.from('wrong:correct:password').toString('base64')}`
	])('rejects invalid credentials', (header) => {
		expect(verifyBasicAuthorization(header, credentials)).toBe(false);
	});
});
