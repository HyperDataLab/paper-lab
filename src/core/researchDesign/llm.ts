/** M2 adapts this suggestion request to PaperLab's consent-gated LLM client. */
export interface ChatRequest {
  projectId: string;
  feature: 'connection_test' | 'bank_matching' | 'plan_suggestion';
  promptVersion: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxOutputTokens?: number;
  responseSchema?: Record<string, unknown>;
}
