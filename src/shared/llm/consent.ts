import { z } from 'zod';
import { isProxyBaseUrl, type LlmConfig } from './config';
import { ConsentRequiredError } from './errors';
export const CONSENT_VERSION = 1;
const consentSchema = z.object({
  version: z.number(),
  provider: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  acceptedAt: z.iso.datetime(),
});
export type Consent = z.infer<typeof consentSchema>;
export function providerFor(config: LlmConfig): string {
  if (isProxyBaseUrl(config.baseUrl)) return 'proxy';
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return '';
  }
}
export function getConsent(): Consent | null {
  try {
    const parsed = consentSchema.safeParse(JSON.parse(localStorage.getItem('pl.consent') || 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function acceptConsent(config: LlmConfig): Consent | null {
  const consent = {
    version: CONSENT_VERSION,
    provider: providerFor(config),
    baseUrl: config.baseUrl,
    model: config.model,
    acceptedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem('pl.consent', JSON.stringify(consent));
    return consent;
  } catch {
    return null;
  }
}
export function revokeConsent(): void {
  try {
    localStorage.removeItem('pl.consent');
  } catch {
    /* Storage is unavailable. */
  }
}
export function hasValidConsent(config: LlmConfig): boolean {
  const c = getConsent();
  return (
    c !== null &&
    c.version === CONSENT_VERSION &&
    c.provider === providerFor(config) &&
    c.baseUrl === config.baseUrl
  );
}
export function requireConsent(config: LlmConfig): void {
  if (!hasValidConsent(config)) throw new ConsentRequiredError();
}
