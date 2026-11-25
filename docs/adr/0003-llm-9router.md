# 0003 LLM through owner-supplied 9router

- Status: Accepted (2026-11-05)

## Context

The owner provides a 9router endpoint (OpenAI-compatible chat completions). The sibling project
paper-understanding already uses it and found that 9router ignores `response_format` and rejects the
browser's unauthenticated CORS preflight.

## Decision

- Client in `shared/llm`: send the JSON schema both in `response_format` and in the prompt; validate with Zod;
  one repair round on failure; typed errors.
- Dev: Vite proxy `/llm` -> `LLM_PROXY_TARGET`, adding `Authorization: Bearer $LLM_PROXY_API_KEY` server-side.
- Production project scope: configured 9router hosts are relayed through the authenticated Writing Lab Worker at
  `/v1/llm/chat/completions`. It allows the PaperLab origin, validates the ResearchHub session and project, and
  forwards the user-entered key in a header without logging it. Lab scope continues through the PaperLab Worker.
- Model from `VITE_LLM_MODEL`, overridable in Settings. Prompt/model versions stored on every analysis.
- Every call is gated on recorded privacy consent (version + provider).

## Consequences

The key never ships in the bundle. Tests mock the client; `npm run check:router-cors` verifies preflight.
