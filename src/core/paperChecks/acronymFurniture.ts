import type { PaperParagraph } from '../schemas';
import { matches, type Located } from './common';

const DEFINITION =
  /\b(?:[\p{L}][\p{L}-]*\s+){1,7}\(([A-Z]{2,8})(?:\s+['’]\d{2}|\s+\d{4}|-\d{2}|,\s*\d{4})?\)/gu;

export function definitions(paragraph: PaperParagraph): Located[] {
  return matches(paragraph, DEFINITION);
}

export function definitionName(definition: Located): string | undefined {
  return /\(([A-Z]{2,8})/u.exec(definition.text)?.[1];
}

export function furniture(paragraph: PaperParagraph): Located[] {
  return matches(
    paragraph,
    /(?:^|(?<=\n))[ \t]*(?:ACM Reference Format:[^\n]*(?:\n(?!\s*\n)[^\n]+)*|Permission to make digital or hard copies[^\n]*(?:\n(?!\s*\n)[^\n]+)*|©\s*\d{4}[^\n]*|https?:\/\/(?:dx\.)?doi\.org\/[^\s]+[^\n]*|(?:CCS Concepts|Keywords)\s*[:;•][^\n]*|[A-Z]{2,8}\s+['’]\d{2},\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*[-–—]\s*\d{1,2})?,\s*\d{4},\s*[^,\n]+,\s*[^,\n]+)[^\n]*/gimu,
  );
}
