import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type LabUser } from './authContext';
import { isAllowedOrganizationEmail, SSO_BASE_URL, SSO_CALLBACK_URL, SSO_CLIENT_ID } from './config';
import { clearHandoffFromUrl, getHandoffRequest, requestResearchHubSession } from './researchHubHandoff';
import { refreshSsoSessionIfNeeded } from './refreshSession';
import { clearSsoSession, readSsoSession, SESSION_EVENT, storeSsoSession, type SsoProfile, type SsoSession } from './session';

const ATTEMPT_KEY = 'paperlab-sso-attempt';
const MAX_LOGIN_AGE_MS = 10 * 60 * 1000;

interface SsoAttempt {
  state: string;
  verifier: string;
  createdAt: number;
  returnTo: string;
}

let callbackInProgress: Promise<string> | null = null;
let loginRedirectInProgress = false;

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
  if (loginRedirectInProgress) return;
  const error = configurationError();
  if (error) throw new Error(error);
  loginRedirectInProgress = true;
  try {
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
  } catch (cause) {
    loginRedirectInProgress = false;
    throw cause;
  }
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
    refresh_token?: unknown;
    refresh_token_expires_in?: unknown;
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
    ...(typeof tokenBody.refresh_token === 'string' ? { refreshToken: tokenBody.refresh_token } : {}),
    ...(typeof tokenBody.refresh_token_expires_in === 'number'
      ? { refreshExpiresAt: Date.now() + Math.max(0, tokenBody.refresh_token_expires_in) * 1000 }
      : {}),
    refreshClientId: SSO_CLIENT_ID,
    profile: profile as SsoProfile,
  };
  storeSsoSession(session);
  sessionStorage.removeItem(ATTEMPT_KEY);
  return safeReturnTo(attempt.returnTo);
}

function finishCallbackOnce() {
  callbackInProgress ??= finishCallback().finally(() => {
    callbackInProgress = null;
  });
  return callbackInProgress;
}

async function revokeSession(session: SsoSession | null) {
  const token = session?.handoff ? null : session?.refreshToken ?? session?.accessToken;
  if (token && SSO_BASE_URL) {
    await fetch(new URL('/oauth/revoke', SSO_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }
  clearSsoSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const isCallback = window.location.pathname === new URL(SSO_CALLBACK_URL || `${window.location.origin}/auth/callback`).pathname;
  const initialUrl = new URL(window.location.href);
  const initialHandoff = getHandoffRequest(initialUrl);
  const hasHandoffParameter = initialUrl.searchParams.has('rh_handoff');
  const [shouldStartLogin] = useState(() => {
    const projectId = initialUrl.searchParams.get('projectId');
    const hasProjectContext = Boolean(
      projectId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId),
    );
    return !hasHandoffParameter && hasProjectContext && !readSsoSession();
  });
  const [session, setSession] = useState<SsoSession | null>(() =>
    hasHandoffParameter && !initialHandoff ? null : readSsoSession(),
  );
  const [ready, setReady] = useState(() => !isCallback && !initialHandoff && !shouldStartLogin);
  const [error, setError] = useState(() => hasHandoffParameter && !initialHandoff ? 'Liên kết handoff ResearchHub không hợp lệ. Hãy đăng nhập lại.' : '');
  const [handoffFailed, setHandoffFailed] = useState(() => hasHandoffParameter && !initialHandoff);

  const reauthenticate = useCallback(async (message = 'Phiên làm việc đã hết hạn. Đang kết nối lại HyperDataLab SSO…') => {
    setError(message);
    try {
      await startLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch (cause) {
      loginRedirectInProgress = false;
      clearSsoSession();
      setSession(null);
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu đăng nhập lại bằng HyperDataLab SSO.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const handoffController = new AbortController();
    const url = new URL(window.location.href);
    if (url.pathname === new URL(SSO_CALLBACK_URL || `${window.location.origin}/auth/callback`).pathname) {
      void finishCallbackOnce()
        .then((returnTo) => {
          if (!active) return;
          setSession(readSsoSession());
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
          clearSsoSession();
        } catch {
          /* A malformed handoff still gates the app even if storage cannot be cleared. */
        }
        clearHandoffFromUrl();
      } else {
        void requestResearchHubSession(request, 15_000, handoffController.signal)
          .then((nextSession) => {
            if (!active) return;
            storeSsoSession(nextSession);
            setSession(nextSession);
            setError('');
            setHandoffFailed(false);
            clearHandoffFromUrl();
            setReady(true);
          })
          .catch(async (cause: unknown) => {
            if (!active) return;
            const handoffError = cause instanceof Error ? cause.message : 'Không nhận được phiên đăng nhập từ ResearchHub.';
            clearSsoSession();
            setSession(null);
            setHandoffFailed(true);
            clearHandoffFromUrl();
            const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            try {
              await startLogin(returnTo);
            } catch (loginCause) {
              loginRedirectInProgress = false;
              setError(loginCause instanceof Error ? loginCause.message : handoffError);
              setReady(true);
            }
          });
      }
    } else if (shouldStartLogin) {
      void startLogin(`${url.pathname}${url.search}${url.hash}`).catch((cause: unknown) => {
        if (!active) return;
        loginRedirectInProgress = false;
        setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu đăng nhập lại bằng HyperDataLab SSO.');
        setReady(true);
      });
    }
    const sync = () => setSession(readSsoSession());
    window.addEventListener('storage', sync);
    window.addEventListener(SESSION_EVENT, sync);
    return () => {
      active = false;
      handoffController.abort();
      window.removeEventListener('storage', sync);
      window.removeEventListener(SESSION_EVENT, sync);
    };
  }, [shouldStartLogin]);

  const signIn = useCallback(async () => {
    setError('');
    setHandoffFailed(false);
    try {
      await startLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch (cause) {
      loginRedirectInProgress = false;
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu đăng nhập SSO.');
    }
  }, []);
  const signOut = useCallback(async () => {
    await revokeSession(session);
    setSession(null);
  }, [session]);
  const getAccessToken = useCallback(async () => {
    const current = readSsoSession();
    if (!current) return null;
    try {
      const next = await refreshSsoSessionIfNeeded(current, readSsoSession);
      if (!next || next.accessToken !== current.accessToken) setSession(readSsoSession());
      if (!next) {
        await reauthenticate();
        return null;
      }
      return next.expiresAt > Date.now() ? next.accessToken : null;
    } catch (cause) {
      if (current.handoff || current.expiresAt <= Date.now()) {
        await reauthenticate(cause instanceof Error ? 'Không gia hạn được phiên ResearchHub. Đang kết nối lại bằng HyperDataLab SSO…' : undefined);
        return null;
      }
      return current.expiresAt > Date.now() ? current.accessToken : null;
    }
  }, [reauthenticate]);
  useEffect(() => {
    if (!session) return;

    let active = true;
    let timer: number | undefined;
    const canRefresh = (candidate: SsoSession) =>
      candidate.handoff
        ? Boolean(window.opener)
        : Boolean(candidate.refreshToken && (!candidate.refreshExpiresAt || candidate.refreshExpiresAt > Date.now()));
    const schedule = (candidate: SsoSession) => {
      if (timer !== undefined) window.clearTimeout(timer);
      const refreshEarlyBy = canRefresh(candidate) ? 5 * 60 * 1000 : 0;
      timer = window.setTimeout(() => void refresh(), Math.max(1_000, candidate.expiresAt - Date.now() - refreshEarlyBy));
    };
    const refresh = async () => {
      const current = readSsoSession();
      if (!current) return;
      try {
        const next = await refreshSsoSessionIfNeeded(current, readSsoSession);
        if (!active) return;
        if (!next) {
          await reauthenticate();
          return;
        }
        if (next.accessToken !== current.accessToken) setSession(next);
        schedule(next);
      } catch {
        if (!active) return;
        if (current.handoff || current.expiresAt <= Date.now()) {
          await reauthenticate('Không gia hạn được phiên làm việc. Đang kết nối lại bằng HyperDataLab SSO…');
          return;
        }
        timer = window.setTimeout(() => void refresh(), 30_000);
      }
    };
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    schedule(session);
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [reauthenticate, session]);
  const user: LabUser | null = useMemo(
    () => (session ? { uid: session.profile.sub, email: session.profile.email, name: session.profile.name ?? null } : null),
    [session],
  );
  const value = useMemo(
    () => ({ user, ready, error, handoffFailed, signIn, signOut, getAccessToken, getIdToken: getAccessToken }),
    [user, ready, error, handoffFailed, signIn, signOut, getAccessToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
