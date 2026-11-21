import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const { runJournalCorpora } = await server.ssrLoadModule('/scripts/seed/journalCorpora.ts');
  await runJournalCorpora(process.argv.slice(2));
} finally {
  await server.close();
}
