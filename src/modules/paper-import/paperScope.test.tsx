import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { Paper } from '@/core/schemas';
import { RUN_DEFAULTS_KEY } from '@/shared/llm/runDefaults';
import { mainBodySections, usePaperScope, useRunBudget } from './paperScope';

const paper = {
  id: 'paper-scope-test',
  sections: [
    { id: 's1', heading: 'Introduction', role: 'introduction', level: 1 },
    { id: 's2', heading: 'Methods', role: 'methods', level: 1 },
    { id: 's3', heading: 'References', role: 'references', level: 1 },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 's1', kind: 'body' },
    { id: 'p2', sectionId: 's2', kind: 'body' },
    { id: 'p3', sectionId: 's3', kind: 'body' },
  ],
} as unknown as Paper;

beforeEach(() => localStorage.clear());

it('P1 one section scope per paper is shared by every analysis and survives a remount', () => {
  const first = renderHook(() => usePaperScope(paper, mainBodySections));
  const second = renderHook(() => usePaperScope(paper, () => ['s1', 's2', 's3']));
  // Until the reader chooses, each analysis keeps its own default.
  expect(first.result.current[0]).toEqual(['s1', 's2']);
  expect(second.result.current[0]).toEqual(['s1', 's2', 's3']);
  act(() => first.result.current[1](['s2']));
  expect(first.result.current[0]).toEqual(['s2']);
  expect(second.result.current[0]).toEqual(['s2']);
  first.unmount();
  expect(renderHook(() => usePaperScope(paper, mainBodySections)).result.current[0]).toEqual(['s2']);
});

it('P1 a stored scope drops section ids the paper no longer has', () => {
  localStorage.setItem(`pl.scope.${paper.id}`, JSON.stringify(['gone', 's1']));
  expect(renderHook(() => usePaperScope(paper, mainBodySections)).result.current[0]).toEqual(['s1']);
});

it('P1 the call ceiling follows the estimate until the reader types one, and clearing it restores the default', () => {
  const hook = renderHook(({ estimate }) => useRunBudget(estimate), { initialProps: { estimate: 20 } });
  expect(hook.result.current.budget).toBe(40);
  hook.rerender({ estimate: 30 });
  expect(hook.result.current.budget).toBe(60);
  act(() => hook.result.current.setBudget('7'));
  expect(hook.result.current.budget).toBe(7);
  act(() => hook.result.current.setBudget(''));
  expect(hook.result.current.budget).toBe(60);
});

it('P1 a fixed ceiling from Settings applies to every run', () => {
  localStorage.setItem(
    RUN_DEFAULTS_KEY,
    JSON.stringify({ mode: 'fixed', factor: 2, fixed: 300, probeParagraphs: 5 }),
  );
  expect(renderHook(() => useRunBudget(20)).result.current.budget).toBe(300);
});
