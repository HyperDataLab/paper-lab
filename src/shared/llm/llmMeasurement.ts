import type { z } from 'zod';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import {
  applyFindings,
  applyLinks,
  buildProfile,
  planExtraction,
  type ExtractionUnit,
} from '@/core/measurement';
import {
  buildClassifyPrompt,
  buildExtractionPrompt,
  buildFindingsPrompt,
  buildLinkPrompt,
  PROMPT_VERSIONS,
} from '@/core/prompts';
import {
  ClassifyOutputSchema,
  ExtractionOutputSchema,
  FindingsOutputSchema,
  LinkOutputSchema,
  type MeasurementCheckpointSchema,
  type Paper,
} from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { ConsentRequiredError } from './errors';

/** A whole section with the full output schema can take the model well over a minute. */
const EXTRACTION_TIMEOUT_MS = 180000;

export const MEASUREMENT_PROMPT_VERSION = [
  PROMPT_VERSIONS.measurementClassify,
  PROMPT_VERSIONS.measurementExtract,
  PROMPT_VERSIONS.measurementLink,
  PROMPT_VERSIONS.measurementFindings,
].join('+');

/** Progress kept between runs, so a stopped analysis resumes without paying twice. */
export type MeasurementCheckpoint = z.infer<typeof MeasurementCheckpointSchema>;
export const emptyCheckpoint = (): MeasurementCheckpoint => ({
  classification: null,
  units: {},
  link: null,
  findings: null,
  model: null,
});

export interface MeasurementOptions {
  sectionIds: string[];
  config: LlmConfig;
  budget: number;
  callsUsed?: number;
  checkpoint?: MeasurementCheckpoint;
  onRequest: (callsUsed: number) => Promise<void>;
  onCheckpoint?: (checkpoint: MeasurementCheckpoint) => Promise<void>;
  onUnit?: (done: number, total: number) => void;
  signal?: AbortSignal;
  now?: () => string;
}

function isFatal(cause: unknown) {
  return (
    cause instanceof BatchBudgetExceededError ||
    cause instanceof ConsentRequiredError ||
    (cause instanceof DOMException && cause.name === 'AbortError')
  );
}

function classificationSource(paper: Paper, units: ExtractionUnit[]) {
  const roles = ['abstract', 'introduction', 'methods'];
  const preferred = units
    .flatMap((unit) => unit.blocks)
    .filter((block) => {
      const section = paper.sections.find((item) => item.id === block.sectionId);
      return section && roles.includes(section.role);
    });
  const source = preferred.length ? preferred : units.flatMap((unit) => unit.blocks);
  const blocks = [];
  let size = 0;
  for (const block of source) {
    if (size + block.text.length > 12000 && blocks.length) break;
    blocks.push(block);
    size += block.text.length;
  }
  return blocks;
}

export async function llmMeasurement(client: LlmClient, paper: Paper, options: MeasurementOptions) {
  requirePaperConsent(options.config);
  const units = planExtraction(paper, options.sectionIds);
  if (!units.length) throw new Error('Không có mục nào để phân tích.');
  let callsUsed = options.callsUsed ?? 0;
  const checkpoint = options.checkpoint ?? emptyCheckpoint();
  const onRequest = async () => {
    requirePaperConsent(options.config);
    if (callsUsed >= options.budget) throw new BatchBudgetExceededError();
    callsUsed++;
    await options.onRequest(callsUsed);
  };
  if (!checkpoint.classification) {
    const blocks = classificationSource(paper, units);
    const result = await client.completeJson({
      ...buildClassifyPrompt(paper, blocks, [...new Set(blocks.map((block) => block.sectionId))]),
      schema: ClassifyOutputSchema,
      schemaName: 'measurement_classification',
      promptVersion: PROMPT_VERSIONS.measurementClassify,
      temperature: 0.1,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
      onRequest,
      signal: options.signal,
    });
    checkpoint.classification = ClassifyOutputSchema.parse(result.data);
    checkpoint.model = result.meta.model;
    await options.onCheckpoint?.(checkpoint);
  }
  const classification = checkpoint.classification;
  const failed = new Set<string>();
  const extract = async (unit: ExtractionUnit) => {
    try {
      const result = await client.completeJson({
        ...buildExtractionPrompt(paper, unit, classification.paper_type),
        schema: ExtractionOutputSchema,
        schemaName: 'measurement_extraction',
        promptVersion: PROMPT_VERSIONS.measurementExtract,
        temperature: 0.1,
        timeoutMs: EXTRACTION_TIMEOUT_MS,
        onRequest,
        signal: options.signal,
      });
      checkpoint.units[unit.id] = ExtractionOutputSchema.parse(result.data);
      checkpoint.model = result.meta.model;
      failed.delete(unit.id);
      // New sections change what can be linked, so these two steps are redone on resume.
      checkpoint.link = null;
      checkpoint.findings = null;
      await options.onCheckpoint?.(checkpoint);
    } catch (cause) {
      if (isFatal(cause)) throw cause;
      failed.add(unit.id);
    }
  };
  for (const [index, unit] of units.entries()) {
    if (!checkpoint.units[unit.id]) await extract(unit);
    options.onUnit?.(index + 1, units.length);
  }
  // A failure is usually a slow or dropped response, so each failed part gets one more attempt.
  for (const unit of units) if (failed.has(unit.id)) await extract(unit);
  let profile = buildProfile({
    paper,
    selectedSectionIds: options.sectionIds,
    classification,
    units: units.map((unit) => ({
      unit,
      output: failed.has(unit.id) ? null : (checkpoint.units[unit.id] ?? null),
    })),
    model: checkpoint.model ?? options.config.model,
    promptVersion: MEASUREMENT_PROMPT_VERSION,
    generatedAt: options.now?.() ?? new Date().toISOString(),
  });
  const step = async <T>(
    current: T | null,
    run: () => Promise<T>,
    save: (value: T) => void,
    apply: (value: T) => typeof profile,
    mark: 'link' | 'findings',
  ) => {
    let value = current;
    try {
      if (value === null) {
        value = await run();
        save(value);
        await options.onCheckpoint?.(checkpoint);
      }
      profile = { ...apply(value), steps: { ...profile.steps, [mark]: 'done' } };
    } catch (cause) {
      if (isFatal(cause)) throw cause;
      profile = { ...profile, status: 'partial', steps: { ...profile.steps, [mark]: 'failed' } };
    }
  };
  await step(
    checkpoint.link,
    async () =>
      LinkOutputSchema.parse(
        (
          await client.completeJson({
            ...buildLinkPrompt(profile),
            schema: LinkOutputSchema,
            schemaName: 'measurement_links',
            promptVersion: PROMPT_VERSIONS.measurementLink,
            temperature: 0.1,
            timeoutMs: EXTRACTION_TIMEOUT_MS,
            onRequest,
            signal: options.signal,
          })
        ).data,
      ),
    (value) => {
      checkpoint.link = value;
    },
    (value) => applyLinks(profile, value),
    'link',
  );
  await step(
    checkpoint.findings,
    async () =>
      FindingsOutputSchema.parse(
        (
          await client.completeJson({
            ...buildFindingsPrompt(profile),
            schema: FindingsOutputSchema,
            schemaName: 'measurement_findings',
            promptVersion: PROMPT_VERSIONS.measurementFindings,
            temperature: 0.2,
            timeoutMs: EXTRACTION_TIMEOUT_MS,
            onRequest,
            signal: options.signal,
          })
        ).data,
      ),
    (value) => {
      checkpoint.findings = value;
    },
    (value) => applyFindings(profile, value),
    'findings',
  );
  return { profile, callsUsed, failedUnits: [...failed], checkpoint };
}
