import { timingSafeEqual } from 'node:crypto';

/**
 * @param {string | null | undefined} authorization
 * @param {{ username: string, password: string }} expected
 */
export function verifyBasicAuthorization(authorization, expected) {
	if (!authorization?.startsWith('Basic ')) return false;

	let decoded;
	try {
		decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
	} catch {
		return false;
	}

	const separator = decoded.indexOf(':');
	if (separator < 0) return false;
	const usernameMatches = safeEqual(decoded.slice(0, separator), expected.username);
	const passwordMatches = safeEqual(decoded.slice(separator + 1), expected.password);
	return usernameMatches && passwordMatches;
}

/** @param {string} actual @param {string} expected */
function safeEqual(actual, expected) {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return (
		actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
	);
}
