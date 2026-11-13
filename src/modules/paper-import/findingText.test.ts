import { describe, expect, it } from 'vitest';
import { displayQuote, displayReason } from './findingText';

describe('finding text for readers', () => {
  it('removes trailing internal evidence and claim IDs', () => {
    expect(displayReason('Nhận xét. Bằng chứng: ev-0055, ev-0056; kết luận liên quan: cl-7, cl-9')).toBe(
      'Nhận xét',
    );
  });
  it('joins words split at a line break and extends a partial word', () => {
    expect(displayQuote('AI-rewritten pa-\nper improves', 0, 16)).toBe('AI-rewritten paper');
    expect(displayQuote('A paragraph here', 0, 7)).toBe('A paragraph');
  });
});
