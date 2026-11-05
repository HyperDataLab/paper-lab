# 0002 Local-first storage, no remote database in MVP

- Status: Accepted (2026-11-05)

## Context

The owner asked to minimise database use. Paragraph analyses are small, personal and often unpublished text.

## Decision

Store analyses, revisions and the audit log in IndexedDB (Dexie) behind `shared/storage` repositories.
Portability is through versioned JSON export / import validated by the Zod schemas. No Firebase Auth, no Firestore.

## Consequences

- Data stays on one device unless the user exports it; the UI says so in History and Settings.
- Clearing site data deletes everything; History offers export reminders.
- A future sync layer (e.g. Firestore for confirmed annotations / calibration sets) must be a new ADR and must keep
  the repository interface unchanged.
