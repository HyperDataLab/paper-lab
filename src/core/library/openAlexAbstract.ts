/** OpenAlex stores an abstract as word positions; this puts the words back in order. */
export function abstractFromIndex(index: unknown): string | null {
  if (typeof index !== 'object' || index === null) return null;
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === 'number' && Number.isSafeInteger(position) && position >= 0)
        words.set(position, word);
    }
  }
  const text = [...words.keys()]
    .sort((a, b) => a - b)
    .map((position) => words.get(position))
    .join(' ')
    .trim();
  return text || null;
}
