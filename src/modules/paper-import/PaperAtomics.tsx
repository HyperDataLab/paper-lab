import { useMemo, useState } from 'react';
import { reviewedProfile } from '@/core/measurement';
import type { FindingLocation } from '@/core/paperFindings';
import type { AtomicSentence, MeasurementsRecord, Paper } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import styles from './atomics.module.css';

type Role = AtomicSentence['role'];
const ROLES: { id: Role; label: string }[] = [
  { id: 'background', label: 'Background' },
  { id: 'method', label: 'Method' },
  { id: 'finding', label: 'Finding' },
  { id: 'limitation', label: 'Limitation' },
];

/**
 * The paper broken into atomic sentences: one checkable statement each, with its role and the passage it
 * comes from. They are what the measurement's claims and results point to, listed here by section.
 */
export function PaperAtomics({
  paper,
  record,
  onLocation,
  onOpen,
}: {
  paper: Paper;
  record: MeasurementsRecord | undefined;
  onLocation: (location: FindingLocation) => void;
  onOpen: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>(ROLES.map((item) => item.id));
  const profile = useMemo(() => {
    const run = record?.runs.at(-1);
    return run && record ? reviewedProfile(run.profile, record.decisions, run.id) : undefined;
  }, [record]);
  const atomics = profile?.atomic_sentences ?? [];
  if (!profile || atomics.length === 0)
    return (
      <Card padding="md">
        <div className={styles.empty}>
          <p>
            Chưa có atomic sentences. Chúng được tách khi chạy Evidence & measurement: mỗi câu là một ý kiểm
            được, kèm vai trò và câu gốc trong bài.
          </p>
          <Button size="sm" onClick={onOpen}>
            Mở Evidence & measurement
          </Button>
        </div>
      </Card>
    );
  const evidence = new Map(profile.evidence.map((item) => [item.id, item]));
  const shown = atomics.filter((item) => roles.includes(item.role));
  const sections = paper.sections
    .map((section) => ({ section, items: shown.filter((item) => item.section_id === section.id) }))
    .filter((group) => group.items.length > 0);
  const orphans = shown.filter((item) => !paper.sections.some((section) => section.id === item.section_id));
  const open = (item: AtomicSentence) => {
    const source = evidence.get(item.evidence_id);
    if (source)
      onLocation({ paragraphId: source.blockId, start: source.span?.start ?? 0, end: source.span?.end ?? 1 });
  };
  const row = (item: AtomicSentence) => (
    <li key={item.id} className={styles.item}>
      <span className={styles.role} data-role={item.role}>
        {ROLES.find((role) => role.id === item.role)?.label}
      </span>
      <span className={styles.text}>{item.text}</span>
      <span className={styles.meta}>
        {item.needs_review && <Badge tone="warning">Cần duyệt</Badge>}
        {item.human_checked && <Badge tone="success">Đã kiểm</Badge>}
        {evidence.has(item.evidence_id) && (
          <Button size="sm" variant="ghost" onClick={() => open(item)}>
            {item.page ? `Tr. ${item.page}` : 'Câu gốc'}
          </Button>
        )}
      </span>
    </li>
  );
  return (
    <Card padding="md">
      <div className={styles.atomics}>
        <div className={styles.filters} role="group" aria-label="Lọc theo vai trò">
          {ROLES.map((role) => (
            <Chip
              key={role.id}
              aria-pressed={roles.includes(role.id)}
              count={atomics.filter((item) => item.role === role.id).length}
              onClick={() =>
                setRoles((old) =>
                  old.includes(role.id) ? old.filter((item) => item !== role.id) : [...old, role.id],
                )
              }
            >
              {role.label}
            </Chip>
          ))}
        </div>
        <p className={styles.count}>
          {shown.length}/{atomics.length} atomic sentences
        </p>
        {sections.map(({ section, items }) => (
          <section key={section.id} aria-label={section.heading} className={styles.group}>
            <h3>{section.heading}</h3>
            <ol className={styles.list}>{items.map(row)}</ol>
          </section>
        ))}
        {orphans.length > 0 && (
          <section aria-label="Không rõ section" className={styles.group}>
            <h3>Không rõ section</h3>
            <ol className={styles.list}>{orphans.map(row)}</ol>
          </section>
        )}
      </div>
    </Card>
  );
}
