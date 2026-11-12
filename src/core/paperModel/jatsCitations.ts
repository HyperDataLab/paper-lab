/** Split numeric markers only when every cited reference exists. */
export function citationParts(text: string, referenceIds: ReadonlySet<string>) {
  const parts: { text: string; rids?: string[] }[] = [];
  const marker = /\[\s*\d+(?:\s*(?:,|[-–])\s*\d+)*\s*\]/gu;
  let offset = 0;
  for (const match of text.matchAll(marker)) {
    const raw = match[0];
    const ids: string[] = [];
    let valid = true;
    for (const item of raw.slice(1, -1).split(',')) {
      const range = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/u.exec(item);
      if (!range) {
        valid = false;
        break;
      }
      const start = Number(range[1]);
      const end = Number(range[2] ?? range[1]);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 1 ||
        end < start ||
        end - start >= referenceIds.size
      ) {
        valid = false;
        break;
      }
      for (let n = start; n <= end; n++) {
        const id = `ref${n}`;
        if (!referenceIds.has(id)) {
          valid = false;
          break;
        }
        if (!ids.includes(id)) ids.push(id);
      }
      if (!valid) break;
    }
    if (!valid) continue;
    parts.push({ text: text.slice(offset, match.index) }, { text: raw, rids: ids });
    offset = match.index + raw.length;
  }
  parts.push({ text: text.slice(offset) });
  return parts;
}
