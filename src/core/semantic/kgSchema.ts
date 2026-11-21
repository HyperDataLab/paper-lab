import { CONCEPTS, type Concept, type ConceptStore } from './concepts';

type KgConcept = Concept & { store: Extract<ConceptStore, { kind: 'kg' }> };
export const KG_TABLE_CONCEPTS = CONCEPTS.filter(
  (concept): concept is KgConcept => concept.store.kind === 'kg',
);

export function renderKgSchema(): string {
  const tables = new Map(KG_TABLE_CONCEPTS.map(({ id, store }) => [id, store.table]));
  return KG_TABLE_CONCEPTS.map(({ store, description, fields, relations }) => {
    const columns = fields.map(({ name, description }) => `${name} (${description})`).join(', ');
    const links = relations.flatMap(({ to, kind, via }) => {
      const table = tables.get(to);
      return table ? `${kind} ${table} via ${via}` : [];
    });
    return `${store.table}: ${description}\n  Columns: ${columns}${links.length ? `\n  Relations: ${links.join('; ')}` : ''}`;
  }).join('\n');
}

export function buildKgSqlPrompt(question: string) {
  return {
    system: [
      'Translate the question into one read-only SQLite SELECT over the lab knowledge graph below.',
      'Use only listed tables and columns. Use unqualified table names, explicit joins and readable column aliases.',
      'Non-recursive WITH clauses and SELECT subqueries are allowed. Do not use comments, table-valued functions or bind parameters.',
      'Use IN (...) for value lists or subqueries. Keep compound SELECTs to five terms or fewer.',
      'For ranked results use ORDER BY. The server limits result rows, so only add LIMIT if the question asks for a specific top count.',
      'Return sql and a short explanation in the language of the question. Explain what the query measures without assuming any results.',
      'If the schema cannot answer the question, use SELECT NULL AS answer WHERE 0 and explain which data is missing.',
      renderKgSchema(),
    ].join('\n'),
    user: question,
  };
}
