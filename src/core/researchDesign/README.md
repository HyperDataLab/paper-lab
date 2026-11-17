# Research Design core

M2 maps project papers to `papers.ts`, using PaperLab project paper keys as ids, and adapts suggestion requests to the consent-gated LLM client.

Callers must keep these handoff invariants:

- Use `draftToPlan` and `validatePlan` as the single gate for both display and freeze. Storage must refuse to change or overwrite a frozen version or reuse its number; the repository records who and when. Keep the draft as the working copy, refuse unchanged content, and require a deviation note from version 2.
- Serialize package files once and hash the exact bytes stored. Never reuse draft ids or delete referenced items; default new fields so older documents parse.
- Keep optional plan context references valid; do not put suggestions or bank matches in the plan.
- Verify a bank snapshot's raw content hash before storing it under its release. Read from the stored snapshot, keep release references, follow bounded aliases on re-pin, and flag stale references rather than silently repairing them.
- Keep facts read-only, record only project decisions, and refuse use without a resolved anchor. Use the same content ETag function for the local facts provider and held model; record who makes decisions and matches.
- Match only exact normalized names or aliases and store matches only after confirmation. Send only facts marked for use in suggestions, filter citations to those sent, and add suggestions to drafts only by human action.
- Generate contracts from schemas; keep fixtures synthetic. Preserve versioned prompts and obtain privacy consent before model calls.
