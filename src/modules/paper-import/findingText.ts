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
