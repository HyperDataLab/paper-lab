export class PaperSizeError extends Error {
  override name = 'PaperSizeError';
}
export function guardPaperSize(bytes: number, pages?: number) {
  if (bytes > 25 * 1024 * 1024) throw new PaperSizeError('Tệp vượt quá giới hạn 25 MB.');
  if (pages !== undefined && pages > 200) throw new PaperSizeError('Tệp vượt quá giới hạn 200 trang.');
}
