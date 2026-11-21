import { isAllowedOrganizationEmail, RESEARCH_HUB_ORIGINS, SSO_BASE_URL } from './config';

const HANDOFF_REQUEST = 'paperlab.sso.handoff.request';
const HANDOFF_RESPONSE = 'researchhub.sso.handoff.response';
const REFRESH_REQUEST = 'paperlab.sso.refresh.request';
const REFRESH_RESPONSE = 'researchhub.sso.refresh.response';

export interface HandoffSource {
  state: string;
  projectId: string;
}

export interface HandoffSession {
  accessToken: string;
  expiresAt: number;
  handoff: HandoffSource;
  profile: { sub: string; email: string; email_verified: boolean; name?: string };
}

export interface HandoffRequest {
  state: string;
  projectId: string;
}

function randomBase64Url(bytes: number) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export function getHandoffRequest(url: URL): HandoffRequest | null {
  const state = url.searchParams.get('rh_handoff');
  const projectId = url.searchParams.get('projectId');
  if (
    !state ||
    !/^[A-Za-z0-9_-]{32,128}$/u.test(state) ||
    !projectId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId)
  )
    return null;
  return { state, projectId };
}

export function clearHandoffFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('rh_handoff')) return;
  url.searchParams.delete('rh_handoff');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function requestResearchHubSession(
  request: HandoffRequest,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<HandoffSession> {
  if (!window.opener)
    return Promise.reject(
      new Error('Không nhận được phiên từ ResearchHub. Hãy mở PaperLab từ project trong ResearchHub.'),
    );
  if (!SSO_BASE_URL || RESEARCH_HUB_ORIGINS.length === 0) {
    return Promise.reject(new Error('PaperLab chưa cấu hình nguồn handoff ResearchHub.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, session?: HandoffSession, detachOpener = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      if (detachOpener) window.opener = null;
      if (error) reject(error);
      else if (session) resolve(session);
      else reject(new Error('ResearchHub không gửi được phiên đăng nhập.'));
    };

    const timeout = window.setTimeout(
      () => finish(new Error('Hết thời gian chờ ResearchHub. Hãy mở lại PaperLab từ project.')),
      timeoutMs,
    );
    const onAbort = () => finish(new Error('ResearchHub handoff was interrupted.'), undefined, false);

    const onMessage = (event: MessageEvent<unknown>) => {
      if (!RESEARCH_HUB_ORIGINS.includes(event.origin) || event.source !== window.opener) return;
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (
        message.type !== HANDOFF_RESPONSE ||
        message.state !== request.state ||
        message.projectId !== request.projectId ||
        (message.error !== 'session_expired' &&
          (typeof message.accessToken !== 'string' ||
            typeof message.expiresAt !== 'number' ||
            message.expiresAt <= Date.now()))
      )
        return;

      if (message.error === 'session_expired') {
        finish(new Error('Phiên SSO của ResearchHub đã hết hạn. Hãy đăng nhập lại từ ResearchHub.'));
        return;
      }

      void (async () => {
        try {
          const response = await fetch(new URL('/oauth/userinfo', SSO_BASE_URL), {
            headers: { Authorization: `Bearer ${message.accessToken as string}` },
          });
          const profile = (await response.json().catch(() => ({}))) as HandoffSession['profile'];
          if (
            !response.ok ||
            typeof profile.sub !== 'string' ||
            !isAllowedOrganizationEmail(profile.email, profile.email_verified)
          ) {
            throw new Error('ResearchHub gửi phiên SSO không hợp lệ. Hãy đăng nhập lại.');
          }
          finish(
            undefined,
            {
              accessToken: message.accessToken as string,
              expiresAt: message.expiresAt as number,
              handoff: { state: request.state, projectId: request.projectId },
              profile,
            },
            false,
          );
        } catch (cause) {
          finish(
            cause instanceof Error ? cause : new Error('Không xác minh được phiên ResearchHub với SSO.'),
          );
        }
      })();
    };

    window.addEventListener('message', onMessage);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const origin of RESEARCH_HUB_ORIGINS) {
      window.opener?.postMessage(
        { type: HANDOFF_REQUEST, state: request.state, projectId: request.projectId },
        origin,
      );
    }
  });
}

export function requestResearchHubTokenRefresh(
  handoff: HandoffSource,
  timeoutMs = 12_000,
  signal?: AbortSignal,
): Promise<{ accessToken: string; expiresAt: number }> {
  if (!window.opener) return Promise.reject(new Error('ResearchHub không còn mở để gia hạn phiên.'));
  return new Promise((resolve, reject) => {
    const requestId = randomBase64Url(18);
    let settled = false;
    const finish = (error?: Error, token?: { accessToken: string; expiresAt: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (token) resolve(token);
      else reject(new Error('ResearchHub không gửi được phiên mới.'));
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Hết thời gian chờ ResearchHub gia hạn phiên.')),
      timeoutMs,
    );
    const onAbort = () => finish(new Error('Yêu cầu gia hạn phiên bị hủy.'));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!RESEARCH_HUB_ORIGINS.includes(event.origin) || event.source !== window.opener) return;
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (
        message.type !== REFRESH_RESPONSE ||
        message.state !== handoff.state ||
        message.projectId !== handoff.projectId ||
        message.requestId !== requestId
      )
        return;
      if (message.error === 'session_expired') {
        finish(new Error('Phiên SSO của ResearchHub đã hết hạn. Hãy đăng nhập lại từ ResearchHub.'));
      } else if (
        typeof message.accessToken === 'string' &&
        typeof message.expiresAt === 'number' &&
        message.expiresAt > Date.now()
      ) {
        finish(undefined, { accessToken: message.accessToken, expiresAt: message.expiresAt });
      }
    };

    window.addEventListener('message', onMessage);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const origin of RESEARCH_HUB_ORIGINS) {
      window.opener?.postMessage(
        {
          type: REFRESH_REQUEST,
          state: handoff.state,
          projectId: handoff.projectId,
          requestId,
        },
        origin,
      );
    }
  });
}
