import { describe, expect, it } from 'vitest';
import { displayCheckText, displayQuote, displayReason } from './findingText';

describe('finding text for readers', () => {
  it('removes trailing internal evidence and claim IDs', () => {
    expect(displayReason('Nhận xét. Bằng chứng: ev-0055, ev-0056; kết luận liên quan: cl-7, cl-9')).toBe(
      'Nhận xét',
    );
  });
  it('uses the glossary for known check copy and preserves other text', () => {
    expect(displayCheckText('Trích dẫn và tài liệu tham khảo')).toBe('Trích dẫn và references');
    expect(displayCheckText('Tài liệu tham khảo chưa được trích dẫn.')).toBe(
      'Reference chưa được trích dẫn.',
    );
    expect(displayCheckText('Chưa có kết quả.')).toBe('Chưa có kết quả.');
  });
  it('joins words split at a line break and extends a partial word', () => {
    expect(displayQuote('AI-rewritten pa-\nper improves', 0, 16)).toBe('AI-rewritten paper');
    expect(displayQuote('A paragraph here', 0, 7)).toBe('A paragraph');
  });
});
