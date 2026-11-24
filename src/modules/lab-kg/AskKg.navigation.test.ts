import { expect, it } from 'vitest';
import { paperSourceHref } from './paperSourceHref';

it('opens full-text evidence at its paragraph while keeping analysis evidence at the reader', () => {
  expect(
    paperSourceHref({
      id: 'paper:paper-1:paragraph 2',
      title: 'A research paper',
      kind: 'Toàn văn',
      locator: 'Introduction · tr. 2',
      text: 'A cited source excerpt with enough words to be used as evidence.',
      paperId: 'paper-1',
    }),
  ).toBe('/papers/paper-1?p=paragraph+2');

  expect(
    paperSourceHref({
      id: 'analysis:paper-1:summary',
      title: 'A research paper',
      kind: 'Phân tích đã lưu',
      locator: 'Overview',
      text: 'A saved analysis excerpt with enough words to be used as evidence.',
      paperId: 'paper-1',
    }),
  ).toBe('/papers/paper-1');
});

it('leaves project evidence without a paper link unlinked', () => {
  expect(
    paperSourceHref({
      id: 'design:project-1:topic',
      title: 'Research design',
      kind: 'Thiết kế nghiên cứu',
      locator: 'Research questions',
      text: 'A project design excerpt with enough words to be used as evidence.',
    }),
  ).toBeUndefined();
});
