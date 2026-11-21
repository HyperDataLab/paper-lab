export class ConsentRequiredError extends Error {
  constructor() {
    super('Privacy consent is required');
  }
}
export class LlmConfigError extends Error {}
export class LlmNetworkError extends Error {
  constructor() {
    super('Network request failed');
  }
}
export class LlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(`LLM HTTP ${status}`);
  }
}
export class LlmTimeoutError extends Error {
  constructor() {
    super('LLM request timed out');
  }
}
/** Shape of the last answer that failed validation; holds no answer text, only its structure. */
export type InvalidOutputDetails = {
  /** `response_format` sent with the last request. */
  responseFormat: 'json_schema' | 'json_object' | 'none';
  /** The body arrived as server-sent chunks. */
  streamed: boolean;
  /** `chat_completion` when the body had `choices[0].message`, `unparseable` when it was not JSON. */
  envelope: 'chat_completion' | 'unexpected' | 'unparseable';
  /** Where the answer text was read from. */
  source: 'content' | 'tool_call' | 'function_call' | 'none';
  rawLength: number;
};
export class InvalidModelOutputError extends Error {
  constructor(
    public readonly issues: string,
    public readonly rawSnippet: string,
    public readonly details?: InvalidOutputDetails,
  ) {
    super('Invalid model output');
  }
}
