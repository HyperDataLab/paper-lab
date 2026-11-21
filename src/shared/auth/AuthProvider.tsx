import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type LabUser } from './authContext';
import { isAllowedOrganizationEmail, SSO_BASE_URL, SSO_CALLBACK_URL, SSO_CLIENT_ID } from './config';
import { clearHandoffFromUrl, getHandoffRequest, requestResearchHubSession } from './researchHubHandoff';

const SESSION_KEY = 'paperlab-sso-session';
const ATTEMPT_KEY = 'paperlab-sso-attempt';
const SESSION_EVENT = 'paperlab-sso-session-change';
const MAX_LOGIN_AGE_MS = 10 * 60 * 1000;

interface SsoProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

interface SsoSession {
  accessToken: string;
  expiresAt: number;
  profile: SsoProfile;
}

interface SsoAttempt {
  state: string;
  verifier: string;
  createdAt: number;
  returnTo: string;
}

let callbackInProgress: Promise<string> | null = null;

function fromSession(value: string | null): SsoSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<SsoSession>;
    const profile = session.profile;
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.expiresAt !== 'number' ||
      session.expiresAt <= Date.now() ||
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

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const session = fromSession(raw);
    if (!session && raw) sessionStorage.removeItem(SESSION_KEY);
    return session;
  } catch {
    return null;
  }
}

function randomBase64Url(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  const target = new URL(value, window.location.origin);
  return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : '/';
}

function configurationError() {
  if (!SSO_BASE_URL || !SSO_CLIENT_ID || !SSO_CALLBACK_URL) {
    return 'PaperLab chưa được cấu hình kết nối HyperDataLab SSO.';
  }
  return '';
}

async function startLogin(returnTo: string) {
  const error = configurationError();
  if (error) throw new Error(error);
  const state = randomBase64Url();
  const verifier = randomBase64Url();
  const attempt: SsoAttempt = { state, verifier, createdAt: Date.now(), returnTo: safeReturnTo(returnTo) };
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  const authorize = new URL('/oauth/authorize', SSO_BASE_URL);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: SSO_CLIENT_ID,
    redirect_uri: SSO_CALLBACK_URL,
    scope: 'email profile hyperdatalab_profile',
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  window.location.assign(authorize.toString());
}

async function finishCallback() {
  const callback = new URL(window.location.href);
  const providerError = callback.searchParams.get('error_description') ?? callback.searchParams.get('error');
  if (providerError) throw new Error(providerError);
  const code = callback.searchParams.get('code');
  const returnedState = callback.searchParams.get('state');
  const rawAttempt = sessionStorage.getItem(ATTEMPT_KEY);
  if (!rawAttempt || !code || !returnedState) throw new Error('Phiên SSO không hợp lệ. Hãy đăng nhập lại.');

  let attempt: SsoAttempt;
  try {
    attempt = JSON.parse(rawAttempt) as SsoAttempt;
  } catch {
    throw new Error('Không đọc được phiên đăng nhập. Hãy đăng nhập lại.');
  }
  if (
    attempt.state !== returnedState ||
    Date.now() - attempt.createdAt < 0 ||
    Date.now() - attempt.createdAt > MAX_LOGIN_AGE_MS
  )
    throw new Error('Phiên SSO không khớp hoặc đã hết hạn. Hãy đăng nhập lại.');

  const tokenResponse = await fetch(new URL('/oauth/token', SSO_BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      code,
      redirect_uri: SSO_CALLBACK_URL,
      code_verifier: attempt.verifier,
    }),
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
    throw new Error(tokenBody.error_description ?? tokenBody.error ?? 'Không đổi được mã đăng nhập SSO.');
  }
  const userInfoResponse = await fetch(new URL('/oauth/userinfo', SSO_BASE_URL), {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = (await userInfoResponse.json().catch(() => ({}))) as Partial<SsoProfile>;
  if (!userInfoResponse.ok || typeof profile.sub !== 'string')
    throw new Error('Không lấy được hồ sơ từ HyperDataLab SSO.');
  if (!isAllowedOrganizationEmail(profile.email, profile.email_verified))
    throw new Error('Chỉ chấp nhận tài khoản email đã xác minh thuộc @hyperdatalab.org.');

  const expiresIn = typeof tokenBody.expires_in === 'number' ? tokenBody.expires_in : 3600;
  const session: SsoSession = {
    accessToken: tokenBody.access_token,
    expiresAt: Date.now() + Math.max(0, expiresIn) * 1000,
    profile: profile as SsoProfile,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem(ATTEMPT_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
  return safeReturnTo(attempt.returnTo);
}

function finishCallbackOnce() {
  callbackInProgress ??= finishCallback().finally(() => {
    callbackInProgress = null;
  });
  return callbackInProgress;
}

async function revokeSession(session: SsoSession | null) {
  if (session?.accessToken && SSO_BASE_URL) {
    await fetch(new URL('/oauth/revoke', SSO_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.accessToken }),
    }).catch(() => undefined);
  }
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const isCallback =
    window.location.pathname ===
    new URL(SSO_CALLBACK_URL || `${window.location.origin}/auth/callback`).pathname;
  const initialUrl = new URL(window.location.href);
  const initialHandoff = getHandoffRequest(initialUrl);
  const hasHandoffParameter = initialUrl.searchParams.has('rh_handoff');
  const [session, setSession] = useState<SsoSession | null>(() =>
    hasHandoffParameter && !initialHandoff ? null : readSession(),
  );
  const [ready, setReady] = useState(() => !isCallback && !initialHandoff);
  const [error, setError] = useState(() =>
    hasHandoffParameter && !initialHandoff
      ? 'Liên kết handoff ResearchHub không hợp lệ. Hãy đăng nhập lại.'
      : '',
  );
  const [handoffFailed, setHandoffFailed] = useState(() => hasHandoffParameter && !initialHandoff);

  useEffect(() => {
    let active = true;
    const handoffController = new AbortController();
    const url = new URL(window.location.href);
    if (url.pathname === new URL(SSO_CALLBACK_URL || `${window.location.origin}/auth/callback`).pathname) {
      void finishCallbackOnce()
        .then((returnTo) => {
          if (!active) return;
          setSession(readSession());
          window.location.replace(returnTo);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setError(cause instanceof Error ? cause.message : 'Không đăng nhập được bằng HyperDataLab SSO.');
          setSession(null);
          setReady(true);
          const rawAttempt = sessionStorage.getItem(ATTEMPT_KEY);
          sessionStorage.removeItem(ATTEMPT_KEY);
          let returnTo = '/';
          try {
            const attempt = JSON.parse(rawAttempt ?? 'null') as Partial<SsoAttempt> | null;
            if (typeof attempt?.returnTo === 'string') returnTo = safeReturnTo(attempt.returnTo);
          } catch {
            /* A malformed attempt cannot choose a return URL. */
          }
          window.history.replaceState({}, '', returnTo);
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
    } else if (url.searchParams.has('rh_handoff')) {
      const request = getHandoffRequest(url);
      if (!request) {
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch {
          /* A malformed handoff still gates the app even if storage cannot be cleared. */
        }
        clearHandoffFromUrl();
      } else {
        void requestResearchHubSession(request, 15_000, handoffController.signal)
          .then((nextSession) => {
            if (!active) return;
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
            window.dispatchEvent(new Event(SESSION_EVENT));
            setSession(nextSession);
            setError('');
            setHandoffFailed(false);
            clearHandoffFromUrl();
            setReady(true);
          })
          .catch((cause: unknown) => {
            if (!active) return;
            setError(
              cause instanceof Error ? cause.message : 'Không nhận được phiên đăng nhập từ ResearchHub.',
            );
            sessionStorage.removeItem(SESSION_KEY);
            setSession(null);
            setHandoffFailed(true);
            clearHandoffFromUrl();
            setReady(true);
          });
      }
    }
    const sync = () => setSession(readSession());
    window.addEventListener('storage', sync);
    window.addEventListener(SESSION_EVENT, sync);
    return () => {
      active = false;
      handoffController.abort();
      window.removeEventListener('storage', sync);
      window.removeEventListener(SESSION_EVENT, sync);
    };
  }, []);

  const signIn = useCallback(async () => {
    setError('');
    try {
      await startLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu đăng nhập SSO.');
    }
  }, []);
  const signOut = useCallback(async () => {
    await revokeSession(session);
    setSession(null);
  }, [session]);
  const getAccessToken = useCallback(async () => readSession()?.accessToken ?? null, []);
  const user: LabUser | null = useMemo(
    () =>
      session
        ? { uid: session.profile.sub, email: session.profile.email, name: session.profile.name ?? null }
        : null,
    [session],
  );
  const value = useMemo(
    () => ({
      user,
      ready,
      error,
      handoffFailed,
      signIn,
      signOut,
      getAccessToken,
      getIdToken: getAccessToken,
    }),
    [user, ready, error, handoffFailed, signIn, signOut, getAccessToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
