import type { PaperModel } from '../schemas/paperModel';
import type { PaperInsightsRecord } from '../schemas/paperInsights';
import type { StanceRecord } from '../schemas/stance';
import { isRhetoricSection } from '../rhetoric';
import { isStanceSection } from '../stance';
import { tokenize } from '../text/tokenize';
import { FEATURE_REGISTRY, SECTION_MAP, SIGNATURE_SECTIONS } from './registry';
import { mean } from './stats';

/** Exclude these sections and their descendants, regardless of their assigned role. */
export const BOILERPLATE_HEADING =
  /^(?:front matter|declarations? of (?:competing )?interests?|competing interests?|conflicts? of interest|credit(?: authorship contribution statement)?|author contributions?|data availability(?: statement)?|acknowledg(?:e)?ments?|funding(?: information| statement)?)(?:\s*[:.]|\s*$)/iu;

export function bodyBlocks(model: PaperModel) {
  const excluded = new Set<string>();
  for (const section of model.document.sections)
    if (BOILERPLATE_HEADING.test(section.title) || section.role === 'references' || section.role === 'title')
      excluded.add(section.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of model.document.sections)
      if (section.parentId && excluded.has(section.parentId) && !excluded.has(section.id)) {
        excluded.add(section.id);
        changed = true;
      }
  }
  return model.document.blocks.filter((block) => block.kind === 'body' && !excluded.has(block.sectionId));
}

/** Body sentences, in document order. */
export function bodySentences(model: PaperModel) {
  const ids = new Set(bodyBlocks(model).map((block) => block.id));
  return model.sentences.filter((sentence) => ids.has(sentence.paragraphId));
}

/** Labels counted for a machine-label feature: how many, and how many no person has confirmed yet. */
export type LabelCount = { total: number; machine: number };
export type PaperMeasurement = {
  values: Record<string, number | null>;
  labels: Record<string, LabelCount>;
};

export function measurePaper(
  model: PaperModel,
  insights?: PaperInsightsRecord | null,
  stance?: StanceRecord | null,
): Record<string, number | null> {
  return measurePaperDetail(model, insights, stance).values;
}

export function measurePaperDetail(
  model: PaperModel,
  insights?: PaperInsightsRecord | null,
  stance?: StanceRecord | null,
): PaperMeasurement {
  const result: Record<string, number | null> = Object.fromEntries(
    FEATURE_REGISTRY.features.map((f) => [f.id, null]),
  );
  const labels: Record<string, LabelCount> = {};
  const blocks = bodyBlocks(model),
    blockIds = new Set(blocks.map((block) => block.id));
  const sections = new Map(model.document.sections.map((section) => [section.id, SECTION_MAP[section.role]]));
  const words = (text: string) => tokenize(text).filter((token) => token.kind === 'word').length;
  const total = blocks.reduce((sum, block) => sum + words(block.text), 0);
  const sentences = model.sentences.filter((sentence) => blockIds.has(sentence.paragraphId));
  for (const section of SIGNATURE_SECTIONS) {
    const selected = blocks.filter((block) => sections.get(block.sectionId) === section);
    result[`section.${section}.word_share`] = total
      ? selected.reduce((sum, block) => sum + words(block.text), 0) / total
      : null;
    result[`section.${section}.sentence_length`] = mean(
      sentences
        .filter((sentence) => sections.get(sentence.sectionId) === section)
        .map((sentence) => words(sentence.text)),
    );
  }
  result['paragraph.length'] = mean(blocks.map((block) => words(block.text)));
  result['citation.rate'] = total
    ? (100 *
        blocks.reduce(
          (sum, block) => sum + tokenize(block.text).filter((token) => token.kind === 'citation').length,
          0,
        )) /
      total
    : null;
  const sentenceKeys = new Set(sentences.map((sentence) => sentence.key));
  const annotations = model.annotations.filter(
    (annotation) => annotation.state !== 'rejected' && sentenceKeys.has(annotation.key),
  );
  // A run is complete when it read every body section its labeller reads by default (the labellers' own
  // section rules: no appendix, no boilerplate by heading prefix); stance rates are per word of those sections.
  const modelSections = new Map(model.document.sections.map((section) => [section.id, section]));
  const scope = (reads: typeof isStanceSection) => {
    const selected = blocks.filter((block) => {
      const section = modelSections.get(block.sectionId);
      return section && reads({ role: section.role, heading: section.title });
    });
    return { ids: new Set(selected.map((block) => block.sectionId)), blocks: selected };
  };
  const stanceScope = scope(isStanceSection),
    rhetoricScope = scope(isRhetoricSection);
  const labelWords = stanceScope.blocks.reduce((sum, block) => sum + words(block.text), 0);
  const complete = (
    run: { sectionIds: string[]; failedSectionIds: string[] } | undefined,
    { ids }: { ids: Set<string> },
  ) =>
    Boolean(run && [...ids].every((id) => run.sectionIds.includes(id) && !run.failedSectionIds.includes(id)));
  const count = (id: string, used: readonly { state: string }[]) => {
    labels[id] = { total: used.length, machine: used.filter((a) => a.state === 'machine').length };
  };
  const stanceRun = stance?.runs.at(-1);
  const rhetoricRun = insights?.rhetoricRuns.at(-1);
  for (const label of ['hedges', 'boosters']) {
    const id = `stance.${label}`;
    if (!complete(stanceRun, stanceScope) || !labelWords) continue;
    const used = annotations.filter(
      (a) => a.scheme === 'paperlab-stance' && a.label === label && a.source?.runId === stanceRun?.id,
    );
    result[id] = (1000 * used.length) / labelWords;
    count(id, used);
  }
  for (const feature of FEATURE_REGISTRY.features.filter((f) => f.family === 'rhetorical')) {
    if (!complete(rhetoricRun, rhetoricScope)) continue;
    const used = annotations.filter(
      (a) =>
        a.scheme === 'paperlab-rhetoric' &&
        `rhetoric.${a.label}` === feature.id &&
        a.source?.runId === rhetoricRun?.id,
    );
    result[feature.id] = Number(used.length > 0);
    count(feature.id, used);
  }
  const run = insights?.argumentRuns.at(-1);
  const typed =
    run?.arguments.filter((argument) => argument.claimType && blockIds.has(argument.claim.paragraphId)) ?? [];
  for (const feature of FEATURE_REGISTRY.features.filter((f) => f.family === 'scientific')) {
    // Argument runs read the rhetoric sections (`labelSections` in the corpus module).
    if (!complete(run, rhetoricScope) || !typed.length) continue;
    const used = typed.filter((argument) => `claim.${argument.claimType}` === feature.id);
    result[feature.id] = used.length / typed.length;
    // Argument runs are not in the paper model, so no person has reviewed their claim types.
    labels[feature.id] = { total: used.length, machine: used.length };
  }
  return { values: result, labels };
}
