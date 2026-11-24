import { z } from 'zod';
import { criticModelFor, isProxyBaseUrl, type LlmConfig } from './config';
import { ConsentRequiredError } from './errors';
export const CONSENT_VERSION = 1;
export const PAPER_CONSENT_VERSION = 2;
const AUTORESEARCH_CONSENT_VERSION = 1;
const KG_ANSWER_CONSENT_VERSION = 1;
export type ConsentScope = 'paper' | 'autoresearch' | 'kg' | 'kgAnswer';
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
export function acceptConsent(
  config: LlmConfig,
  paper = false,
  autoresearch = false,
  kgAnswer = false,
): Consent | null {
  const consent = {
    version: kgAnswer ? KG_ANSWER_CONSENT_VERSION : paper ? PAPER_CONSENT_VERSION : CONSENT_VERSION,
    provider: providerFor(config),
    baseUrl: config.baseUrl,
    model: config.model,
    acceptedAt: new Date().toISOString(),
  };
  try {
    if (kgAnswer) localStorage.setItem('pl.kgAnswerConsent', JSON.stringify(consent));
    else localStorage.setItem(paper ? 'pl.paperConsent' : 'pl.consent', JSON.stringify(consent));
    if (paper) localStorage.setItem('pl.consent', JSON.stringify({ ...consent, version: CONSENT_VERSION }));
    if (autoresearch)
      localStorage.setItem(
        'pl.autoresearchConsent',
        JSON.stringify({
          ...consent,
          version: AUTORESEARCH_CONSENT_VERSION,
          criticModel: criticModelFor(config),
        }),
      );
    return consent;
  } catch {
    return null;
  }
}
export function revokeConsent(): void {
  try {
    localStorage.removeItem('pl.consent');
    localStorage.removeItem('pl.paperConsent');
    localStorage.removeItem('pl.autoresearchConsent');
    localStorage.removeItem('pl.kgAnswerConsent');
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
export function hasKgAnswerConsent(config: LlmConfig): boolean {
  try {
    const parsed = consentSchema.safeParse(JSON.parse(localStorage.getItem('pl.kgAnswerConsent') || 'null'));
    return (
      hasValidConsent(config) &&
      parsed.success &&
      parsed.data.version === KG_ANSWER_CONSENT_VERSION &&
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
export function requirePaperConsent(config: LlmConfig): void {
  requireConsent(config);
  if (!hasPaperConsent(config)) throw new ConsentRequiredError();
}
export function hasAutoResearchConsent(config: LlmConfig): boolean {
  try {
    const record = consentSchema
      .extend({ criticModel: z.string() })
      .parse(JSON.parse(localStorage.getItem('pl.autoresearchConsent') || 'null'));
    return (
      hasValidConsent(config) &&
      hasPaperConsent(config) &&
      record.version === AUTORESEARCH_CONSENT_VERSION &&
      record.baseUrl === config.baseUrl &&
      record.model === config.model &&
      record.criticModel === criticModelFor(config)
    );
  } catch {
    return false;
  }
}
export function requireAutoResearchConsent(config: LlmConfig) {
  if (!hasAutoResearchConsent(config)) throw new ConsentRequiredError();
}
