import { describe, expect, it } from 'vitest';
import { validateProductionConfiguration } from './configuration.js';

describe('production configuration', () => {
	it('rejects missing and example admin credentials', () => {
		expect(() => validateProductionConfiguration({ NODE_ENV: 'production' })).toThrow(
			'ADMIN_USERNAME and ADMIN_PASSWORD must be set'
		);
		expect(() =>
			validateProductionConfiguration({
				NODE_ENV: 'production',
				ADMIN_USERNAME: 'admin',
				ADMIN_PASSWORD: 'change-this-password'
			})
		).toThrow('ADMIN_PASSWORD must be changed');
	});

	it('accepts explicitly configured production credentials', () => {
		expect(() =>
			validateProductionConfiguration({
				NODE_ENV: 'production',
				ADMIN_USERNAME: 'operator',
				ADMIN_PASSWORD: 'a-unique-secret'
			})
		).not.toThrow();
	});
});
