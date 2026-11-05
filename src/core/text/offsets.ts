export const OFFSET_UNIT = 'unicode_codepoint' as const;
export class OffsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffsetError';
  }
}
export interface Span {
  start: number;
  end: number;
}
export function createOffsetIndex(text: string) {
  const positions = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    positions.push(offset);
  }
  function cpToUtf16(cp: number): number {
    if (!Number.isInteger(cp) || cp < 0 || cp >= positions.length)
      throw new OffsetError('Code point offset out of range');
    return positions[cp] as number;
  }
  function utf16ToCp(u16: number): number {
    if (!Number.isInteger(u16) || u16 < 0 || u16 > text.length)
      throw new OffsetError('UTF-16 offset out of range');
    let low = 0,
      high = positions.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const value = positions[middle] as number;
      if (value === u16) return middle;
      if (value < u16) low = middle + 1;
      else high = middle - 1;
    }
    throw new OffsetError('UTF-16 offset splits a surrogate pair');
  }
  function toUtf16Span(span: Span): Span {
    if (span.start > span.end) throw new OffsetError('Invalid span');
    return { start: cpToUtf16(span.start), end: cpToUtf16(span.end) };
  }
  function sliceCp(start: number, end: number): string {
    const span = toUtf16Span({ start, end });
    return text.slice(span.start, span.end);
  }
  return { cpToUtf16, utf16ToCp, toUtf16Span, sliceCp, length: positions.length - 1 };
}
export const codePointLength = (text: string) => createOffsetIndex(text).length;
export const cpToUtf16 = (text: string, cp: number) => createOffsetIndex(text).cpToUtf16(cp);
export const utf16ToCp = (text: string, u16: number) => createOffsetIndex(text).utf16ToCp(u16);
export const sliceCp = (text: string, start: number, end: number) =>
  createOffsetIndex(text).sliceCp(start, end);
export const toUtf16Span = (text: string, span: Span) => createOffsetIndex(text).toUtf16Span(span);
