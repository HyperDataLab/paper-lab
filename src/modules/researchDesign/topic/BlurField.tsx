import { useState } from 'react';
import { TextField } from '@/shared/ui/TextField';
export function BlurField({
  label,
  value,
  save,
  placeholder,
}: {
  label: string;
  value: string;
  save: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <TextField
      label={label}
      multiline
      maxLength={4000}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) save(draft);
      }}
    />
  );
}
