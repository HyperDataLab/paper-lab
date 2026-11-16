import { jwtVerify, type JWTVerifyGetKey } from 'jose';

export const SECURETOKEN_JWKS =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** True only for an address whose domain is exactly `domain`: one '@', no sub-domain, no look-alike. */
export function emailAllowed(email: unknown, domain: string): email is string {
  if (typeof email !== 'string') return false;
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && email.slice(at + 1).toLowerCase() === domain;
}

export class NotAllowedError extends Error {}

/**
 * Checks a Firebase ID token: Google's signature, this project as issuer and audience, a verified Google
 * account. A good token from another domain is `NotAllowedError` (403); anything else throws (401).
 */
export async function verifyFirebaseToken(
  token: string,
  jwks: JWTVerifyGetKey,
  projectIds: string | string[],
  domain: string,
): Promise<{ uid: string; email: string }> {
  const projects = typeof projectIds === 'string' ? [projectIds] : projectIds;
  const { payload } = await jwtVerify(token, jwks, {
    issuer: projects.map((id) => `https://securetoken.google.com/${id}`),
    audience: projects,
    algorithms: ['RS256'],
  });
  if (typeof payload.aud !== 'string' || payload.iss !== `https://securetoken.google.com/${payload.aud}`)
    throw new Error('issuer and audience do not match');
  const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (!payload.sub || payload.email_verified !== true || provider !== 'google.com')
    throw new Error('unverified account');
  if (!emailAllowed(payload.email, domain)) throw new NotAllowedError('domain not allowed');
  return { uid: payload.sub, email: payload.email };
}
