export const LAB_DOMAIN = 'hyperdatalab.org';
export const SSO_BASE_URL = (
  (import.meta.env.VITE_HYPERDATALAB_SSO_BASE_URL as string | undefined) ??
  'https://rpr-grobid-gateway.hpl-storage.workers.dev'
).replace(/\/+$/u, '');
export const SSO_CLIENT_ID = (import.meta.env.VITE_HYPERDATALAB_SSO_CLIENT_ID as string | undefined) ?? '';
export const SSO_CALLBACK_URL =
  (import.meta.env.VITE_HYPERDATALAB_SSO_CALLBACK_URL as string | undefined) ||
  (typeof window === 'undefined' ? '' : new URL('/auth/callback', window.location.origin).toString());
export const RESEARCH_HUB_URL = ((import.meta.env.VITE_RESEARCH_HUB_URL as string | undefined) ?? '').replace(
  /\/+$/u,
  '',
);
export const RESEARCH_HUB_ORIGINS = ((import.meta.env.VITE_RESEARCH_HUB_ORIGINS as string | undefined) ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => {
    try {
      return new URL(origin).origin === origin;
    } catch {
      return false;
    }
  });

export function ssoConfigurationError(config: { baseUrl: string; clientId: string; callbackUrl: string }) {
  const missing = [
    !config.baseUrl && 'VITE_HYPERDATALAB_SSO_BASE_URL',
    !config.clientId && 'VITE_HYPERDATALAB_SSO_CLIENT_ID',
    !config.callbackUrl && 'VITE_HYPERDATALAB_SSO_CALLBACK_URL',
  ].filter((value): value is string => Boolean(value));
  return missing.length
    ? `Thiếu cấu hình SSO: ${missing.join(', ')}. Hãy bổ sung biến này cho môi trường đang chạy.`
    : '';
}

export function isAllowedOrganizationEmail(email: unknown, verified: unknown): email is string {
  return verified === true && typeof email === 'string' && /^[^@\s]+@hyperdatalab\.org$/iu.test(email.trim());
}
