import { config } from 'zod';

// Zod otherwise probes `new Function` when a schema is defined. The hosting CSP forbids eval, so the probe only
// produced a console error on every load. Imported first because schemas are defined at import time.
config({ jitless: true });
