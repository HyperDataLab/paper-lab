import { z } from 'zod';
import { CorpusProfileV2Schema } from '../schemas/corpusProfileV2';

export const CORPUS_PROFILE_V2_SCHEMA_FILE = 'schemas/corpus-profile-v2.draft.schema.json';
export const CORPUS_PROFILE_V2_PUBLIC_FILE = 'public/schemas/corpus-profile-v2.draft.schema.json';

export function corpusProfileV2JsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(CorpusProfileV2Schema, {
    io: 'output',
    target: 'draft-2020-12',
  });
  return {
    $schema,
    $id: 'https://hyperdatalab-paragraph-lab.web.app/schemas/corpus-profile-v2.draft.schema.json',
    title: 'PaperLab corpus profile v2 DRAFT',
    description: 'DRAFT contract for Writing Bank mapping; the shape may change until P2 ships.',
    $comment: 'DRAFT: synthetic fixture only; no v2 measurement implementation is implied.',
    ...rest,
  };
}
