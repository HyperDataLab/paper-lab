import { normalizeDoi } from '../library/doi';
import { GROBID_VERSION, type GrobidPerson, type GrobidResult } from '../schemas/grobid';

// GROBID writes arXiv ids as "arXiv:2101.00001v2[cs.CL]" or old-style "hep-th/9901001"; only the id is kept.
const ARXIV_ID = /(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/iu;

const content = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/gu, ' ').trim() || null;
const first = (root: Element | Document, selector: string) => root.querySelector(selector);
const splitPerson = (person: Element): GrobidPerson[] => {
  const parts = [...person.querySelectorAll('forename, surname')];
  const people: GrobidPerson[] = [];
  let current: GrobidPerson = { forename: '', surname: '' };
  for (const part of parts) {
    const name = content(part);
    if (!name) continue;
    if (
      (part.localName === 'surname' && current.surname) ||
      (part.localName === 'forename' && part.getAttribute('type') === 'first' && current.forename)
    ) {
      people.push(current);
      current = { forename: '', surname: '' };
    }
    if (part.localName === 'surname') current.surname = name;
    else current.forename = [current.forename, name].filter(Boolean).join(' ');
  }
  if (current.forename || current.surname) people.push(current);
  return people;
};
const people = (root: Element): GrobidPerson[] =>
  [...root.querySelectorAll('author persName, author orgName')].flatMap((person) =>
    person.localName === 'orgName'
      ? content(person)
        ? [{ forename: '', surname: content(person) ?? '' }]
        : []
      : splitPerson(person),
  );
const identifier = (root: Element, type: string) => {
  const node = [...root.querySelectorAll('idno')].find(
    (item) => item.getAttribute('type')?.toLowerCase() === type,
  );
  const value = content(node);
  if (!value) return null;
  return type === 'doi' ? normalizeDoi(value) : (ARXIV_ID.exec(value)?.[1] ?? null);
};
const dateOf = (root: Element) => {
  const date = first(root, 'date');
  return date?.getAttribute('when') || content(date);
};

export function parseGrobidTei(xml: string): GrobidResult {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'TEI')
    throw new Error('Invalid TEI XML');
  const header = first(document, 'teiHeader');
  const source = header && (first(header, 'sourceDesc biblStruct') ?? header);
  const arxivId = source ? identifier(source, 'arxiv') : null;
  const doi = source ? identifier(source, 'doi') : null;
  const references: GrobidResult['references'] = [
    ...document.querySelectorAll('listBibl biblStruct'),
  ].flatMap((item) => {
    const id =
      item.getAttribute('xml:id') || item.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
    if (!id) return [];
    const date = dateOf(item);
    const yearMatch = date?.match(/\b(?:19|20)\d{2}\b/u);
    return [
      {
        id,
        authors: people(item),
        title: content(first(item, 'analytic title')) ?? content(first(item, 'monogr title')),
        venue: content(first(item, 'analytic') ? first(item, 'monogr title') : null),
        year: yearMatch ? Number(yearMatch[0]) : null,
        doi: identifier(item, 'doi'),
        arxivId: identifier(item, 'arxiv'),
        rawText: content(first(item, 'note[type="raw_reference"]')),
      },
    ];
  });
  const citations: GrobidResult['citations'] = [
    ...document.querySelectorAll('text ref[type="bibr"]'),
  ].flatMap((ref) => {
    const targets = (ref.getAttribute('target') ?? '')
      .trim()
      .split(/\s+/u)
      .filter((target) => target.startsWith('#'));
    const sentence = ref.closest('s');
    const coords = ref.getAttribute('coords') ?? sentence?.getAttribute('coords');
    const pageNumber = Number(coords?.split(',')[0]);
    return (targets.length ? targets : [null]).map((target) => ({
      referenceId: target?.slice(1) || null,
      text: content(ref) ?? '',
      sentence: content(sentence) ?? '',
      page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null,
    }));
  });
  return {
    version: GROBID_VERSION,
    header: {
      title: header
        ? (content(first(header, 'titleStmt title')) ??
          (source ? content(first(source, 'analytic title')) : null))
        : null,
      authors: source ? people(source) : [],
      date: source ? dateOf(source) : null,
      arxivId,
      doi: doi ?? (arxivId ? normalizeDoi(`10.48550/arXiv.${arxivId.replace(/v\d+$/iu, '')}`) : null),
    },
    references,
    citations,
  };
}
