export const LAB_DOMAIN = 'hyperdatalab.org';
export const SSO_BASE_URL = (
  (import.meta.env.VITE_HYPERDATALAB_SSO_BASE_URL as string | undefined) ?? ''
).replace(/\/+$/u, '');
export const SSO_CLIENT_ID = (import.meta.env.VITE_HYPERDATALAB_SSO_CLIENT_ID as string | undefined) ?? '';
export const SSO_CALLBACK_URL =
  (import.meta.env.VITE_HYPERDATALAB_SSO_CALLBACK_URL as string | undefined) ?? '';
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

export function isAllowedOrganizationEmail(email: unknown, verified: unknown): email is string {
  return verified === true && typeof email === 'string' && /^[^@\s]+@hyperdatalab\.org$/iu.test(email.trim());
}
