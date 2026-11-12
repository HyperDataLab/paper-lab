import type { PaperModel, PaperModelSection } from '../schemas';
import { citationParts } from './jatsCitations';

// XML 1.0 permits tabs and newlines, but not isolated surrogates or other controls.
function escapeXml(value: string): string {
  return Array.from(value, (char) => {
    const cp = char.codePointAt(0) ?? 0;
    if (!(
      cp === 9 ||
      cp === 10 ||
      cp === 13 ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      (cp >= 0x10000 && cp <= 0x10ffff)
    ))
      return '';
    return char
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }).join('');
}

const element = (tag: string, value: string | null) => (value ? `<${tag}>${escapeXml(value)}</${tag}>` : '');
const roles: Partial<Record<PaperModelSection['role'], string>> = {
  introduction: 'intro',
  methods: 'methods',
  results: 'results',
  discussion: 'discussion',
  conclusion: 'conclusions',
};

export function paperModelToJats(model: PaperModel, options?: { sentences?: boolean }): string {
  const { metadata: m, sections, blocks, references } = model.document;
  const refs = new Set(references.map((ref) => ref.id));
  const text = (value: string) =>
    citationParts(value, refs)
      .map((part) =>
        part.rids
          ? `<xref ref-type="bibr" rid="${part.rids.join(' ')}">${escapeXml(part.text)}</xref>`
          : escapeXml(part.text),
      )
      .join('');
  function blockText(block: (typeof blocks)[number]): string {
    if (!options?.sentences) return text(block.text);
    const chars = Array.from(block.text);
    const sentences = model.sentences
      .filter((s) => s.paragraphId === block.id)
      .slice()
      .sort((a, b) => a.start - b.start);
    let offset = 0;
    let result = '';
    for (const sentence of sentences) {
      if (
        sentence.start < offset ||
        sentence.end <= sentence.start ||
        sentence.end > chars.length ||
        chars.slice(sentence.start, sentence.end).join('') !== sentence.text
      )
        continue;
      result += text(chars.slice(offset, sentence.start).join(''));
      let content = text(sentence.text);
      const labels = model.annotations.filter((a) => a.key === sentence.key && a.state !== 'rejected');
      for (const label of labels.slice().reverse())
        content = `<named-content vocab="${escapeXml(label.scheme)}" vocab-term="${escapeXml(label.label)}">${content}</named-content>`;
      // The content key is stable and its punctuation is encoded into an XML-safe ID.
      const id = `s-${sentence.key.replace('#', '-')}`;
      result += `<named-content content-type="sentence" id="${escapeXml(id)}">${content}</named-content>`;
      offset = sentence.end;
    }
    return result + text(chars.slice(offset).join(''));
  }
  function blockXml(block: (typeof blocks)[number]): string {
    const value = blockText(block);
    switch (block.kind) {
      case 'list':
        return `<list><list-item><p>${value}</p></list-item></list>`;
      case 'equation':
        return `<disp-formula>${value}</disp-formula>`;
      case 'table':
        return `<table-wrap><p>${value}</p></table-wrap>`;
      case 'caption':
      case 'footnote':
        return `<p content-type="${block.kind}">${value}</p>`;
      case 'reference':
        return '';
      default:
        return `<p>${value}</p>`;
    }
  }
  function sectionXml(section: PaperModelSection, ancestors: ReadonlySet<string>): string {
    if (section.role === 'abstract' || section.role === 'references' || ancestors.has(section.id)) return '';
    const next = new Set(ancestors).add(section.id);
    const type = roles[section.role];
    return `<sec${type ? ` sec-type="${type}"` : ''}>${element('title', section.title)}${blocks
      .filter((b) => b.sectionId === section.id)
      .map(blockXml)
      .join('')}${sections
      .filter((s) => s.parentId === section.id)
      .map((s) => sectionXml(s, next))
      .join('')}</sec>`;
  }
  const pages = m.pages?.match(/^\s*([^\s\-–—]+)\s*[-–—]\s*([^\s\-–—]+)\s*$/u);
  const journal = m.venue
    ? `<journal-meta><journal-title-group>${element('journal-title', m.venue)}</journal-title-group></journal-meta>`
    : '';
  const meta = `${m.doi ? `<article-id pub-id-type="doi">${escapeXml(m.doi)}</article-id>` : ''}<title-group><article-title>${escapeXml(m.title)}</article-title></title-group>${m.authors.length ? `<contrib-group>${m.authors.map((a) => `<contrib contrib-type="author"><string-name>${escapeXml(a)}</string-name></contrib>`).join('')}</contrib-group>` : ''}${m.affiliations.map((a) => element('aff', a)).join('')}${m.year !== null ? `<pub-date><year>${m.year}</year></pub-date>` : ''}${element('volume', m.volume)}${element('issue', m.issue)}${pages ? element('fpage', pages[1] ?? '') + element('lpage', pages[2] ?? '') : ''}${
    m.abstract
      ? `<abstract>${m.abstract
          .split(/\r?\n\s*\r?\n/u)
          .map((p) => `<p>${escapeXml(p)}</p>`)
          .join('')}</abstract>`
      : ''
  }${m.keywords.length ? `<kwd-group>${m.keywords.map((k) => element('kwd', k)).join('')}</kwd-group>` : ''}`;
  const body = sections
    .filter((s) => s.parentId === null)
    .map((s) => sectionXml(s, new Set()))
    .join('');
  const back = references.length
    ? `<back><ref-list>${references.map((ref) => `<ref id="${escapeXml(ref.id)}"><mixed-citation>${escapeXml(ref.text)}${ref.doi ? ` <pub-id pub-id-type="doi">${escapeXml(ref.doi)}</pub-id>` : ''}</mixed-citation></ref>`).join('')}</ref-list></back>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.4 20241031//EN" "JATS-archivearticle1-4-mathml3.dtd">\n<article article-type="research-article" dtd-version="1.4"><front>${journal}<article-meta>${meta}</article-meta></front><body>${body}</body>${back}</article>`;
}
