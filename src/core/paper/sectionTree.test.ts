import { expect, it } from 'vitest';
import type { Section } from '../schemas/paper';
import { buildSectionTree, subtreeIds } from './sectionTree';

const section = (id: string, level: number): Section => ({
  id,
  heading: id,
  role: 'other',
  level,
  pageStart: null,
});

it('nests sections by level in document order', () => {
  const tree = buildSectionTree([
    section('a', 1),
    section('a1', 2),
    section('a11', 3),
    section('a2', 2),
    section('b', 1),
  ]);
  expect(tree.map((node) => node.section.id)).toEqual(['a', 'b']);
  expect(tree[0]?.children.map((node) => node.section.id)).toEqual(['a1', 'a2']);
  expect(tree[0]?.children[0]?.children.map((node) => node.section.id)).toEqual(['a11']);
  expect(subtreeIds(tree[0] as NonNullable<(typeof tree)[0]>)).toEqual(['a', 'a1', 'a11', 'a2']);
});

it('keeps a section that skips a level under the nearest shallower one', () => {
  const tree = buildSectionTree([section('a', 1), section('deep', 3), section('next', 2)]);
  expect(tree[0]?.children.map((node) => node.section.id)).toEqual(['deep', 'next']);
});

it('treats a first section that is not top level as a root', () => {
  expect(buildSectionTree([section('x', 2), section('y', 1)]).map((node) => node.section.id)).toEqual([
    'x',
    'y',
  ]);
  expect(buildSectionTree([])).toEqual([]);
});
