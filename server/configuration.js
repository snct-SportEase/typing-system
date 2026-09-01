/** @param {NodeJS.ProcessEnv} environment */
export function validateProductionConfiguration(environment) {
	if (environment.NODE_ENV !== 'production') return;
	if (!environment.ADMIN_USERNAME || !environment.ADMIN_PASSWORD) {
		throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in production');
	}
	if (environment.ADMIN_PASSWORD === 'change-this-password') {
		throw new Error('ADMIN_PASSWORD must be changed from the example value in production');
	}
}
