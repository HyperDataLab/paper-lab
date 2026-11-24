import type { Paper, PaperSummary } from '@/core/schemas';
import { normalizeDoi, parseDoiInput } from '@/core/library';
import type { Repositories } from '@/shared/storage/repositories';

export type ProjectEvidence = {
  id: string;
  title: string;
  kind: 'Dữ liệu KG' | 'Toàn văn' | 'Phân tích đã lưu' | 'Ma trận trích xuất' | 'Thiết kế nghiên cứu';
  locator: string;
  text: string;
  paperId?: string;
};

const MAX_SOURCE_TEXT = 1_000;
const MAX_SELECTED_SOURCES = 10;
// There is no full-text index in the project workspace. Keep cold retrieval to a
// small, relevant paper slice instead of downloading every imported document.
const MAX_PAPER_CANDIDATES = 12;
const MAX_PARAGRAPHS_PER_PAPER = 100;
const MAX_EVIDENCE_CANDIDATES = 3_000;
const MAX_STRINGS_PER_RECORD = 200;
const MAX_ARRAY_ITEMS_PER_RECORD = 250;
const MAX_PROJECT_RECORDS = 500;
const STOP_WORDS = new Set(
  'about after all also and any are article based been before between can could data does for from have how into its more most paper project research should that the their them then there these they this through use using was were what when where which while with within would a an by do is it of on or our per to as at be if may so we about bai bao bai nay cac cai can cho chu co cua da dang de den du duoc hay hien lam lien ma mot nao nay nen nhieu nhung noi o phan qua se su tai theo thi thong tin trong tren tu voi va ve'.split(
    ' ',
  ),
);

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function queryTerms(question: string) {
  const normalizedTerms = normalize(question).split(/\s+/u);
  const originalTerms = question
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^\p{L}\p{N}]+/u);
  return [...new Set(normalizedTerms)].filter((term, index) => {
    const acronym = /^[A-Z0-9]{2,8}$/u.test(originalTerms[index] ?? '');
    return (term.length > 2 || acronym) && !STOP_WORDS.has(term);
  });
}

function tokenSimilarity(term: string, word: string) {
  if (word === term) return 1;
  if (term.length >= 5 && word.length >= 5 && (term.startsWith(word) || word.startsWith(term))) return 0.72;
  if (term.length < 7 || word.length < 7 || Math.abs(term.length - word.length) > 1) return 0;
  let mismatches = 0;
  let left = 0;
  let right = 0;
  while (left < term.length && right < word.length) {
    if (term[left] === word[right]) {
      left += 1;
      right += 1;
    } else {
      mismatches += 1;
      if (mismatches > 1) return 0;
      if (term.length >= word.length) left += 1;
      if (word.length >= term.length) right += 1;
    }
  }
  return mismatches + (left < term.length || right < word.length ? 1 : 0) <= 1 ? 0.55 : 0;
}

function score(text: string, terms: string[]) {
  const normalized = normalize(text);
  const words = [...new Set(normalized.split(/\s+/u))];
  let score = 0;
  for (const term of terms) {
    const similarity = words.reduce((best, word) => Math.max(best, tokenSimilarity(term, word)), 0);
    if (similarity) score += similarity * (term.length > 6 ? 2 : 1);
  }
  // Preserve multiword concepts as a stronger signal than scattered common terms.
  const queryPhrase = terms.join(' ');
  if (terms.length > 1 && normalized.includes(queryPhrase)) score += terms.length * 0.75;
  return score;
}

function candidatePaperIds(
  summaries: PaperSummary[],
  contexts: Awaited<ReturnType<Repositories['paperContext']['list']>>,
  library: Awaited<ReturnType<Repositories['library']['list']>>,
  analyses: Awaited<ReturnType<Repositories['analyses']['list']>>['items'],
  question: string,
) {
  const terms = queryTerms(question);
  const requestedDois = new Set(parseDoiInput(question).dois);
  const normalizedQuestion = normalize(question);
  const byPaperId = new Map(contexts.map((record) => [record.paperId, record]));
  const libraryByPaperId = new Map(
    library.flatMap((item) => (item.paper_id ? [[item.paper_id, item] as const] : [])),
  );
  const analysisTextByPaperId = new Map<string, string[]>();
  for (const analysis of analyses) {
    if (!analysis.paperId) continue;
    const previews = analysisTextByPaperId.get(analysis.paperId) ?? [];
    previews.push(analysis.preview);
    analysisTextByPaperId.set(analysis.paperId, previews);
  }
  const ranked = summaries
    .map((paper, index) => {
      const metadata = byPaperId.get(paper.id)?.metadata;
      const item = libraryByPaperId.get(paper.id);
      const doi = normalizeDoi(metadata?.doi ?? byPaperId.get(paper.id)?.paperDoi ?? item?.doi ?? '');
      const title = metadata?.title ?? item?.title ?? paper.detectedTitle ?? paper.title;
      const searchable = [
        title,
        metadata?.doi,
        metadata?.topic,
        ...(metadata?.keywords ?? []),
        item?.title,
        item?.doi,
        ...(item?.keywords?.map(({ name }) => name) ?? []),
        ...(analysisTextByPaperId.get(paper.id) ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ');
      const exactDoi = doi && requestedDois.has(doi) ? 1_000 : 0;
      const exactTitle =
        normalize(title).length >= 16 && normalizedQuestion.includes(normalize(title)) ? 100 : 0;
      return { id: paper.id, index, score: score(searchable, terms) + exactDoi + exactTitle };
    })
    .filter(({ score: value }) => value > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_PAPER_CANDIDATES);
  if (ranked.length >= MAX_PAPER_CANDIDATES) return ranked.map(({ id }) => id);

  const selected = new Set(ranked.map(({ id }) => id));
  for (const paper of summaries) {
    if (selected.size >= MAX_PAPER_CANDIDATES) break;
    selected.add(paper.id);
  }
  return [...selected];
}

async function mapLimit<T, R>(values: readonly T[], concurrency: number, fn: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        const value = values[index];
        if (value !== undefined) results[index] = await fn(value);
      }
    }),
  );
  return results;
}

function pushEvidence(
  target: ProjectEvidence[],
  source: Omit<ProjectEvidence, 'text'> & { text: string | null | undefined },
) {
  if (target.length >= MAX_EVIDENCE_CANDIDATES) return;
  const text = source.text?.replace(/\s+/gu, ' ').trim();
  if (text && text.length >= 35)
    target.push({
      ...source,
      text: text.length > MAX_SOURCE_TEXT ? `${text.slice(0, MAX_SOURCE_TEXT - 1)}…` : text,
    });
}

function stringsFrom(value: unknown, path = '', depth = 0): { path: string; text: string }[] {
  const output: { path: string; text: string }[] = [];
  const visit = (current: unknown, currentPath: string, currentDepth: number) => {
    if (
      output.length >= MAX_STRINGS_PER_RECORD ||
      currentDepth > 8 ||
      current === null ||
      current === undefined
    )
      return;
    if (typeof current === 'string') {
      if (
        current.trim().length >= 35 &&
        !/^(id|.*hash|.*version|.*model|.*status|.*at|.*date)$/iu.test(currentPath)
      )
        output.push({ path: currentPath || 'Nội dung', text: current });
      return;
    }
    if (Array.isArray(current)) {
      for (const [index, item] of current.slice(0, MAX_ARRAY_ITEMS_PER_RECORD).entries()) {
        visit(item, currentPath ? `${currentPath} ${index + 1}` : `Mục ${index + 1}`, currentDepth + 1);
        if (output.length >= MAX_STRINGS_PER_RECORD) return;
      }
      return;
    }
    if (typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      if (/^(id|.*hash|.*version|.*model|.*status|.*at|.*date|.*token|.*count)$/iu.test(key)) continue;
      visit(child, `${currentPath} ${key}`.trim(), currentDepth + 1);
      if (output.length >= MAX_STRINGS_PER_RECORD) return;
    }
  };
  visit(value, path, depth);
  return output;
}

function addPaperText(sources: ProjectEvidence[], paper: Paper) {
  const sectionById = new Map(paper.sections.map((section) => [section.id, section]));
  // Sample both ends so long papers remain searchable without materializing every paragraph.
  const paragraphs =
    paper.paragraphs.length <= MAX_PARAGRAPHS_PER_PAPER
      ? paper.paragraphs
      : [
          ...paper.paragraphs.slice(0, MAX_PARAGRAPHS_PER_PAPER / 2),
          ...paper.paragraphs.slice(-MAX_PARAGRAPHS_PER_PAPER / 2),
        ];
  for (const paragraph of paragraphs) {
    const section = sectionById.get(paragraph.sectionId);
    const page = paragraph.pageStart ? `tr. ${paragraph.pageStart}` : '';
    pushEvidence(sources, {
      id: `paper:${paper.id}:${paragraph.id}`,
      title: paper.title,
      kind: 'Toàn văn',
      locator: [section?.heading, page].filter(Boolean).join(' · ') || 'Toàn văn',
      text: paragraph.text,
      paperId: paper.id,
    });
  }
}

/** Retrieves searchable sources from this ResearchHub project's PaperLab workspace. */
export async function retrieveProjectEvidence(
  repo: Repositories,
  question: string,
  projectId: string,
): Promise<ProjectEvidence[]> {
  const summaries = await repo.papers.listSummaries();
  const [allContexts, allLibrary, allCorpora, analysisSummaryResult, extractionRecords] = await Promise.all([
    repo.paperContext.list().catch(() => []),
    repo.library.list().catch(() => []),
    repo.corpora.list().catch(() => []),
    repo.analyses.list().catch(() => ({ items: [], corrupt: 0 })),
    repo.extraction.list().catch(() => []),
  ]);
  const contexts = allContexts.slice(0, MAX_PROJECT_RECORDS);
  const library = allLibrary.slice(0, MAX_PROJECT_RECORDS);
  const corpora = allCorpora.slice(0, MAX_PROJECT_RECORDS);
  const paperIds = candidatePaperIds(
    summaries,
    allContexts,
    allLibrary,
    analysisSummaryResult.items,
    question,
  );
  const extraction = extractionRecords.slice(0, MAX_PROJECT_RECORDS);
  const analysisSummaries = analysisSummaryResult.items.slice(0, MAX_PROJECT_RECORDS);
  const readEach = <T>(read: (id: string) => Promise<T | undefined>) =>
    Promise.all(paperIds.map(async (id) => read(id).catch(() => undefined)));
  const [papers, insights, overviews, checks, reviews, probes, measurements, stances] = await Promise.all([
    repo.papers.getMany(paperIds),
    readEach((id) => repo.paperInsights.get(id)),
    readEach((id) => repo.paperOverviews.get(id)),
    readEach((id) => repo.paperChecks.get(id)),
    readEach((id) => repo.paperReviews.getVisible(id)),
    readEach((id) => repo.paperProbes.get(id)),
    readEach((id) => repo.measurements.get(id)),
    readEach((id) => repo.stance.get(id)),
  ]);
  const [designs, autoresearchRuns] = await Promise.all([
    mapLimit(extraction, 6, (project) => repo.researchDesigns.get(project.id).catch(() => undefined)),
    mapLimit(extraction, 6, (project) => repo.autoresearch.list(project.id).catch(() => [])),
  ]);

  const sources: ProjectEvidence[] = [];
  papers.forEach((paper) => {
    if (paper) addPaperText(sources, paper);
  });
  const paperById = new Map(papers.flatMap((paper) => (paper ? [[paper.id, paper] as const] : [])));

  const analysisSets: unknown[][] = [insights, overviews, checks, reviews, probes, measurements, stances];
  analysisSets.forEach((records) => {
    records.forEach((record, index) => {
      if (!record) return;
      const paperId = paperIds[index];
      const paper = paperId ? paperById.get(paperId) : undefined;
      const chunks = stringsFrom(record).slice(0, 40);
      chunks.forEach((chunk, chunkIndex) =>
        pushEvidence(sources, {
          id: `analysis:${paperId ?? index}:${records === insights ? 'insight' : records === overviews ? 'overview' : records === checks ? 'check' : records === reviews ? 'review' : records === probes ? 'probe' : records === measurements ? 'measurement' : 'stance'}:${chunkIndex}`,
          title: paper?.title ?? 'Phân tích bài báo',
          kind: 'Phân tích đã lưu',
          locator: chunk.path,
          text: chunk.text,
          ...(paperId ? { paperId } : {}),
        }),
      );
    });
  });

  for (const context of contexts) {
    const metadata = context.metadata;
    if (!metadata) continue;
    const paper = paperById.get(context.paperId);
    pushEvidence(sources, {
      id: `metadata:${context.paperId}`,
      title: paper?.title ?? metadata.title ?? 'Thông tin bài báo',
      kind: 'Phân tích đã lưu',
      locator: 'Metadata trong PaperLab',
      text: [
        metadata.title,
        metadata.doi,
        metadata.year,
        metadata.type,
        metadata.venue,
        metadata.authors.join(', '),
        metadata.topic,
      ]
        .filter(Boolean)
        .join(' · '),
      paperId: context.paperId,
    });
  }
  for (const item of library) {
    const paperId = item.paper_id;
    pushEvidence(sources, {
      id: `library:${item.id}`,
      title: item.title ?? item.doi ?? 'Bài trong thư viện',
      kind: 'Phân tích đã lưu',
      locator: 'Thư viện của project',
      text: [
        item.title,
        item.doi,
        item.year,
        item.venue,
        item.authors.join(', '),
        item.keywords?.map((keyword) => keyword.name).join(', '),
      ]
        .filter(Boolean)
        .join(' · '),
      ...(paperId ? { paperId } : {}),
    });
  }

  for (const project of extraction) {
    const paperByKey = new Map(project.papers.map((paper) => [paper.key, paper]));
    const fieldByKey = new Map(project.fields.map((field) => [field.key, field]));
    for (const cell of project.cells) {
      const paper = paperByKey.get(cell.paperKey);
      const field = fieldByKey.get(cell.fieldKey);
      const paperTitle = paper?.title ?? project.title;
      const locations = cell.evidence
        .map((item) => [item.section, item.page ? `tr. ${item.page}` : null].filter(Boolean).join(', '))
        .filter(Boolean);
      const locator = [project.title, field?.label ?? cell.fieldKey, ...new Set(locations)]
        .filter(Boolean)
        .join(' · ');
      pushEvidence(sources, {
        id: `matrix:${project.id}:${cell.paperKey}:${cell.fieldKey}`,
        title: paperTitle,
        kind: 'Ma trận trích xuất',
        locator,
        text: [cell.value, ...cell.evidence.map((item) => item.quote)].filter(Boolean).join(' — '),
        ...(paper?.source.kind === 'paper' ? { paperId: paper.source.paperId } : {}),
      });
    }
  }
  const corpusIds = corpora.map((corpus) => corpus.id);
  const [profiles, topicSnapshots] = await Promise.all([
    mapLimit(corpusIds, 6, (id) => repo.corpusProfiles.get(id).catch(() => undefined)),
    mapLimit(corpusIds, 6, (id) => repo.corpusTopics.list(id).catch(() => [])),
  ]);
  const projectRecords: { id: string; title: string; kind: ProjectEvidence['kind']; value: unknown }[] = [
    ...contexts.map((record) => ({
      id: `context:${record.paperId}`,
      title: paperById.get(record.paperId)?.title ?? 'Ngữ cảnh bài báo',
      kind: 'Phân tích đã lưu' as const,
      value: record,
    })),
    ...library.map((item) => ({
      id: `library:${item.id}`,
      title: item.title ?? item.doi ?? 'Bài trong thư viện',
      kind: 'Phân tích đã lưu' as const,
      value: item,
    })),
    ...corpora.map((corpus) => ({
      id: `corpus:${corpus.id}`,
      title: corpus.title,
      kind: 'Thiết kế nghiên cứu' as const,
      value: corpus,
    })),
    ...profiles.flatMap((profile) =>
      profile
        ? [
            {
              id: `profile:${profile.corpusId}`,
              title: 'Hồ sơ corpus',
              kind: 'Phân tích đã lưu' as const,
              value: profile,
            },
          ]
        : [],
    ),
    ...topicSnapshots.flatMap((snapshots) =>
      snapshots.map((snapshot) => ({
        id: `topics:${snapshot.snapshotId}`,
        title: 'Chủ đề corpus',
        kind: 'Phân tích đã lưu' as const,
        value: snapshot,
      })),
    ),
    ...autoresearchRuns.flatMap((runs) =>
      runs.map((run, index) => ({
        id: `autoresearch:${run.id}`,
        title: `AutoResearch · lần chạy ${index + 1}`,
        kind: 'Thiết kế nghiên cứu' as const,
        value: run,
      })),
    ),
  ];
  projectRecords.forEach((record) =>
    stringsFrom(record.value)
      .slice(0, 30)
      .forEach((chunk, index) =>
        pushEvidence(sources, {
          id: `${record.id}:${index}`,
          title: record.title,
          kind: record.kind,
          locator: chunk.path,
          text: chunk.text,
        }),
      ),
  );
  designs.forEach((design, index) => {
    if (!design) return;
    const extractionProjectId = extraction[index]?.id ?? projectId;
    stringsFrom(design)
      .slice(0, 50)
      .forEach((chunk, chunkIndex) =>
        pushEvidence(sources, {
          id: `design:${extractionProjectId}:${chunkIndex}`,
          title: 'Thiết kế nghiên cứu',
          kind: 'Thiết kế nghiên cứu',
          locator: chunk.path,
          text: chunk.text,
        }),
      );
  });

  const relevantAnalysisSummaries = rankProjectEvidence(
    analysisSummaries.map((summary) => ({
      id: `analysis-summary:${summary.id}`,
      title: summary.title ?? 'Phân tích đã lưu',
      kind: 'Phân tích đã lưu' as const,
      locator: 'Bản phân tích trong PaperLab',
      text: summary.preview,
    })),
    question,
    5,
  );
  if (relevantAnalysisSummaries.length) {
    const selectedIds = new Set(
      relevantAnalysisSummaries.map(({ id }) => id.slice('analysis-summary:'.length)),
    );
    const analyses = await repo.analyses.getMany([...selectedIds]).catch(() => []);
    for (const analysis of analyses) {
      const origin = analysis.origin;
      const paperId = origin?.kind === 'paper' ? origin.paperId : undefined;
      const summary = analysisSummaries.find(({ id }) => id === analysis.id);
      pushEvidence(sources, {
        id: `analysis:${analysis.id}`,
        title: summary?.title ?? 'Phân tích đã lưu',
        kind: 'Phân tích đã lưu',
        locator: 'Phân tích văn bản trong PaperLab',
        text: analysis.text.sourceText,
        ...(paperId ? { paperId } : {}),
      });
      stringsFrom({ paragraph: analysis.paragraph, issues: analysis.issues, scores: analysis.scores })
        .slice(0, 8)
        .forEach((chunk, index) =>
          pushEvidence(sources, {
            id: `analysis:${analysis.id}:detail:${index}`,
            title: summary?.title ?? 'Phân tích đã lưu',
            kind: 'Phân tích đã lưu',
            locator: chunk.path,
            text: chunk.text,
            ...(paperId ? { paperId } : {}),
          }),
        );
    }
  }

  return rankProjectEvidence(sources, question, MAX_SELECTED_SOURCES);
}

export function rankProjectEvidence(sources: ProjectEvidence[], question: string, limit: number) {
  const terms = queryTerms(question);
  return sources
    .map((source) => ({ source, score: score(`${source.title} ${source.locator} ${source.text}`, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.source.title.localeCompare(b.source.title))
    .slice(0, limit)
    .map(({ source }) => source);
}
