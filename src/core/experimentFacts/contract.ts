import { z } from 'zod';
import { fixturePaper, fixtureRun } from '../measurement/testFixture';
import { examplePaperModel } from '../paperModel/contract';
import { ExperimentFactsSchema } from '../schemas';
import { projectExperimentFacts } from './project';

export const EXPERIMENT_FACTS_SCHEMA_ID =
  'https://hyperdatalab-paragraph-lab.web.app/schemas/experiment-facts-v1.schema.json';
export const EXPERIMENT_FACTS_SCHEMA_FILE = 'schemas/experiment-facts-v1.schema.json';
export const EXPERIMENT_FACTS_SCHEMA_PUBLIC_FILE = 'public/schemas/experiment-facts-v1.schema.json';
export const EXPERIMENT_FACTS_EXAMPLE_FILE = 'examples/experiment-facts.example.json';

export function experimentFactsJsonSchema() {
  const { $schema, ...rest } = z.toJSONSchema(ExperimentFactsSchema, {
    io: 'output',
    target: 'draft-2020-12',
  });
  return { $schema, $id: EXPERIMENT_FACTS_SCHEMA_ID, title: 'PaperLab experiment facts, version 1', ...rest };
}

export function exampleExperimentFacts() {
  const run = fixtureRun();
  return projectExperimentFacts({
    paperId: fixturePaper.id,
    modelEtag: 'a'.repeat(64),
    model: examplePaperModel(),
    paper: fixturePaper,
    record: {
      schemaVersion: 1,
      paperId: fixturePaper.id,
      updatedAt: run.createdAt,
      runs: [run],
      decisions: [],
      pending: null,
    },
    now: new Date('2026-11-11T00:00:00.000Z'),
  }).facts;
}
