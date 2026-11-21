import { describe, expect, it } from 'vitest';
import { CONCEPTS } from './concepts';
import { describePage, matchPath, pagesForConcept, toJson } from './index';
import { PAGES } from './pages';

const conceptIds = new Set(CONCEPTS.map((concept) => concept.id));

describe('page map', () => {
  it('has unique ids and paths', () => {
    expect(new Set(PAGES.map((page) => page.id)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((page) => page.path)).size).toBe(PAGES.length);
  });

  it('refers only to concepts that exist', () => {
    const missing: string[] = [];
    for (const page of PAGES) {
      const refs = [
        ...page.shows,
        ...page.reads,
        ...page.writes,
        ...page.params.map((param) => param.concept),
        ...page.query.map((param) => param.concept),
        ...page.actions.flatMap((action) => action.writes ?? []),
      ];
      for (const ref of refs) if (!conceptIds.has(ref)) missing.push(`${page.id}: ${ref}`);
    }
    expect(missing).toEqual([]);
  });

  it('lists every concept an action writes among the page writes', () => {
    const stray = PAGES.flatMap((page) =>
      page.actions
        .flatMap((action) => action.writes ?? [])
        .filter((ref) => !page.writes.includes(ref))
        .map((ref) => `${page.id}: ${ref}`),
    );
    expect(stray).toEqual([]);
  });

  it('maps every path param to a concept, and only real params', () => {
    for (const page of PAGES) {
      const names = page.path
        .split('/')
        .filter((part) => part.startsWith(':'))
        .map((part) => part.slice(1));
      expect(page.params.map((param) => param.name).sort()).toEqual(names.sort());
    }
  });

  it('has parents that exist and non-empty Vietnamese text', () => {
    const ids = new Set(PAGES.map((page) => page.id));
    for (const page of PAGES) {
      if (page.parent) expect(ids).toContain(page.parent);
      expect(page.titleVi.trim()).not.toBe('');
      expect(page.purpose.trim()).not.toBe('');
      for (const action of page.actions) {
        expect(action.labelVi.trim()).not.toBe('');
        expect(action.effect.trim()).not.toBe('');
      }
      if (page.tabs) expect(new Set(page.tabs.map((tab) => tab.id)).size).toBe(page.tabs.length);
    }
  });
});

describe('matchPath and describePage', () => {
  it('matches concrete paths against patterns', () => {
    expect(matchPath('/corpus/:id', '/corpus/abc')).toBe(true);
    expect(matchPath('/corpus/:id', '/corpus')).toBe(false);
    expect(matchPath('/corpus/:id', '/corpus/abc/more')).toBe(false);
    expect(matchPath('/corpus/:id', '/corpus/')).toBe(false);
    expect(matchPath('/', '/')).toBe(true);
    expect(matchPath('/admin/requests', '/admin/requests/')).toBe(true);
  });

  it.each([
    ['/', 'home'],
    ['/papers', 'papers'],
    ['/papers/paper-1', 'paper'],
    ['/papers/paper-1?view=gap&pane=summary', 'paper'],
    ['/corpus', 'corpus'],
    ['/corpus/c-42', 'corpus-detail'],
    ['/extraction/p-7#top', 'extraction-project'],
    ['/report/a-1', 'report'],
    ['/compare?a=x&b=y', 'compare'],
    ['/extraction?design=topic', 'extraction'],
    ['/admin/requests', 'admin-requests'],
  ])('describes %s as %s', (route, id) => {
    expect(describePage(route)?.id).toBe(id);
  });

  it('describes by page id and by pattern', () => {
    expect(describePage('corpus-detail')?.path).toBe('/corpus/:id');
    expect(describePage('/corpus/:id')?.id).toBe('corpus-detail');
  });

  it('returns nothing for unknown routes', () => {
    expect(describePage('/nowhere')).toBeUndefined();
    expect(describePage('/papers/a/b')).toBeUndefined();
  });
});

describe('pagesForConcept', () => {
  it('finds pages that show, read or write a concept', () => {
    const ids = pagesForConcept('corpus-release').map((page) => page.id);
    expect(ids).toContain('corpus-detail');
    expect(pagesForConcept('kg-ingest-queue').map((page) => page.id)).toEqual(['corpus-detail', 'lab-kg']);
    expect(pagesForConcept('no-such-concept')).toEqual([]);
  });
});

describe('toJson', () => {
  it('exports the pages in page-map order as plain JSON', () => {
    const json = toJson();
    expect(json.version).toBe(2);
    expect(json.pages.map((page) => page.id)).toEqual(PAGES.map((page) => page.id));
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
