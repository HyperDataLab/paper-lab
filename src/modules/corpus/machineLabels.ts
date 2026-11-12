import type { LabelSampleItem } from '@/core/corpus/labelChecks';
import { paperLabAnnotations, sentenceIndex, spanToSentences } from '@/core/paperModel';
import type { PaperModelSentence } from '@/core/schemas';
import { labelCovered, type LabelPaper, type LabelScheme } from './labelPlan';

export type MachineLabel = LabelSampleItem & { scheme: LabelScheme; text: string };

type ArgumentSpan = { paragraphId: string; start: number; end: number };

/**
 * The labels a member's latest runs put on its sentences, for the schemes whose run is current (same prompt
 * version, every planned section). Rhetoric and stance are placed the way the paper model places them; arguments
 * are not in the paper model yet, so each Toulmin part is placed on the sentences its span overlaps.
 */
export function machineLabels(
  item: LabelPaper,
  schemes: readonly LabelScheme[],
  sentences: readonly PaperModelSentence[] = sentenceIndex(item.paper),
): MachineLabel[] {
  const current = schemes.filter((scheme) => labelCovered(item, scheme));
  if (!current.length) return [];
  const roles = new Map(item.paper.sections.map((section) => [section.id, section.role]));
  const out = new Map<string, MachineLabel>();
  const add = (scheme: LabelScheme, sentence: PaperModelSentence, label: string) => {
    const entry: MachineLabel = {
      scheme,
      memberId: item.memberId,
      section: roles.get(sentence.sectionId) ?? 'other',
      sentenceKey: sentence.key,
      label,
      text: sentence.text,
    };
    out.set(JSON.stringify([scheme, sentence.key, label]), entry);
  };
  const byKey = new Map(sentences.map((sentence) => [sentence.key, sentence]));
  const { annotations } = paperLabAnnotations(sentences, item.insights, item.stance);
  for (const annotation of annotations) {
    const scheme = annotation.scheme === 'paperlab-rhetoric' ? 'rhetoric' : 'stance';
    const sentence = byKey.get(annotation.key);
    if (sentence && current.includes(scheme)) add(scheme, sentence, annotation.label);
  }
  const run = item.insights?.argumentRuns.at(-1);
  if (run && current.includes('arguments'))
    for (const argument of run.arguments) {
      const parts: [string, ArgumentSpan[]][] = [
        ['claim', [argument.claim]],
        ['data', argument.data],
        ['warrant', argument.statedWarrant ? [argument.statedWarrant] : []],
        ['backing', argument.backing],
        ['qualifier', argument.qualifier ? [argument.qualifier] : []],
        ['rebuttal', argument.rebuttals],
      ];
      for (const [label, spans] of parts)
        for (const span of spans)
          for (const hit of spanToSentences(sentences, span.paragraphId, span.start, span.end))
            add('arguments', hit.sentence, label);
    }
  return [...out.values()];
}

export type RoleCoverage = {
  role: string;
  /** Per scheme: sentences of members covered by that scheme, and how many of them carry a label. */
  schemes: Partial<Record<LabelScheme, { sentences: number; labelled: number }>>;
};

export function labelCoverage(items: readonly LabelPaper[], schemes: readonly LabelScheme[]) {
  const members = schemes.map((scheme) => ({
    scheme,
    covered: items.filter((item) => labelCovered(item, scheme)).length,
    built: items.length,
  }));
  const roles = new Map<string, RoleCoverage>();
  for (const item of items) {
    const sentences = sentenceIndex(item.paper);
    const labels = machineLabels(item, schemes, sentences);
    const sentenceRoles = new Map(item.paper.sections.map((section) => [section.id, section.role]));
    for (const scheme of schemes) {
      if (!labelCovered(item, scheme)) continue;
      const labelled = new Set(labels.filter((l) => l.scheme === scheme).map((l) => l.sentenceKey));
      for (const sentence of sentences) {
        const role = sentenceRoles.get(sentence.sectionId) ?? 'other';
        const entry = roles.get(role) ?? { role, schemes: {} };
        const counts = entry.schemes[scheme] ?? { sentences: 0, labelled: 0 };
        counts.sentences++;
        if (labelled.has(sentence.key)) counts.labelled++;
        entry.schemes[scheme] = counts;
        roles.set(role, entry);
      }
    }
  }
  return { members, roles: [...roles.values()] };
}
