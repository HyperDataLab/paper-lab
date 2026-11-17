import { EVIDENCE_LEVEL_INFO, type EvidenceLevel } from '@/core/argument/evidenceLevels';
import { Badge } from '@/shared/ui/Badge';

/** A machine label, shown only when the arguments pass gave one. */
export function EvidenceLevelBadge({
  level,
  basis,
}: {
  level?: EvidenceLevel | null;
  basis?: string | null;
}) {
  if (!level) return null;
  const title = [`AI gán. ${EVIDENCE_LEVEL_INFO[level].vi}`, basis && `Căn cứ: ${basis}`]
    .filter(Boolean)
    .join('\n');
  return (
    <span title={title}>
      <Badge>Mức bằng chứng {level}</Badge>
    </span>
  );
}
