import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { usePaperNavigation } from './usePaperNavigation';

/** The hook beside the address it writes to, on a page opened at `url`. */
function setup(url = '/papers/p1') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const [query] = useSearchParams();
      return { nav: usePaperNavigation(), query };
    },
    { wrapper },
  );
}

describe('usePaperNavigation', () => {
  it('opens on the full text and the Issues tab without a view, or with an unknown one', () => {
    for (const url of ['/papers/p1', '/papers/p1?view=nothing-like-this']) {
      const { result } = setup(url);
      expect(result.current.nav.tab).toBe('issues');
      expect(result.current.nav.mode).toBe('issues');
      expect(result.current.nav.pane).toBe('fulltext');
      expect(result.current.nav.focus).toBe('centre');
      expect(result.current.nav.inSpace).toBe(false);
      expect(result.current.nav.openBlocks).toEqual([]);
    }
  });

  it('lands on the view in the address, with its block open', () => {
    const { result } = setup('/papers/p1?view=aif');
    expect(result.current.nav.tab).toBe('aif');
    expect(result.current.nav.mode).toBe('arguments');
    expect(result.current.nav.focus).toBe('right');
    expect(result.current.nav.openBlocks).toEqual(['arguments']);
    expect(result.current.nav.viewOf('arguments')).toBe('aif');
  });

  it('opens a space at its default view with its free parts open, and records it in the address', () => {
    const { result } = setup();
    act(() => result.current.nav.openSpace('arguments'));
    expect(result.current.nav.mode).toBe('arguments');
    expect(result.current.nav.inSpace).toBe(true);
    expect(result.current.nav.tab).toBe('gap');
    expect(result.current.nav.openBlocks).toEqual(expect.arrayContaining(['gap', 'mainClaims', 'atomics']));
    expect(result.current.query.get('view')).toBe('gap');

    act(() => result.current.nav.openSpace('writing'));
    expect(result.current.nav.tab).toBe('organization');
    expect(result.current.nav.openBlocks).toContain('vocabulary');
    expect(result.current.query.get('view')).toBe('organization');
  });

  it('opens a view inside a space', () => {
    const { result } = setup();
    act(() => result.current.nav.openSpace('arguments'));
    act(() => result.current.nav.setTab('aif'));
    expect(result.current.nav.tab).toBe('aif');
    expect(result.current.nav.viewOf('arguments')).toBe('aif');
    expect(result.current.nav.openBlocks).toContain('arguments');
    expect(result.current.query.get('view')).toBe('aif');

    act(() => result.current.nav.setTab('organization'));
    act(() => result.current.nav.openSpace('arguments'));
    // The space's first block is Issues; its view was never changed, so the space opens on its default.
    expect(result.current.nav.tab).toBe('gap');
  });

  it('leaves a space for the right-column tab the reader came from', () => {
    const { result } = setup();
    act(() => result.current.nav.openMode('citations'));
    expect(result.current.nav.tab).toBe('context-references');
    act(() => result.current.nav.openSpace('writing'));
    act(() => result.current.nav.leaveSpace());
    expect(result.current.nav.mode).toBe('citations');
    expect(result.current.nav.tab).toBe('context-references');
    expect(result.current.nav.inSpace).toBe(false);
  });

  it('shows the summary pane and records it in the address', () => {
    const { result } = setup();
    act(() => result.current.nav.setTab('profile'));
    expect(result.current.nav.pane).toBe('summary');
    expect(result.current.nav.focus).toBe('centre');
    expect(result.current.query.get('view')).toBe('profile');
    expect(result.current.query.get('pane')).toBe('summary');
  });

  it('offers a way back to the space a source was opened from, and ends it on going elsewhere', () => {
    const { result } = setup();
    act(() => result.current.nav.openSpace('arguments'));
    act(() => result.current.nav.enterReader());
    expect(result.current.nav.pane).toBe('fulltext');
    expect(result.current.nav.inSpace).toBe(false);
    expect(result.current.nav.tab).toBe('issues');
    expect(result.current.nav.returnTo).toMatchObject({ view: 'gap', label: 'Arguments' });
    expect(result.current.query.get('view')).toBe('map');

    act(() => result.current.nav.goBack());
    expect(result.current.nav.tab).toBe('gap');
    expect(result.current.nav.inSpace).toBe(true);
    expect(result.current.nav.returnTo).toBeNull();
  });

  it('offers a way back to the summary a source was opened from', () => {
    const { result } = setup();
    act(() => result.current.nav.setTab('profile'));
    act(() => result.current.nav.showFulltext());
    expect(result.current.nav.pane).toBe('fulltext');
    expect(result.current.nav.returnTo).toMatchObject({ view: 'profile', label: 'Summary' });
    act(() => result.current.nav.setTab('context-references'));
    expect(result.current.nav.returnTo).toBeNull();
  });
});
