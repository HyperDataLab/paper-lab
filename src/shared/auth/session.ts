import { isAllowedOrganizationEmail } from './config';

export const SESSION_KEY = 'paperlab-sso-session';
export const SESSION_EVENT = 'paperlab-sso-session-change';

export interface SsoProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export interface SsoSession {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  refreshClientId?: string;
  handoff?: { state: string; projectId: string };
  profile: SsoProfile;
}

function fromSession(value: string | null): SsoSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<SsoSession>;
    const profile = session.profile;
    // Keep expired but otherwise valid sessions so AuthProvider can refresh or restart SSO.
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.expiresAt !== 'number' ||
      !profile ||
      typeof profile.sub !== 'string' ||
      !isAllowedOrganizationEmail(profile.email, profile.email_verified)
    )
      return null;
    return session as SsoSession;
  } catch {
    return null;
  }
}

export function readSsoSession(): SsoSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const session = fromSession(raw);
    if (!session && raw) sessionStorage.removeItem(SESSION_KEY);
    return session;
  } catch {
    return null;
  }
}

export function storeSsoSession(session: SsoSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSsoSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}
