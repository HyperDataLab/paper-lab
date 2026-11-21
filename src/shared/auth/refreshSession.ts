import { SSO_BASE_URL, SSO_CLIENT_ID } from './config';
import { requestResearchHubTokenRefresh } from './researchHubHandoff';
import { clearSsoSession, storeSsoSession, type SsoSession } from './session';

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
let refreshInProgress: Promise<SsoSession | null> | null = null;

export async function refreshSsoSessionIfNeeded(
  current: SsoSession,
  readCurrent: () => SsoSession | null,
): Promise<SsoSession | null> {
  if (current.expiresAt > Date.now() + REFRESH_BEFORE_EXPIRY_MS) return current;
  if (refreshInProgress) return refreshInProgress;

  const handoff = current.handoff;
  if (handoff) {
    refreshInProgress = (async () => {
      const fresh = await requestResearchHubTokenRefresh(handoff);
      const latest = readCurrent();
      if (!latest || latest.handoff?.state !== handoff.state) return latest;
      const next = { ...latest, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt };
      storeSsoSession(next);
      return next;
    })();
  } else if (current.refreshToken && current.refreshExpiresAt && current.refreshExpiresAt > Date.now()) {
    const refreshToken = current.refreshToken;
    refreshInProgress = (async () => {
      const response = await fetch(new URL('/oauth/token', SSO_BASE_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: current.refreshClientId ?? SSO_CLIENT_ID,
          refresh_token: refreshToken,
        }),
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as {
        access_token?: unknown;
        expires_in?: unknown;
        refresh_token?: unknown;
        refresh_token_expires_in?: unknown;
        error?: unknown;
        error_description?: unknown;
      };
      if (!response.ok) {
        if (body.error === 'INVALID_GRANT' || body.error === 'INVALID_CLIENT') {
          clearSsoSession();
          return null;
        }
        throw new Error(typeof body.error_description === 'string' ? body.error_description : 'Không thể gia hạn phiên SSO.');
      }
      if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
        clearSsoSession();
        throw new Error('Phản hồi gia hạn SSO thiếu access token hoặc refresh token mới.');
      }
      const latest = readCurrent();
      if (!latest || latest.refreshToken !== refreshToken) return latest;
      const next: SsoSession = {
        ...latest,
        accessToken: body.access_token,
        expiresAt: Date.now() + (typeof body.expires_in === 'number' ? Math.max(0, body.expires_in) : 3600) * 1000,
        refreshToken: body.refresh_token,
        refreshExpiresAt:
          Date.now() + (typeof body.refresh_token_expires_in === 'number' ? Math.max(0, body.refresh_token_expires_in) : 0) * 1000,
      };
      if (!next.refreshExpiresAt || next.refreshExpiresAt <= Date.now()) {
        clearSsoSession();
        return null;
      }
      storeSsoSession(next);
      return next;
    })();
  } else {
    return current.expiresAt > Date.now() ? current : null;
  }

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}
