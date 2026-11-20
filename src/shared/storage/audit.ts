import { AuditEventSchema, type AuditEvent } from '@/core/schemas';
import { readAudit } from './storageShared';
import type { DocStore } from './docStore';

export function createAuditRepository(store: DocStore) {
  async function list(id?: string) {
    const { values, corrupt } = await readAudit(store, id);
    return { items: values.sort((a, b) => a.at.localeCompare(b.at)), corrupt };
  }
  return {
    async latestAt(id?: string) {
      const [row] = await store.query('auditEvents', {
        where: id ? { refId: id } : undefined,
        orderBy: 'at',
        desc: true,
        limit: 1,
      });
      return row && AuditEventSchema.parse(row.doc).at;
    },
    async append(event: AuditEvent) {
      const value = AuditEventSchema.parse(event);
      await store.put('auditEvents', value.id, value, null);
    },
    listAll: () => list(),
    listByAnalysis: (id: string) => list(id),
  };
}
