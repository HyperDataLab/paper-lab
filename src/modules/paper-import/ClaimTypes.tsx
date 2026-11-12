import { CLAIM_TYPES, CLAIM_TYPE_INFO, type ClaimType } from '@/core/argument/claimTypes';
import { Badge } from '@/shared/ui/Badge';
import { Chip } from '@/shared/ui/Chip';

export function ClaimTypeBadge({ type }: { type: ClaimType | null }) {
  if (!type) return null;
  const info = CLAIM_TYPE_INFO[type];
  return (
    <span title={info.needs}>
      <Badge>{info.vi}</Badge>
    </span>
  );
}

export function ClaimTypeFilter({
  types,
  value,
  onChange,
}: {
  types: (ClaimType | null)[];
  value: ClaimType | null;
  onChange: (value: ClaimType | null) => void;
}) {
  const present = CLAIM_TYPES.filter((type) => types.includes(type));
  if (!present.length) return null;
  return (
    <div role="group" aria-label="Loại claim">
      <span>Loại claim </span>
      <Chip aria-pressed={value === null} onClick={() => onChange(null)}>
        Tất cả
      </Chip>{' '}
      {present.map((type) => (
        <Chip key={type} aria-pressed={value === type} onClick={() => onChange(type)}>
          {CLAIM_TYPE_INFO[type].vi}
        </Chip>
      ))}
    </div>
  );
}
