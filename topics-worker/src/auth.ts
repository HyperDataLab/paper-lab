// Kept in sync with worker/src/auth.ts for the separate worker.
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

export async function verifySsoToken(
  token: string,
  ssoBaseUrl: string,
  domain: string,
  fetcher: typeof fetch = fetch,
): Promise<{ uid: string; email: string }> {
  if (!ssoBaseUrl.trim()) throw new Error('SSO_BASE_URL is not configured');
  let response: Response;
  try {
    response = await fetcher(new URL('/oauth/userinfo', ssoBaseUrl), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('SSO userinfo endpoint is unavailable');
  }
  if (response.status === 401 || response.status === 403) throw new Error('invalid SSO access token');
  if (!response.ok) throw new Error('Could not verify the SSO access token');
  const profile: unknown = await response.json().catch(() => null);
  if (!profile || typeof profile !== 'object') throw new Error('invalid SSO profile');
  const value = profile as { sub?: unknown; email?: unknown; email_verified?: unknown };
  if (typeof value.sub !== 'string' || value.email_verified !== true)
    throw new Error('SSO profile is missing a verified identity');
  if (!emailAllowed(value.email, domain)) throw new NotAllowedError('domain not allowed');
  return { uid: value.sub, email: value.email };
}

/**
 * Checks a Firebase ID token: Google's signature, this project as issuer and audience, a verified Google
 * account. A good token from another domain is `NotAllowedError` (403); anything else throws (401).
 */
export async function verifyFirebaseToken(
  token: string,
  jwks: JWTVerifyGetKey,
  projectId: string,
  domain: string,
): Promise<{ uid: string; email: string }> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
  });
  const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (!payload.sub || payload.email_verified !== true || provider !== 'google.com')
    throw new Error('unverified account');
  if (!emailAllowed(payload.email, domain)) throw new NotAllowedError('domain not allowed');
  return { uid: payload.sub, email: payload.email };
}
