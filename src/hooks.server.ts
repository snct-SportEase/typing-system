import { env } from '$env/dynamic/private';
import { verifyBasicAuthorization } from '$lib/server/auth/basic';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/admin')) return resolve(event);

	if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
		throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set');
	}

	const authenticated = verifyBasicAuthorization(event.request.headers.get('authorization'), {
		username: env.ADMIN_USERNAME,
		password: env.ADMIN_PASSWORD
	});

	if (!authenticated) {
		return new Response('Authentication required', {
			status: 401,
			headers: { 'www-authenticate': 'Basic realm="Typing System Admin", charset="UTF-8"' }
		});
	}

	return resolve(event);
};
