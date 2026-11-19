export type SqlValue = string | number | null;

export interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T>(statements: D1Statement[]): Promise<{ results: T[]; meta: { changes: number } }[]>;
}

export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

export interface KgBindings {
  KG?: D1Database;
  KG_VECTORS?: {
    upsert(
      vectors: { id: string; values: number[]; metadata: { year?: number; subfieldId?: string } }[],
    ): Promise<unknown>;
    query(vector: number[], options: { topK: number }): Promise<{ matches: { id: string; score: number }[] }>;
  };
  AI?: {
    run(model: typeof EMBEDDING_MODEL, input: { text: string[] }): Promise<{ data?: number[][] }>;
  };
  OPENALEX_MAILTO?: string;
  OPENALEX_API_KEY?: string;
}

export function configuredKg(bindings: KgBindings | undefined) {
  if (!bindings?.KG || !bindings.KG_VECTORS || !bindings.AI) return null;
  return {
    db: bindings.KG,
    vectors: bindings.KG_VECTORS,
    ai: bindings.AI,
    mailto: bindings.OPENALEX_MAILTO,
    apiKey: bindings.OPENALEX_API_KEY,
  };
}

export type ConfiguredKg = NonNullable<ReturnType<typeof configuredKg>>;
