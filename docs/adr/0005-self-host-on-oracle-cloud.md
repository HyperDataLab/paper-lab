# 0005 Option: self-host everything on an Oracle Cloud Always Free VM

- Status: Proposed (2026-11-05). Becomes Accepted, superseding ADR-0001, once the owner's Oracle VM is running
  and passes the checks below.

## Context

The owner is registering an Oracle Cloud Always Free account (Ampere A1, up to 4 OCPU / 24 GB) and prefers to move
off Firebase if it works. One host for the SPA, the spaCy service and the 9router proxy removes the CORS Worker and
keeps the 9router key on the server instead of in the user's browser.

## Proposed design

- Ubuntu 24.04 aarch64, Docker Compose:
  - `caddy`: automatic HTTPS; serves `dist/` with SPA fallback and the same security headers as `firebase.json`;
    `/llm/*` -> 9router with `Authorization` added from a server-side env var; `/api/nlp/*` -> `nlp`.
  - `nlp`: FastAPI + spaCy (`en_core_web_sm` first), stateless, no storage.
- Storage stays local-first in the browser (ADR-0002 unchanged). No database on the VM.
- Domain via Cloudflare DNS (or Cloudflare Tunnel, which avoids opening ports); only 443 exposed; SSH key-only.
- CI builds `dist/` and deploys by rsync or a container image; `firebase.json` is kept until the switch is done.

## Acceptance checks before switching

HTTPS + headers verified, `/llm` works without a browser key, `/api/nlp/parse` p95 < 300 ms for a paragraph,
unattended security upgrades enabled, uptime check and a restart policy configured, Budget alert set if the
account is Pay As You Go.

## Consequences

The app code stays host-agnostic (relative `/llm` and `/api/nlp` URLs). The team takes on VM operations
(patching, certificates, monitoring) and loses Firebase's CDN. Always Free idle instances may be reclaimed.
