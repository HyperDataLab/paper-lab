import { z } from 'zod';
import { COLLECTION_NAMES, DOC_INDEX_FIELDS } from '../../../src/core/storage/collections';
import type { SqlValue } from '../kg/bindings';
import { INDEX_COLUMN } from './indexColumns';

export const ORDER_COLUMN = {
  updatedAt: "COALESCE(json_extract(summary_json, '$.updatedAt'), updated_at)",
  createdAt: "COALESCE(json_extract(summary_json, '$.createdAt'), created_at)",
  title: "COALESCE(title, '')",
  id: 'id',
  at: "COALESCE(json_extract(summary_json, '$.at'), '')",
  topicId: "COALESCE(json_extract(summary_json, '$.topicId'), -1)",
} as const;

export const filterSchema = {
  where: z.partialRecord(z.enum(DOC_INDEX_FIELDS), z.string().nullable()).default({}),
  whereIn: z
    .strictObject({ field: z.enum(DOC_INDEX_FIELDS), values: z.array(z.string().max(300)).max(500) })
    .optional(),
  orderBy: z.enum(Object.keys(ORDER_COLUMN) as (keyof typeof ORDER_COLUMN)[]).default('updatedAt'),
  desc: z.boolean().default(false),
};

export const collectionSchema = z.enum(COLLECTION_NAMES);

export const queryGuardSchema = z.strictObject({
  ...filterSchema,
  collection: collectionSchema,
  limit: z.number().int().nonnegative().optional(),
  rows: z.array(z.tuple([z.string(), z.number().int().positive()])),
});
export type QueryGuard = z.output<typeof queryGuardSchema>;

export function queryPlan(
  request: Omit<QueryGuard, 'rows' | 'limit'>,
  includeDeleted = false,
  projectId?: string,
) {
  const conditions = ['collection = ?'];
  const values: SqlValue[] = [request.collection];
  if (projectId) {
    conditions.push('hub_project_id = ?');
    values.push(projectId);
  }
  if (!includeDeleted) conditions.push('deleted_at IS NULL');
  for (const [field, expected] of Object.entries(request.where) as [
    keyof typeof INDEX_COLUMN,
    string | null,
  ][]) {
    if (expected === null) conditions.push(`${INDEX_COLUMN[field]} IS NULL`);
    else {
      conditions.push(`${INDEX_COLUMN[field]} = ?`);
      values.push(expected);
    }
  }
  if (request.whereIn) {
    const { field, values: members } = request.whereIn;
    conditions.push(`${INDEX_COLUMN[field]} IN (SELECT value FROM json_each(?))`);
    values.push(JSON.stringify(members));
  }
  const order = ORDER_COLUMN[request.orderBy];
  const direction = request.desc ? 'DESC' : 'ASC';
  return { conditions, values, order, ordering: `${order} ${direction}, id ${direction}` };
}
