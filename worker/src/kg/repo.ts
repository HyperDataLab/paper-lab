import type { mapOpenAlexWorkToKg } from '../../../src/core/labKg';
import { normalizeDoi } from '../../../src/core/library/doi';
import type { ScgPaperPublish } from '../../../src/core/scg/publish';
import type { D1Database, D1Statement, SqlValue } from './bindings';
import { enqueueStatement } from './queue';
import { KG_DEFAULT_DEPTH } from '../../../src/core/schemas/labKg';

type GraphRows = ReturnType<typeof mapOpenAlexWorkToKg>;

function upserts(db: D1Database, table: string, keys: string[], rows: Record<string, SqlValue>[]) {
  const first = rows[0];
  if (!first) return [];
  const columns = Object.keys(first);
  const values = `(${columns.map(() => '?').join(', ')})`;
  const updates = columns.filter((column) => !keys.includes(column));
  const conflict = updates.length
    ? `UPDATE SET ${updates.map((column) => `${column} = excluded.${column}`).join(', ')}
       WHERE ${updates.map((column) => `${table}.${column} IS NOT excluded.${column}`).join(' OR ')}`
    : 'NOTHING';
  const batchSize = Math.floor(100 / columns.length);
  const statements: D1Statement[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    statements.push(
      db
        .prepare(
          `INSERT INTO ${table} (${columns.join(', ')})
      VALUES ${batch.map(() => values).join(', ')} ON CONFLICT (${keys.join(', ')}) DO ${conflict}`,
        )
        .bind(...batch.flatMap((row) => columns.map((column) => row[column] ?? null))),
    );
  }
  return statements;
}

export function kgRepo(db: D1Database) {
  return {
    async upsertWork({ nodes, edges }: GraphRows) {
      const { paper, ...otherNodes } = nodes;
      const statements = Object.entries(otherNodes).flatMap(([table, rows]) =>
        upserts(db, table, ['id'], rows),
      );
      statements.push(...upserts(db, 'paper', ['id'], [paper]));

      // Remove only memberships no longer present so pair counts and FTS postings do not churn on retries.
      const replace = (table: string, key: string, rows: Record<string, SqlValue>[]) => {
        statements.push(
          db
            .prepare(
              `DELETE FROM ${table} WHERE paper_id = ?
          AND ${key} NOT IN (SELECT value FROM json_each(?))`,
            )
            .bind(paper.id, JSON.stringify(rows.map((row) => row[key]))),
        );
        statements.push(...upserts(db, table, ['paper_id', key], rows));
      };
      replace('has_keyword', 'keyword_id', edges.has_keyword);
      replace('cites', 'target_id', edges.cites);
      replace('related_to', 'target_id', edges.related_to);
      replace('authored', 'author_id', edges.authored);
      replace('has_topic', 'topic_id', edges.has_topic);
      statements.push(
        db
          .prepare(
            `DELETE FROM affiliated WHERE paper_id = ?
        AND json_array(author_id, institution_id) NOT IN (SELECT value FROM json_each(?))`,
          )
          .bind(
            paper.id,
            JSON.stringify(
              edges.affiliated.map(({ author_id, institution_id }) => [author_id, institution_id]),
            ),
          ),
      );
      statements.push(
        ...upserts(db, 'affiliated', ['paper_id', 'author_id', 'institution_id'], edges.affiliated),
      );
      statements.push(...upserts(db, 'subfield_of', ['topic_id'], edges.subfield_of));
      statements.push(...upserts(db, 'field_of', ['subfield_id'], edges.field_of));
      statements.push(...upserts(db, 'domain_of', ['field_id'], edges.domain_of));
      await db.batch(statements);
    },

    async upsertScg(graph: ScgPaperPublish, doi: string | null, at: string) {
      const { paperId, contributions } = graph;
      const statements = [
        db.prepare('DELETE FROM builds_on WHERE published_paper_id = ?').bind(paperId),
        db
          .prepare(
            `DELETE FROM contribution WHERE published_paper_id = ?
          AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .bind(paperId, JSON.stringify(contributions.map(({ id }) => id))),
      ];
      statements.push(
        ...upserts(
          db,
          'contribution',
          ['published_paper_id', 'id'],
          contributions.map((item) => ({
            id: item.id,
            published_paper_id: paperId,
            paper_doi: doi,
            name: item.name,
            description: item.description,
            review: item.review,
            body: JSON.stringify(item),
          })),
        ),
      );
      const links = contributions.flatMap((item) =>
        item.prerequisites.flatMap((prerequisite) => {
          const link = (kind: string, target: string, relation: string, review = prerequisite.review) => ({
            published_paper_id: paperId,
            contribution_id: item.id,
            prerequisite_id: prerequisite.id,
            target_kind: kind,
            target_id: target,
            relation,
            review,
          });
          return [
            link('prerequisite', prerequisite.id, 'prerequisite'),
            ...prerequisite.matches.map((match) =>
              link('contribution', match.contributionId, 'match', match.review),
            ),
            ...prerequisite.references.map((ref, index) =>
              link(
                ref.kind,
                ref.kind === 'contribution'
                  ? ref.contributionId
                  : ref.kind === 'tool'
                    ? ref.url
                    : (normalizeDoi(ref.doi ?? '') ??
                      (ref.s2CorpusId
                        ? `s2:${ref.s2CorpusId}`
                        : ref.refId
                          ? `${paperId}:${ref.refId}`
                          : `${prerequisite.id}:${index}`)),
                'reference',
              ),
            ),
          ];
        }),
      );
      statements.push(
        ...upserts(
          db,
          'builds_on',
          [
            'published_paper_id',
            'contribution_id',
            'prerequisite_id',
            'target_kind',
            'target_id',
            'relation',
          ],
          links,
        ),
      );
      if (doi) statements.push(enqueueStatement(db, [doi], KG_DEFAULT_DEPTH, 'seed', at));
      await db.batch(statements);
    },
  };
}
