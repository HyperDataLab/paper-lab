/** The browser's clientWidth already excludes a vertical scrollbar; subtract only actual inline padding. */
export function fitPdfScale(clientWidth: number, pageWidth: number, paddingInline = 0) {
  if (pageWidth <= 0) return 1;
  return Math.max(0.3, (clientWidth - paddingInline) / pageWidth);
}
