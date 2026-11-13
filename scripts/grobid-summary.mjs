// Prints a Markdown summary of a GROBID TEI file: header, structure and references. Used by the GROBID spike workflow.
import { readFileSync } from 'node:fs';

const tei = readFileSync(process.argv[2] ?? 'paper.tei.xml', 'utf8');
const count = (re) => (tei.match(re) ?? []).length;
const first = (re) => tei.match(re)?.[1]?.replace(/\s+/g, ' ').trim() ?? '—';
const header = tei.split('<text')[0] ?? '';
const body = tei.split('<body>')[1]?.split('</body>')[0] ?? '';
const back = tei.split('<back>')[1] ?? '';
const annex = back.split(/<div type="references">/)[0] ?? '';
const refs = tei.match(/<biblStruct [^>]*xml:id="b\d+"[\s\S]*?<\/biblStruct>/g) ?? [];
const withTitle = refs.filter((ref) => /<title [^>]*level="[am]"[^>]*>[^<]+</.test(ref)).length;
const withYear = refs.filter((ref) => /<date [^>]*when="\d{4}/.test(ref)).length;
const withAuthor = refs.filter((ref) => /<persName/.test(ref)).length;
const bibRefs = tei.match(/<ref type="bibr"[^>]*>/g) ?? [];
const linked = bibRefs.filter((ref) => /target="#b\d+"/.test(ref)).length;
const hyphenBreaks = count(/\w-\s+\w/g);

const rows = [
  ['Title', first(/<titleStmt>\s*<title[^>]*>([^<]*)</)],
  ['Authors in header', String((header.match(/<author>/g) ?? []).length)],
  ['DOI', header.match(/<idno type="DOI">([^<]*)</)?.[1] ?? '—'],
  ['arXiv id', header.match(/<idno type="arXiv">([^<]*)</)?.[1] ?? '—'],
  ['Date', first(/<date type="published" when="([^"]*)"/)],
  ['Body sections (head)', String((body.match(/<head/g) ?? []).length)],
  ['Body paragraphs', String((body.match(/<p[ >]/g) ?? []).length)],
  ['Body sentences', String((body.match(/<s[ >]/g) ?? []).length)],
  ['Annex sections (head)', String((annex.match(/<head/g) ?? []).length)],
  ['Annex paragraphs', String((annex.match(/<p[ >]/g) ?? []).length)],
  ['Figures / tables', `${count(/<figure(?![^>]*type="table")/g)} / ${count(/<figure[^>]*type="table"/g)}`],
  ['References', String(refs.length)],
  ['…with author / title / year', `${withAuthor} / ${withTitle} / ${withYear}`],
  ['In-text citations', String(bibRefs.length)],
  ['…linked to a reference', String(linked)],
  ['Hyphen + space sequences left in text', String(hyphenBreaks)],
];
console.log('\n| Field | Value |\n| --- | --- |');
for (const [field, value] of rows) console.log(`| ${field} | ${value.replace(/\|/g, '\\|')} |`);
