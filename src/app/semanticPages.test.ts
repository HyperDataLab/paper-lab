import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describePage, PAGES } from '@/core/semantic';
import { modules } from './modules';

// The shell's routes: one per registered module, plus the literal <Route path="…"> entries in App.tsx.
const appSource = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
const extraRoutes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/gu)]
  .map((match) => match[1] ?? '')
  .filter((path) => path !== '*');
// Every route sits inside the shell's StorageProvider, which shows the ResearchHub project or SSO card
// instead of the page until both are present. A route outside it, or a LabDataGate exemption, would be ungated.
const storageBlock = /<StorageProvider[\s\S]*?<\/StorageProvider>/u.exec(appSource)?.[0] ?? '';
const routesInsideGate = [...storageBlock.matchAll(/<Route\s+(?:key=\{[^}]+\}\s+)?path=/gu)].length;
const routeCount = [...appSource.matchAll(/<Route\s+(?:key=\{[^}]+\}\s+)?path=/gu)].length;
const routed = [...modules.map((item) => item.path), ...extraRoutes];

describe('C4 page map against the route and module registry', () => {
  it('finds the extra routes in App.tsx, all behind the StorageProvider gate', () => {
    expect(extraRoutes.length).toBeGreaterThan(0);
    expect(routeCount).toBeGreaterThan(extraRoutes.length);
    expect(routesInsideGate).toBe(routeCount);
    expect(appSource).not.toMatch(/item\.id === '/u);
  });

  it('has a page for every routed path, and routes every page', () => {
    const paths = PAGES.map((page) => page.path);
    expect(routed.filter((path) => !paths.includes(path))).toEqual([]);
    expect(paths.filter((path) => !routed.includes(path))).toEqual([]);
    expect(PAGES).toHaveLength(routed.length);
  });

  it('matches the module registry: path, owning module folder and sign-in gate', () => {
    for (const item of modules) {
      const page = describePage(item.path);
      expect(page?.path).toBe(item.path);
      expect(page?.requiresSignIn, item.id).toBe(true);
    }
    for (const path of extraRoutes) expect(describePage(path)?.requiresSignIn, path).toBe(true);
    for (const page of PAGES)
      expect(existsSync(join(process.cwd(), 'src/modules', page.module)), page.id).toBe(true);
  });
});
