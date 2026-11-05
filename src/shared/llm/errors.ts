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
export class InvalidModelOutputError extends Error {
  constructor(
    public readonly issues: string,
    public readonly rawSnippet: string,
  ) {
    super('Invalid model output');
  }
}
