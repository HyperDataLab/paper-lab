import { useState } from 'react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function ResultView({ output }: { output: unknown }) {
  const [view, setView] = useState('result');
  const entries = object(output) ? Object.entries(output) : [];
  const scalars = entries.filter(
    ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
  );
  const lists = entries.filter(
    ([, value]) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (paper: unknown) => object(paper) && typeof paper.title === 'string' && typeof paper.url === 'string',
      ),
  );
  return (
    <div>
      <SegmentedControl
        label="Xem kết quả"
        value={view}
        onChange={setView}
        options={[
          { value: 'result', label: 'Kết quả' },
          { value: 'json', label: 'JSON' },
        ]}
      />
      {view === 'json' ? (
        <>
          <Button onClick={() => void navigator.clipboard.writeText(JSON.stringify(output, null, 2))}>
            Sao chép
          </Button>
          <pre>{JSON.stringify(output, null, 2)}</pre>
        </>
      ) : (
        <>
          <dl>
            {scalars.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          {lists.map(([key, value]) => (
            <section key={key}>
              <h3>{key}</h3>
              <ul>
                {(value as Record<string, unknown>[]).map((paper, index) => (
                  <li key={index}>
                    <a
                      href={
                        typeof paper.url === 'string' && /^https?:\/\//iu.test(paper.url)
                          ? paper.url
                          : undefined
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {String(paper.title)}
                    </a>{' '}
                    {paper.year != null && String(paper.year)}{' '}
                    {paper.cited_by_count != null && `· ${String(paper.cited_by_count)} trích dẫn`}{' '}
                    {paper.retracted === true && <Badge tone="danger">Đã rút lại</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!scalars.length && !lists.length && <p>Xem JSON để biết chi tiết kết quả.</p>}
        </>
      )}
    </div>
  );
}
