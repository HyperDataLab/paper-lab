import { argumentMetrics } from '../argument';
import { CLAIM_TYPES } from '../argument/claimTypes';
import { bareHeading, combinedRoles } from '../paper/sectionRoles';
import { isRhetoricSection } from '../rhetoric';
import type { PaperInsightsRecord } from '../schemas/paperInsights';
import type { PaperModel } from '../schemas/paperModel';
import type { StanceRecord } from '../schemas/stance';
import { bodyBlocks, measurePaperDetail, otherShare, type PaperMeasurement } from './measure';
import { SECTION_MAP, SIGNATURE_SECTIONS, type SignatureSection } from './registry';
import { ARGUMENT_ELEMENTS, CLAIM_SECTIONS, FEATURE_REGISTRY_V2, type ArgumentElement } from './registryV2';
import { mean } from './stats';
import { styleCounts } from './styleLexicon';

/** A top-level section that holds body text, directly or in a subsection, in document order. */
export type TopSection = { id: string; role: SignatureSection; heading: string };

/**
 * The paper's top-level body sections after boilerplate, references and title are removed, ordered by their first
 * body block. A subsection's text belongs to its top-level ancestor.
 */
export function topSections(model: PaperModel): TopSection[] {
  const sections = new Map(model.document.sections.map((section) => [section.id, section]));
  const rootOf = (id: string) => {
    let section = sections.get(id);
    const seen = new Set<string>();
    while (section?.parentId && sections.has(section.parentId) && !seen.has(section.id)) {
      seen.add(section.id);
      section = sections.get(section.parentId);
    }
    return section;
  };
  const roots = new Map<string, TopSection>();
  for (const block of bodyBlocks(model)) {
    const root = rootOf(block.sectionId);
    if (root && !roots.has(root.id))
      roots.set(root.id, { id: root.id, role: SECTION_MAP[root.role], heading: root.title });
  }
  return [...roots.values()];
}

/** Section roles left out of `sectionSequences`: they say nothing about the order of the argument. */
const SEQUENCE_SKIP = new Set<SignatureSection>(['ABSTRACT', 'OTHER', 'APPENDIX']);

/** The paper's role sequence: top-level body sections in order, skipped roles removed, repeats collapsed. */
export function sectionSequence(model: PaperModel): SignatureSection[] {
  const roles: SignatureSection[] = [];
  for (const { role } of topSections(model))
    if (!SEQUENCE_SKIP.has(role) && roles.at(-1) !== role) roles.push(role);
  return roles;
}

/** A heading as the `headings` block counts it: numbering removed, spaces collapsed, NFKC. */
export const headingKey = (heading: string) =>
  bareHeading(heading).normalize('NFKC').replace(/\s+/gu, ' ').trim();

/** The latest run, when it read every body section the rhetoric and argument labellers read. */
function completeArgumentRun(model: PaperModel, insights: PaperInsightsRecord | null | undefined) {
  const run = insights?.argumentRuns.at(-1);
  if (!run) return null;
  const sections = new Map(model.document.sections.map((section) => [section.id, section]));
  const needed = new Set(
    bodyBlocks(model)
      .filter((block) => {
        const section = sections.get(block.sectionId);
        return section && isRhetoricSection({ role: section.role, heading: section.title });
      })
      .map((block) => block.sectionId),
  );
  const complete = [...needed].every(
    (id) => run.sectionIds.includes(id) && !run.failedSectionIds.includes(id),
  );
  return complete ? run : null;
}

/**
 * Every registry v2 feature for one paper: the v1 values unchanged, then the P2 features. Values the paper cannot
 * give (a role it lacks, an incomplete or missing argument run) are null, never 0.
 */
export function measurePaperV2Detail(
  model: PaperModel,
  insights?: PaperInsightsRecord | null,
  stance?: StanceRecord | null,
): PaperMeasurement {
  const v1 = measurePaperDetail(model, insights, stance);
  const values: Record<string, number | null> = Object.fromEntries(
    FEATURE_REGISTRY_V2.features.map((feature) => [feature.id, v1.values[feature.id] ?? null]),
  );
  const labels = { ...v1.labels };
  const blocks = bodyBlocks(model);
  const roles = new Map(model.document.sections.map((section) => [section.id, SECTION_MAP[section.role]]));
  const counted = blocks.map((block) => ({
    block,
    role: roles.get(block.sectionId) ?? 'OTHER',
    ...styleCounts(block.text),
  }));
  const totalWords = counted.reduce((sum, row) => sum + row.words, 0);
  const roleWords = new Map<SignatureSection, number>();
  for (const section of SIGNATURE_SECTIONS) {
    const rows = counted.filter((row) => row.role === section && row.words > 0);
    const words = rows.reduce((sum, row) => sum + row.words, 0);
    roleWords.set(section, words);
    const id = (metric: string) => `section.${section}.${metric}`;
    values[id('presence')] = totalWords ? Number(words > 0) : null;
    if (!words) continue;
    values[id('paragraph_count')] = rows.length;
    values[id('paragraph_length')] = mean(rows.map((row) => row.words));
    for (const list of ['hedges', 'boosters', 'first_person'] as const)
      values[id(list)] = (1000 * rows.reduce((sum, row) => sum + row[list], 0)) / words;
  }

  if (blocks.length) {
    const top = topSections(model);
    values['structure.section_count'] = top.filter((section) => section.role !== 'ABSTRACT').length;
    const holding = new Set([...top.map((section) => section.id), ...blocks.map((block) => block.sectionId)]);
    values['structure.results_discussion_combined'] = Number(
      model.document.sections.some(
        (section) =>
          holding.has(section.id) && combinedRoles(section.title)?.join('+') === 'results+discussion',
      ),
    );
  }
  values['structure.other_share'] = otherShare(model).words;

  const run = completeArgumentRun(model, insights);
  if (run && insights) {
    const metrics = argumentMetrics(run, insights.decisions);
    const blockRole = new Map(counted.map((row) => [row.block.id, row.role]));
    const unconfirmed = (items: readonly { id: string }[]) =>
      items.filter((item) => metrics.states.get(item.id) !== 'confirmed').length;
    const typed = metrics.live.filter((item) => item.claimType && blockRole.has(item.claim.paragraphId));
    if (typed.length)
      for (const section of CLAIM_SECTIONS) {
        if (!roleWords.get(section)) continue;
        for (const type of CLAIM_TYPES) {
          const id = `section.${section}.claim.${type}`;
          const used = typed.filter(
            (item) => item.claimType === type && blockRole.get(item.claim.paragraphId) === section,
          );
          values[id] = Number(used.length > 0);
          labels[id] = { total: used.length, machine: unconfirmed(used) };
        }
      }
    const main = metrics.main.filter((item) => blockRole.has(item.claim.paragraphId));
    const tests: Record<ArgumentElement, (item: (typeof main)[number]) => boolean> = {
      with_data: (item) => item.data.length > 0,
      stated_warrant: (item) => item.statedWarrant !== null,
      inferred_warrant: (item) => item.inferredWarrant !== null,
      with_qualifier: (item) => item.qualifier !== null,
      with_rebuttal: (item) => item.rebuttals.length > 0,
      unsupported: (item) => item.data.length === 0,
    };
    if (main.length)
      for (const element of ARGUMENT_ELEMENTS) {
        const id = `argument.${element}`;
        const used = main.filter(tests[element]);
        values[id] = Number(used.length > 0);
        labels[id] = { total: used.length, machine: unconfirmed(used) };
      }
  }
  return { values, labels };
}
