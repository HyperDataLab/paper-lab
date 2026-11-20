import { AuditEventSchema, CalibrationLabelsSchema, CalibrationLabelSetSchema } from '@/core/schemas';
import type { DocStore, DocTx } from './docStore';
import type { StorageDeps } from './storageShared';

const collection = 'calibrationLabels';
const EPOCH = '1970-01-01T00:00:00.000Z';

/** The latest `importedAt`, from summaries: the lab server cannot order by it. */
async function lastImport(tx: DocTx) {
  const rows = await tx.query(collection, { select: 'summary' });
  return rows.reduce((last, row) => {
    const at = (row.doc as { importedAt?: unknown }).importedAt;
    return typeof at === 'string' && at > last ? at : last;
  }, EPOCH);
}

export function createCalibrationLabelsRepository(store: DocStore, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  return {
    async import(sourceFileName: string, data: unknown) {
      const parsed = CalibrationLabelsSchema.parse(data);
      return store.unitOfWork(
        async (tx) => {
          // The audit trail lives in this browser unless the transaction appends it to the lab store.
          const [lastAudit] = tx.appendAudit
            ? []
            : await tx.query('auditEvents', { orderBy: 'at', desc: true, limit: 1 });
          const at = new Date(
            Math.max(
              Date.parse(now()),
              Date.parse((lastAudit?.doc as { at?: string } | undefined)?.at ?? EPOCH) + 1,
              Date.parse(await lastImport(tx)) + 1,
            ),
          ).toISOString();
          const value = CalibrationLabelSetSchema.parse({
            schemaVersion: 1,
            id: ids(),
            sourceFileName,
            importedAt: at,
            data: parsed,
          });
          await tx.put(collection, value.id, value, null);
          const audit = AuditEventSchema.parse({ ...makeAudit(value.id, 'import_labels', 'human'), at });
          if (tx.appendAudit) await tx.appendAudit(audit.id, audit);
          else await tx.put('auditEvents', audit.id, audit, null);
          return value;
        },
        [collection],
      );
    },
    async list() {
      return (await store.query(collection))
        .map((row) => CalibrationLabelSetSchema.parse(row.doc))
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    },
    async delete(id: string) {
      await store.remove(collection, id);
    },
  };
}
