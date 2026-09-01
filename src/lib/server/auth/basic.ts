import { verifyBasicAuthorization as verify } from '../../../../server/basic-auth.js';

export type BasicCredentials = {
	username: string;
	password: string;
};

export function verifyBasicAuthorization(
	authorization: string | null,
	expected: BasicCredentials
): boolean {
	return verify(authorization, expected);
}
