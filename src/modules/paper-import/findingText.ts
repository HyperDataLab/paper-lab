/** Clean up display only; the stored reason and source offsets remain unchanged. */
export function displayReason(reason: string | null): string | null {
  return (
    reason
      ?.replace(
        /\s*[;.]?\s*(?:Bằng chứng|kết luận liên quan)\s*:\s*(?:(?:ev|cl)-[\w-]+(?:\s*,\s*|\s*;\s*(?:kết luận liên quan|Bằng chứng)\s*:\s*)?)+\s*[.;]?\s*$/iu,
        '',
      )
      .trim() ?? null
  );
}

const checkCopy = new Map([
  ['Trích dẫn và tài liệu tham khảo', 'Trích dẫn và references'],
  ['Trích dẫn chưa có tài liệu tham khảo tương ứng.', 'Trích dẫn chưa có references tương ứng.'],
  ['Tài liệu tham khảo chưa được trích dẫn.', 'Reference chưa được trích dẫn.'],
  [
    'Số liệu chưa được tìm thấy trong kết quả, thảo luận hoặc chú thích.',
    'Chưa tìm thấy số liệu trong results, discussion hoặc chú thích.',
  ],
  [
    'Mức khẳng định có thể mạnh hơn phần kết quả hoặc thảo luận.',
    'Mức khẳng định có thể mạnh hơn phần results hoặc discussion.',
  ],
]);

export const displayCheckText = (text: string) => checkCopy.get(text) ?? text;

export function displayQuote(text: string, start: number, end: number): string {
  const points = Array.from(text);
  let finish = end;
  if (points[finish - 1] === '-' && points[finish] === '\n') finish--;
  while (finish < points.length && /[\p{L}\p{N}]/u.test(points[finish] ?? '')) finish++;
  if (
    points[finish] === '-' &&
    /\s/u.test(points[finish + 1] ?? '') &&
    /[\p{L}]/u.test(points[finish + 2] ?? '')
  ) {
    finish += 2;
    while (finish < points.length && /[\p{L}\p{N}]/u.test(points[finish] ?? '')) finish++;
  }
  return points
    .slice(start, finish)
    .join('')
    .replace(/-\s*\n\s*/gu, '')
    .replace(/\s*\n\s*/gu, ' ');
}
