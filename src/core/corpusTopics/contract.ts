import { z } from 'zod';
import { CorpusTopicsSchema } from '../schemas/corpusTopics';

export const CORPUS_TOPICS_SCHEMA_FILE = 'schemas/corpus-topics-v1.schema.json';
export const CORPUS_TOPICS_SCHEMA_PUBLIC_FILE = 'public/schemas/corpus-topics-v1.schema.json';
export function corpusTopicsJsonSchema() {
  const { $schema, ...rest } = z.toJSONSchema(CorpusTopicsSchema, { io: 'output', target: 'draft-2020-12' });
  return {
    $schema,
    $id: 'https://hyperdatalab-paragraph-lab.web.app/schemas/corpus-topics-v1.schema.json',
    title: 'PaperLab corpus topics, version 1',
    ...rest,
  };
}
