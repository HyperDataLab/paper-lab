import type { Argument, ArgumentRun, Paper, PaperModelSentence } from '../schemas';
import { sliceCp } from '../text';
import type { KgBuilder } from './build';
import { kgIri, type KgPredicate } from './types';

export function addArguments(
  graph: KgBuilder,
  article: string,
  paper: Paper,
  run: ArgumentRun,
  sentences: PaperModelSentence[],
) {
  const paragraphs = new Map(paper.paragraphs.map((paragraph) => [paragraph.id, paragraph.text]));
  const byParagraph = new Map<string, PaperModelSentence[]>();
  for (const sentence of sentences) {
    const group = byParagraph.get(sentence.paragraphId);
    if (group) group.push(sentence);
    else byParagraph.set(sentence.paragraphId, [sentence]);
  }
  function anchor(span: Argument['claim']) {
    const text = paragraphs.get(span.paragraphId);
    if (!text || !span.excerpt || sliceCp(text, span.start, span.end) !== span.excerpt) return null;
    return (byParagraph.get(span.paragraphId) ?? [])
      .filter((sentence) => sentence.start < span.end && span.start < sentence.end)
      .map((sentence) => sentence.key);
  }
  const link = (s: string, p: KgPredicate, o: string, evidence: string[]) =>
    graph.edge({ s, p, o, layer: 'normative', provenance: 'llm_candidate', evidence });
  for (const argument of run.arguments) {
    const keys = anchor(argument.claim);
    if (!keys) continue;
    const claim = graph.node({
      id: kgIri('claim', paper.id, run.id, argument.id),
      type: 'Claim',
      label: argument.claim.excerpt,
      layer: 'normative',
      attrs:
        argument.evidenceLevel && argument.evidenceBasis ? { evidenceBasis: argument.evidenceBasis } : {},
    });
    link(article, 'hasClaim', claim, keys);
    for (const span of [...argument.data, ...argument.backing]) {
      const evidenceKeys = anchor(span);
      if (!evidenceKeys) continue;
      const evidence = graph.node({
        id: kgIri('evidence', paper.id, span.paragraphId, String(span.start), String(span.end)),
        type: 'Evidence',
        label: span.excerpt,
        layer: 'normative',
      });
      link(claim, 'supportedBy', evidence, evidenceKeys);
    }
    if (argument.evidenceLevel) {
      const level = graph.node({
        id: kgIri('evidence-level', argument.evidenceLevel),
        type: 'EvidenceLevel',
        label: argument.evidenceLevel,
        layer: 'normative',
      });
      link(claim, 'evidenceLevel', level, keys);
    }
  }
}
