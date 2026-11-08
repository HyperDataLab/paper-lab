import { buildSentenceAnnotations, validateSyntaxOutput } from '@/core/analysis';
import { applyJudgement, detectCandidates, DETECTOR_VERSION, mergeHumanDecisions } from '@/core/detectors';
import { paragraphIssues } from '@/core/paragraph/issues';
import { computeParagraphMetrics } from '@/core/paragraph/metrics';
import { validateParagraphStructure } from '@/core/paragraph/validateParagraphStructure';
import {
  buildCandidateJudgePrompt,
  buildParagraphStructurePrompt,
  buildScoringPrompt,
  buildSentenceSyntaxPrompt,
  CandidateJudgeOutputSchema,
  ParagraphStructureOutputSchema,
  PROMPT_VERSIONS,
  ScoringOutputSchema,
  SentenceSyntaxOutputSchema,
  type PaperContext,
} from '@/core/prompts';
import type { Analysis, BatchStep, Paper, PaperParagraph, PaperRun } from '@/core/schemas';
import { assessability } from '@/core/scoring/availability';
import { computeScores } from '@/core/scoring/computeScores';
import { buildEvidencePackages } from '@/core/scoring/evidencePackage';
import { DIMENSIONS, RUBRIC_VERSION } from '@/core/scoring/rubric';
import { analyzeText } from '@/core/text/analyzeText';
import type { Repositories } from '@/shared/storage/repositories';
import type { LlmClient } from './client';

export const PAPER_PROMPT_VERSIONS = {
  syntax: PROMPT_VERSIONS.sentenceSyntaxPaper,
  judge: PROMPT_VERSIONS.candidateJudgePaper,
  structure: PROMPT_VERSIONS.paragraphStructurePaper,
  score: PROMPT_VERSIONS.scoringPaper,
};

export function createPaperParagraphAnalyzer(client: LlmClient, repositories: Repositories, paper: Paper) {
  async function findCached(paragraph: PaperParagraph, run: PaperRun): Promise<string | null> {
    const analyses = await repositories.analyses.listByPaper(paper.id);
    const found = analyses.find((analysis) => {
      if (
        analysis.origin?.kind !== 'paper' ||
        analysis.origin.paragraphId !== paragraph.id ||
        analysis.text.sourceHash !== paragraph.textHash
      )
        return false;
      const versions = {
        syntax: analysis.versions.syntaxProvider,
        judge: analysis.versions.judgePrompt,
        structure: analysis.versions.structurePrompt,
        score: analysis.versions.scoringPrompt,
      };
      return run.plan.steps.every((step) => versions[step] === run.promptVersions[step]);
    });
    return found?.id ?? null;
  }
  async function analyze(
    paragraph: PaperParagraph,
    context: PaperContext,
    step: BatchStep | 'detectors',
    analysisId: string | null,
    onRepair?: () => void,
  ): Promise<string> {
    let current = analysisId ? await repositories.analyses.get(analysisId) : undefined;
    if (!current) {
      const text = await analyzeText(paragraph.text);
      const existing = (await repositories.analyses.listByPaper(paper.id)).find(
        (a) =>
          a.origin?.kind === 'paper' &&
          a.origin.paragraphId === paragraph.id &&
          a.text.sourceHash === text.sourceHash,
      );
      current =
        existing ??
        (await repositories.analyses.create({
          text,
          title: `${context.heading} · ${paragraph.id}`,
          origin: { kind: 'paper', paperId: paper.id, paragraphId: paragraph.id },
          context: { before: context.previousLast, after: context.nextFirst, audience: null },
          contextLimited: !context.previousLast || !context.nextFirst,
        }));
    }
    const analysis: Analysis = current;
    const versions = { ...analysis.versions };
    if (step === 'detectors') {
      await repositories.analyses.update(analysis.id, {
        title: `${context.heading} · ${paragraph.id}`,
        context: { before: context.previousLast, after: context.nextFirst, audience: null },
        contextLimited: !context.previousLast || !context.nextFirst,
        issues: mergeHumanDecisions(
          detectCandidates(analysis.text, analysis.sentenceAnnotations),
          analysis.issues,
        ),
        versions: { ...versions, detectors: DETECTOR_VERSION },
      });
    } else if (step === 'syntax') {
      const result = await client.completeJson({
        ...buildSentenceSyntaxPrompt(analysis.text, analysis.text.sentences, context),
        schema: SentenceSyntaxOutputSchema,
        schemaName: 'sentence_syntax',
        promptVersion: PAPER_PROMPT_VERSIONS.syntax,
        temperature: 0,
      });
      if (result.meta.repaired) onRepair?.();
      const sentenceAnnotations = buildSentenceAnnotations(
        analysis.text,
        validateSyntaxOutput(result.data.sentences, analysis.text),
      );
      await repositories.analyses.update(analysis.id, {
        sentenceAnnotations,
        issues: mergeHumanDecisions(detectCandidates(analysis.text, sentenceAnnotations), analysis.issues),
        versions: { ...versions, syntaxProvider: PAPER_PROMPT_VERSIONS.syntax, model: result.meta.model },
      });
    } else if (step === 'judge') {
      const result = await client.completeJson({
        ...buildCandidateJudgePrompt(
          analysis.text,
          analysis.sentenceAnnotations,
          analysis.issues,
          analysis.context,
          true,
          context,
        ),
        schema: CandidateJudgeOutputSchema,
        schemaName: 'candidate_judgement',
        promptVersion: PAPER_PROMPT_VERSIONS.judge,
        temperature: 0,
      });
      if (result.meta.repaired) onRepair?.();
      await repositories.analyses.update(analysis.id, {
        issues: mergeHumanDecisions(
          applyJudgement(analysis.issues, result.data, analysis.text, analysis.sentenceAnnotations),
          analysis.issues,
        ),
        versions: { ...versions, judgePrompt: PAPER_PROMPT_VERSIONS.judge, model: result.meta.model },
      });
    } else if (step === 'structure') {
      const result = await client.completeJson({
        ...buildParagraphStructurePrompt(
          analysis.text,
          analysis.sentenceAnnotations,
          analysis.context,
          context,
        ),
        schema: ParagraphStructureOutputSchema,
        schemaName: 'paragraph_structure',
        promptVersion: PAPER_PROMPT_VERSIONS.structure,
        temperature: 0,
      });
      if (result.meta.repaired) onRepair?.();
      const structure = validateParagraphStructure(result.data, analysis.text, analysis.sentenceAnnotations);
      const sentenceAnnotations = analysis.sentenceAnnotations.map((annotation) => {
        const role = structure.roles.find((item) => item.sentenceId === annotation.sentenceId);
        return {
          ...annotation,
          role: role?.role ?? null,
          roleConfidence: role?.confidence ?? null,
          roleRationale: role?.rationale ?? null,
        };
      });
      const issues = paragraphIssues(
        structure.paragraph,
        structure.flowLinks,
        analysis.text,
        structure.roles,
      );
      await repositories.analyses.update(analysis.id, {
        paragraph: structure.paragraph,
        flowLinks: structure.flowLinks,
        paragraphMetrics: computeParagraphMetrics(structure.paragraph, structure.roles, structure.flowLinks),
        sentenceAnnotations,
        issues: mergeHumanDecisions(
          [
            ...analysis.issues.filter(
              (issue) => issue.category !== 'flow' && issue.category !== 'organization',
            ),
            ...issues,
          ],
          analysis.issues,
        ),
        versions: {
          ...versions,
          structurePrompt: PAPER_PROMPT_VERSIONS.structure,
          structureModel: result.meta.model,
        },
      });
    } else {
      const availability = assessability(analysis);
      const result = await client.completeJson({
        ...buildScoringPrompt(
          analysis.text,
          buildEvidencePackages(analysis, availability),
          DIMENSIONS.filter((item) => availability[item.id].applicable),
          analysis.context,
          context,
        ),
        schema: ScoringOutputSchema,
        schemaName: 'scoring',
        promptVersion: PAPER_PROMPT_VERSIONS.score,
        temperature: 0,
      });
      if (result.meta.repaired) onRepair?.();
      const scores = computeScores(result.data, availability, analysis.issues, {
        sentenceIds: analysis.text.sentences.map((s) => s.id),
        contextLimited: analysis.contextLimited,
      });
      await repositories.analyses.update(analysis.id, {
        scores,
        versions: {
          ...versions,
          rubric: RUBRIC_VERSION,
          scoringPrompt: PAPER_PROMPT_VERSIONS.score,
          scoringModel: result.meta.model,
        },
      });
    }
    return analysis.id;
  }
  return { analyze, findCached };
}
