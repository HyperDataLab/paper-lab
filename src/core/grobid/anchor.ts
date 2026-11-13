import { matches, type Located } from '../paperChecks/common';
import type { PaperParagraph } from '../schemas';

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const pattern = (needle: string) => {
  const words = needle.trim().split(/\s+/u).filter(Boolean);
  // GROBID and PDF.js space text differently, so any run of spaces (or none) between words matches.
  return words.length ? new RegExp(words.map(escape).join('\\s*'), 'gu') : null;
};

/**
 * Where GROBID's text sits in the PDF.js text, in code points. Only a single match counts: text that is
 * missing or appears twice is not placed, so no location is ever guessed.
 */
export function anchorText(paragraphs: PaperParagraph[], needle: string): Located | null {
  const regex = pattern(needle);
  if (!regex) return null;
  const found = paragraphs.flatMap((paragraph) => matches(paragraph, regex));
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** A citation marker inside its sentence: the sentence is placed first, then the marker within it. */
export function anchorCitation(
  paragraphs: PaperParagraph[],
  citation: { text: string; sentence: string },
): Located | null {
  const sentence = citation.sentence ? anchorText(paragraphs, citation.sentence) : null;
  const regex = pattern(citation.text);
  if (sentence && regex)
    return (
      matches(sentence.paragraph, regex).find(
        (item) => item.start >= sentence.start && item.end <= sentence.end,
      ) ?? null
    );
  return anchorText(paragraphs, citation.text);
}
