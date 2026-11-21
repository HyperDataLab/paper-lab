import { sectionRoleLabel } from './labels';
import { testHoldout } from '@/core/corpusProfile/holdout';
import { confoundChecks } from '@/core/corpusProfile/confounds';
import { argumentMetrics } from '@/core/argument';
import { evidenceLevelDistribution } from '@/core/argument/evidenceLevels';
import { bodySentences, measurePaperDetail } from '@/core/corpusProfile/measure';
import type { PaperSyntax } from '@/core/corpusProfile/measureV2';
import { buildCorpusProfile, profileEligible, type ProfilePaper } from '@/core/corpusProfile/profile';
import { buildCorpusProfileV2, type ProfileSyntax } from '@/core/corpusProfile/profileV2';
import { buildPaperModel } from '@/core/paperModel';
import type { Corpus } from '@/core/schemas/corpus';
import { CorpusProfileSchema, type CorpusProfile } from '@/core/schemas/corpusProfile';
import { CorpusProfileV2Schema, type CorpusProfileV2 } from '@/core/schemas/corpusProfileV2';
import type { NlpClient } from '@/shared/nlp';
import type { Repositories } from '@/shared/storage/types';
import { labelMembers, loadLabelPaper } from './labelRun';

/** Members' papers, models and label records, read the way the labelling coverage reads them. */
export async function loadProfilePapers(
  corpus: Corpus,
  repo: Repositories,
  into: Map<string, ProfilePaper>,
  includeHeldout = false,
) {
  const members = labelMembers(corpus).filter(
    (m) => profileEligible(m) || (includeHeldout && m.role === 'held_out' && m.textRead === 'FULL_TEXT'),
  );
  await Promise.all(
    members.map(async (member) => {
      const item = await loadLabelPaper(member, repo);
      if (!item) return;
      const context = await repo.paperContext.get(item.paper.id);
      const model = buildPaperModel({
        paper: item.paper,
        metadata: context?.metadata ?? null,
        insights: item.insights,
        stance: item.stance,
        now: new Date(0),
      });
      into.set(member.memberId, { model, insights: item.insights, stance: item.stance });
    }),
  );
}

/** A 32-bit seed from the target's sampling seed, so the same corpus gives the same bootstrap. */
export function profileSeed(target: Corpus): number {
  const body = target.protocol.at(-1)?.body;
  const text = body && 'seed' in body && body.seed ? body.seed : target.id;
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return hash;
}

export async function computeProfile(target: Corpus, control: Corpus, repo: Repositories) {
  const papers = new Map<string, ProfilePaper>();
  await loadProfilePapers(target, repo, papers);
  await loadProfilePapers(control, repo, papers);
  return buildCorpusProfile({ target, control, papers, seed: profileSeed(target), now: new Date() });
}

/** The profiled members of a corpus that have a loaded paper, as `buildCorpusProfileV2` measures them. */
const profiledPapers = (corpus: Corpus, papers: ReadonlyMap<string, ProfilePaper>) =>
  corpus.members.filter(profileEligible).flatMap((member) => {
    const paper = papers.get(member.memberId);
    return paper ? [{ memberId: member.memberId, paper }] : [];
  });

/** Main-claim evidence levels of one side: live (not dismissed) arguments of each paper's latest run (P7). */
export function corpusEvidenceLevels(corpus: Corpus, papers: ReadonlyMap<string, ProfilePaper>) {
  return evidenceLevelDistribution(
    profiledPapers(corpus, papers).map(({ paper }) => {
      const run = paper.insights?.argumentRuns.at(-1);
      return {
        arguments: run && paper.insights ? argumentMetrics(run, paper.insights.decisions).live : [],
      };
    }),
  );
}

export type SyntaxProgress = { done: number; total: number };

/**
 * Parses the body sentences of every profiled paper with the spaCy service, one paper per request batch. Stops at
 * the first failure other than an abort and leaves the remaining papers unparsed; an abort is rethrown.
 */
export async function parseProfileSyntax(
  corpora: readonly Corpus[],
  papers: ReadonlyMap<string, ProfilePaper>,
  client: NlpClient,
  signal?: AbortSignal,
  onProgress?: (progress: SyntaxProgress) => void,
): Promise<ProfileSyntax> {
  const rows = corpora.flatMap((corpus) => profiledPapers(corpus, papers));
  const parsed = new Map<string, PaperSyntax>();
  let parser: string | null = null;
  onProgress?.({ done: 0, total: rows.length });
  for (const [index, { memberId, paper }] of rows.entries()) {
    signal?.throwIfAborted();
    const items = new Map<string, string>();
    for (const sentence of bodySentences(paper.model))
      if (sentence.text.trim() && !items.has(sentence.key)) items.set(sentence.key, sentence.text);
    try {
      if (items.size) {
        const result = await client.parse(
          [...items].map(([key, text]) => ({ key, text })),
          signal,
        );
        const version = `${result.version}+spacy-${result.spacyVersion} ${result.model}-${result.modelVersion ?? 'unknown'}`;
        if (parser && parser !== version) throw new Error('Dịch vụ phân tích đổi phiên bản giữa chừng');
        parser = version;
        parsed.set(
          memberId,
          new Map(result.sentences.map((s) => [s.key, { voice: s.voice, tense: s.tense }])),
        );
      } else parsed.set(memberId, new Map());
    } catch (error) {
      if (signal?.aborted) throw error;
      return { papers: parsed, parser, error: error instanceof Error ? error.message : String(error) };
    }
    onProgress?.({ done: index + 1, total: rows.length });
  }
  return { papers: parsed, parser };
}

/**
 * Draft profile v2, built on demand for export and never stored: the v1 profile plus the P2 features, with
 * the members' OpenAlex keywords and the subfield names the library knows, passive voice and tense when a grammar
 * service is given (P6), and the main-claim evidence levels (P7).
 */
export async function computeProfileV2(
  target: Corpus,
  control: Corpus,
  repo: Repositories,
  options: {
    nlp?: NlpClient | null;
    signal?: AbortSignal;
    onSyntaxProgress?: (progress: SyntaxProgress) => void;
  } = {},
) {
  const papers = new Map<string, ProfilePaper>();
  await loadProfilePapers(target, repo, papers);
  await loadProfilePapers(control, repo, papers);
  const syntax = options.nlp
    ? await parseProfileSyntax(
        [target, control],
        papers,
        options.nlp,
        options.signal,
        options.onSyntaxProgress,
      )
    : undefined;
  options.signal?.throwIfAborted();
  const [targetKeywords, controlKeywords, library] = await Promise.all([
    repo.corpusKeywords.memberKeywords(target),
    repo.corpusKeywords.memberKeywords(control),
    repo.library.list(),
  ]);
  const subfieldNames = new Map(
    library.flatMap(({ taxonomy }) =>
      taxonomy?.subfieldId && taxonomy.subfield ? [[taxonomy.subfieldId, taxonomy.subfield] as const] : [],
    ),
  );
  return buildCorpusProfileV2({
    target,
    control,
    papers,
    keywords: { target: targetKeywords.papers, control: controlKeywords.papers },
    subfieldNames,
    syntax,
    evidenceLevel: {
      target: corpusEvidenceLevels(target, papers),
      control: corpusEvidenceLevels(control, papers),
    },
    seed: profileSeed(target),
    now: new Date(),
  });
}

/** The profile and its selected features remain frozen while held-out papers are loaded. */
export async function computeHoldout(
  profile: CorpusProfile,
  target: Corpus,
  control: Corpus,
  repo: Repositories,
): Promise<CorpusProfile> {
  const papers = new Map<string, ProfilePaper>();
  await loadProfilePapers(target, repo, papers, true);
  await loadProfilePapers(control, repo, papers, true);
  const rows = (corpus: Corpus, held: boolean) =>
    corpus.members
      .filter((m) =>
        held
          ? m.role === 'held_out' && m.retrieval === 'retrieved' && m.textRead === 'FULL_TEXT'
          : profileEligible(m),
      )
      .flatMap((m) => {
        const paper = papers.get(m.memberId);
        return paper
          ? [
              {
                authorIds: m.authorIds,
                values: measurePaperDetail(paper.model, paper.insights, paper.stance).values,
              },
            ]
          : [];
      });
  const holdout = testHoldout(
    profile.distinctiveFeatureIds,
    rows(target, false),
    rows(control, false),
    rows(target, true),
    rows(control, true),
    profile.seed,
  );
  const supported = profile.interpretationStatus !== 'exploratory' && holdout.passed;
  return CorpusProfileSchema.parse({
    ...profile,
    holdout,
    confoundChecks: confoundChecks(target.members, control.members),
    holdoutVerified: holdout.passed,
    interpretationStatus:
      profile.interpretationStatus === 'exploratory'
        ? 'exploratory'
        : supported
          ? 'supported'
          : 'inconclusive',
    interpretationReason:
      profile.interpretationStatus === 'exploratory'
        ? profile.interpretationReason
        : supported
          ? 'The section 4 minimums and held-out test are met.'
          : 'The held-out test did not pass, so no feature is supported.',
  });
}

export function featureLabel(featureId: string): string {
  const [head, middle, tail] = featureId.split('.');
  if (head === 'section' && middle)
    return `${tail === 'word_share' ? 'Tỷ lệ từ' : 'Độ dài câu'} · ${sectionRoleLabel(middle)}`;
  if (featureId === 'paragraph.length') return 'Độ dài đoạn';
  if (featureId === 'citation.rate') return 'Mật độ trích dẫn';
  if (head === 'stance') return `Stance: ${middle}`;
  if (head === 'rhetoric') return `Có nhãn ${middle}`;
  if (head === 'claim') return `Tỷ lệ claim ${middle}`;
  return featureId;
}

function downloadJson(value: unknown, title: string, suffix: string) {
  const json = JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${
    title
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'corpus'
  }.${suffix}`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Downloads the validated profile as `<slug>.corpus-profile.json`. */
export function downloadProfile(profile: CorpusProfile, title: string) {
  downloadJson(CorpusProfileSchema.parse(profile), title, 'corpus-profile.json');
}

/** Downloads the validated draft v2 profile as `<slug>.corpus-profile-v2.draft.json`. */
export function downloadProfileV2(profile: CorpusProfileV2, title: string) {
  downloadJson(CorpusProfileV2Schema.parse(profile), title, 'corpus-profile-v2.draft.json');
}
