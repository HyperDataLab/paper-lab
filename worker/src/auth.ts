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

export type CallerKind = 'firebase' | 'sso';
export interface VerifiedCaller {
  uid: string;
  email: string;
  kind: CallerKind;
}

const FIREBASE_ISSUER = 'https://securetoken.google.com/';

function decodeJwtPart(part: string): Record<string, unknown> | null {
  try {
    const base64 = part.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const value: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    );
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * True when a bearer token looks like a Firebase ID token: three dot-separated parts, an RS256 header and a
 * `securetoken.google.com` issuer. Nothing is trusted from this peek; the token is still verified in full.
 * Every other token goes to the SSO userinfo check.
 */
export function looksLikeFirebaseToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return false;
  const header = decodeJwtPart(parts[0] as string);
  const payload = decodeJwtPart(parts[1] as string);
  return (
    header?.alg === 'RS256' && typeof payload?.iss === 'string' && payload.iss.startsWith(FIREBASE_ISSUER)
  );
}

export const SSO_CACHE_MS = 5 * 60_000;
const SSO_CACHE_MAX = 1000;

async function tokenDigest(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `verifySsoToken` with a cache per isolate: a verified identity is kept for five minutes under the SHA-256 of
 * the token (never the token itself). Failures are not cached.
 */
export function cachedSsoVerifier(options: {
  ssoBaseUrl: string;
  domain: string;
  fetcher?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}) {
  const { ssoBaseUrl, domain, fetcher = fetch, now = Date.now, ttlMs = SSO_CACHE_MS } = options;
  const cache = new Map<string, { value: { uid: string; email: string }; expires: number }>();
  return async (token: string) => {
    const key = await tokenDigest(token);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    cache.delete(key);
    const value = await verifySsoToken(token, ssoBaseUrl, domain, fetcher);
    const at = now();
    if (cache.size >= SSO_CACHE_MAX) {
      for (const [entry, { expires }] of cache) if (expires <= at) cache.delete(entry);
      if (cache.size >= SSO_CACHE_MAX) cache.clear();
    }
    cache.set(key, { value, expires: at + ttlMs });
    return value;
  };
}

/** Sends a bearer token to the Firebase or the SSO check and records which kind it was (ADR 0008). */
export function dualVerifier(verify: {
  firebase: (token: string) => Promise<{ uid: string; email: string }>;
  sso: (token: string) => Promise<{ uid: string; email: string }>;
}) {
  return async (token: string): Promise<VerifiedCaller> =>
    looksLikeFirebaseToken(token)
      ? { ...(await verify.firebase(token)), kind: 'firebase' }
      : { ...(await verify.sso(token)), kind: 'sso' };
}

/** Checks a central HyperDataLab SSO access token against the provider's userinfo endpoint. */
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
