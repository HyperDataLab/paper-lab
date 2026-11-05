## Slice / PRD IDs

<!-- e.g. S2 · EV-01, AC-01, AC-11 -->

## What changed

## How it was verified

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test` (new tests named with PRD IDs)
- [ ] `npm run build`
- [ ] Checked in the browser (screens / notes below)

## Invariants (AGENTS.md)

- [ ] Offsets computed and validated, never taken from the LLM
- [ ] Source text untouched; revisions separate
- [ ] No secret in bundle / repo; AI calls gated on consent
- [ ] No new remote DB / server code
- [ ] UI follows DESIGN.md (non-color markers, a11y labels)

## Not verified / follow-ups
