import { createLlmClient, type LlmClient } from './client';
import type { LlmConfig } from './config';
import { requireConsent } from './consent';
export function createGatedClient(config: LlmConfig, client: LlmClient = createLlmClient(config)): LlmClient {
  return {
    completeJson: (options) => {
      requireConsent(config);
      return client.completeJson(options);
    },
  };
}
