const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;
const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"',;<>]+/gu;
export const MAX_DOIS_PER_ADD = 500;

function trimDoi(value: string) {
  let doi = value.replace(/[.,;:]+$/u, '');
  // A closing bracket belongs to the DOI only when it opens one too, as in 10.1016/S0140(20)30001-1.
  while (/[)\]]$/u.test(doi)) {
    const open = doi.endsWith(')') ? '(' : '[';
    const close = doi.slice(-1);
    if (doi.split(open).length >= doi.split(close).length) break;
    doi = doi.slice(0, -1).replace(/[.,;:]+$/u, '');
  }
  return doi;
}

export function normalizeDoi(value: string): string | null {
  const stripped = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/iu, '')
    .trim();
  const doi = trimDoi(stripped).toLowerCase();
  return DOI_SHAPE.test(doi) ? doi : null;
}

export interface ParsedDois {
  dois: string[];
  /** Lines that held no DOI, so the user can see what was skipped. */
  unmatched: string[];
}

/** Reads DOIs from pasted lines, DOI links, free text or CSV. A column header is not an error. */
export function parseDoiInput(text: string): ParsedDois {
  const found = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    // A line that is only a DOI may hold characters that split free text, as older Wiley DOIs do.
    const whole = /\s/u.test(line) || line.includes(',') ? null : normalizeDoi(line);
    const matches = whole ? [whole] : (line.match(DOI_IN_TEXT) ?? []);
    const dois = matches.flatMap((match) => normalizeDoi(match) ?? []);
    if (dois.length) dois.forEach((doi) => found.add(doi));
    else if (!/(?:^|[,;\t"])\s*"?doi"?\s*(?:$|[,;\t"])/iu.test(line)) unmatched.push(line);
  }
  return { dois: [...found], unmatched };
}
