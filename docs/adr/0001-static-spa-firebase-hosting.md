# 0001 Static SPA on Firebase Hosting

- Status: Accepted (2026-11-05)

## Context
The owner wants Firebase for deployment on the free Spark plan. Spark has no Cloud Functions.

## Decision
Ship a static Vite build to Firebase Hosting (`dist/`, SPA rewrite to `/index.html`). No server code anywhere.
Security headers (CSP allowing only self + the 9router/Worker origin, `X-Content-Type-Options`, `Referrer-Policy`)
are set in `firebase.json`.

## Consequences
All processing runs in the browser. Anything needing a secret or a server is out of scope unless a new ADR changes this.
