import { z } from 'zod';
import { isProxyBaseUrl, type LlmConfig } from './config';
import { ConsentRequiredError } from './errors';
export const CONSENT_VERSION = 1;
export const PAPER_CONSENT_VERSION = 2;
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
export function acceptConsent(config: LlmConfig, paper = false): Consent | null {
  const consent = {
    version: paper ? PAPER_CONSENT_VERSION : CONSENT_VERSION,
    provider: providerFor(config),
    baseUrl: config.baseUrl,
    model: config.model,
    acceptedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(paper ? 'pl.paperConsent' : 'pl.consent', JSON.stringify(consent));
    if (paper) localStorage.setItem('pl.consent', JSON.stringify({ ...consent, version: CONSENT_VERSION }));
    return consent;
  } catch {
    return null;
  }
}
export function revokeConsent(): void {
  try {
    localStorage.removeItem('pl.consent');
    localStorage.removeItem('pl.paperConsent');
  } catch {
    /* Storage is unavailable. */
  }
}
export function hasPaperConsent(config: LlmConfig): boolean {
  try {
    const parsed = consentSchema.safeParse(JSON.parse(localStorage.getItem('pl.paperConsent') || 'null'));
    return (
      parsed.success &&
      parsed.data.version === PAPER_CONSENT_VERSION &&
      parsed.data.provider === providerFor(config) &&
      parsed.data.baseUrl === config.baseUrl &&
      parsed.data.model === config.model
    );
  } catch {
    return false;
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
