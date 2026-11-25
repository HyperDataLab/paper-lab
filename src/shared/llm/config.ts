import { z } from 'zod';
import { LlmConfigError } from './errors';
export type LlmConfig = { baseUrl: string; model: string; criticModel?: string; key?: string };
const settingsSchema = z.object({
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  criticModel: z.string().trim().min(1).optional(),
});
export const criticModelFor = (config: LlmConfig) => config.criticModel?.trim() || config.model;
export const SETTINGS_KEY = 'pl.llm.settings';
export const KEY_KEY = 'pl.llm.key';
const PRODUCTION_LLM_BASE_URL = 'https://paper-understanding-cors.nguyenquocan1010.workers.dev/v1';

export function defaultConfig(): LlmConfig {
  const configuredBaseUrl = import.meta.env.VITE_LLM_BASE_URL || '/llm';
  return {
    // `/llm` is served by Vite only in development. Firebase Hosting has no matching POST proxy route.
    baseUrl:
      !import.meta.env.DEV && isProxyBaseUrl(configuredBaseUrl) ? PRODUCTION_LLM_BASE_URL : configuredBaseUrl,
    model: import.meta.env.VITE_LLM_MODEL || 'cx/gpt-6-luna',
  };
}
export function isProxyBaseUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//') && !url.includes('\\');
}
export function validateConfig(config: LlmConfig): void {
  if (!config.model.trim()) throw new LlmConfigError('Model is required');
  if (isProxyBaseUrl(config.baseUrl)) {
    if (import.meta.env.DEV) return;
    throw new LlmConfigError('Relative LLM proxy URLs are only available in development');
  }
  try {
    const url = new URL(config.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))
    )
      throw new Error();
  } catch {
    throw new LlmConfigError('Invalid endpoint');
  }
}
export function getConfig(): LlmConfig {
  const defaults = defaultConfig();
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
    const settings = parsed.success ? parsed.data : defaults;
    // Migrate old production settings saved as `/llm`; that path exists only on the Vite dev server.
    const baseUrl =
      !import.meta.env.DEV && isProxyBaseUrl(settings.baseUrl) ? defaults.baseUrl : settings.baseUrl;
    return { ...settings, baseUrl, key: localStorage.getItem(KEY_KEY) || undefined };
  } catch {
    return defaults;
  }
}
export function saveConfig(config: LlmConfig): void {
  validateConfig(config);
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      baseUrl: config.baseUrl,
      model: config.model,
      criticModel: config.criticModel?.trim() || undefined,
    }),
  );
  if (config.key) localStorage.setItem(KEY_KEY, config.key);
  else localStorage.removeItem(KEY_KEY);
}
export function resetConfig(): void {
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(KEY_KEY);
}
