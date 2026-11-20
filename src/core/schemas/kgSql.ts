import { z } from 'zod';

export const KG_SQL_MAX_BYTES = 100_000;
export const KG_SQL_DEFAULT_LIMIT = 100;
export const KG_SQL_MAX_LIMIT = 1_000;

const sql = z.string().min(1).max(KG_SQL_MAX_BYTES);
export const KgSqlRequestSchema = z.strictObject({
  sql,
  limit: z.number().int().min(1).max(KG_SQL_MAX_LIMIT).default(KG_SQL_DEFAULT_LIMIT),
});

export const KgSqlOutputSchema = z.strictObject({
  sql,
  explanation: z.string().min(1),
});
export type KgSqlOutput = z.infer<typeof KgSqlOutputSchema>;

const cell = z.union([z.string(), z.number(), z.null(), z.array(z.number().int().min(0).max(255))]);
export const KgSqlResultSchema = z.object({
  sql,
  columns: z.array(z.string()),
  rows: z.array(z.array(cell)).max(KG_SQL_MAX_LIMIT),
  truncated: z.boolean(),
  concepts: z.array(z.string()),
});
export type KgSqlResult = z.infer<typeof KgSqlResultSchema>;
