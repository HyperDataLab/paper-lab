import { expect, it } from 'vitest';
import { groupHistory } from './groupHistory';

const item = (id: string, title: string | null, paperId: string | null = null) => ({
  id,
  title,
  preview: `preview ${id}`,
  paperId,
});

it('nests paper paragraphs by section and never shows the internal id', () => {
  const [group] = groupHistory(
    [
      item('a', 'Results · sec8_p04', 'p1'),
      item('b', 'Results · sec8_p03', 'p1'),
      item('c', 'Intro · sec2_p01', 'p1'),
    ],
    new Map([['p1', 'Paper one']]),
  );
  expect(group?.title).toBe('Paper one');
  expect(group?.count).toBe(3);
  expect(group?.sections.map((section) => section.heading)).toEqual(['Results', 'Intro']);
  expect(group?.sections[0]?.entries.map((entry) => entry.label)).toEqual(['Đoạn 4', 'Đoạn 3']);
  expect(JSON.stringify(group?.sections[0]?.entries.map((entry) => entry.fullLabel))).not.toContain('sec8');
});

it('keeps pasted paragraphs together and falls back to their preview', () => {
  const groups = groupHistory([item('a', null), item('b', 'My draft')], new Map());
  expect(groups).toHaveLength(1);
  expect(groups[0]?.title).toBe('Đoạn nhập trực tiếp');
  expect(groups[0]?.sections[0]?.entries.map((entry) => entry.label)).toEqual(['preview a', 'My draft']);
});

it('names a paper that no longer exists rather than dropping its paragraphs', () => {
  const [group] = groupHistory([item('a', 'Results · sec8_p01', 'gone')], new Map());
  expect(group?.title).toBe('Bài báo đã xoá');
});
