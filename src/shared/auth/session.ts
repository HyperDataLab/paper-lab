import { isAllowedOrganizationEmail, SSO_CLIENT_ID } from './config';

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
    const hasRefreshToken =
      typeof session.refreshToken === 'string' &&
      typeof session.refreshExpiresAt === 'number' &&
      session.refreshExpiresAt > Date.now() &&
      (typeof session.refreshClientId === 'string' || Boolean(SSO_CLIENT_ID));
    const hasHandoff =
      !!session.handoff &&
      typeof session.handoff.state === 'string' &&
      typeof session.handoff.projectId === 'string';
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.expiresAt !== 'number' ||
      (session.expiresAt <= Date.now() && !hasRefreshToken && !hasHandoff) ||
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
