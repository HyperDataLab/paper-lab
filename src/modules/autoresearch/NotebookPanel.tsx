import { useState } from 'react';
import type { NotebookEntry } from '@/core/autoresearch/reviews';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import styles from './autoresearch.module.css';

const labels = {
  directive: 'Chỉ dẫn',
  observation: 'Quan sát',
  risk: 'Rủi ro',
  lesson: 'Bài học',
  question: 'Câu hỏi',
};
export function NotebookPanel({
  entries,
  disabled,
  add,
}: {
  entries: NotebookEntry[];
  disabled: boolean;
  add: (text: string) => Promise<boolean>;
}) {
  const [directive, setDirective] = useState('');
  return (
    <section aria-labelledby="ar-notebook">
      <h3 id="ar-notebook">Sổ nghiên cứu</h3>
      {entries.length > 0 && (
        <ul className={styles.rows}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Badge>
                {labels[entry.kind]}
                {entry.author === 'pi' ? ' · PI' : ''}
              </Badge>
              <p>{entry.text}</p>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <form
          className={styles.stack}
          onSubmit={(event) => {
            event.preventDefault();
            if (directive.trim())
              void add(directive.trim()).then((saved) => {
                if (saved) setDirective('');
              });
          }}
        >
          <TextField
            label="Chỉ dẫn cho PI và Critic"
            multiline
            value={directive}
            onChange={(event) => setDirective(event.target.value)}
          />
          <Button type="submit" disabled={!directive.trim()}>
            Thêm chỉ dẫn
          </Button>
        </form>
      )}
    </section>
  );
}
