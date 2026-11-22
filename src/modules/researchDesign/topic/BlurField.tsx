import { useLayoutEffect, useRef, useState } from 'react';
import { TextField } from '@/shared/ui/TextField';
export function BlurField({
  label,
  labelPrefix,
  value,
  save,
  placeholder,
  id,
  rows = 2,
  maxRows = 8,
  multiline = true,
}: {
  label: string;
  labelPrefix?: string;
  value: string;
  save: (value: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  maxRows?: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!multiline || !field) return;
    const resize = () => {
      if (field) {
        const computed = window.getComputedStyle(field);
        const lineHeight = Number.parseFloat(computed.lineHeight) || 21;
        const padding =
          (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0);
        const border =
          (Number.parseFloat(computed.borderTopWidth) || 0) +
          (Number.parseFloat(computed.borderBottomWidth) || 0);
        const minHeight = lineHeight * rows + padding + border;
        const maxHeight = lineHeight * maxRows + padding + border;
        field.style.height = 'auto';
        const nextHeight = Math.min(Math.max(field.scrollHeight, minHeight), maxHeight);
        field.style.height = `${nextHeight}px`;
        field.style.overflowY = field.scrollHeight > maxHeight ? 'auto' : 'hidden';
      }
    };
    resize();
    if (typeof ResizeObserver === 'undefined' || !field.parentElement) return;
    const observer = new ResizeObserver(resize);
    observer.observe(field.parentElement);
    return () => observer.disconnect();
  }, [draft, maxRows, multiline, rows]);
  useLayoutEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const onFocus = () => {
    focused.current = true;
  };
  const onBlur = () => {
    focused.current = false;
    if (draft !== value) save(draft);
  };
  if (multiline) {
    return (
      <TextField
        label={label}
        labelPrefix={labelPrefix}
        id={id}
        multiline
        rows={rows}
        ref={fieldRef}
        maxLength={4000}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  }
  return (
    <TextField
      label={label}
      labelPrefix={labelPrefix}
      id={id}
      type="text"
      maxLength={4000}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}
