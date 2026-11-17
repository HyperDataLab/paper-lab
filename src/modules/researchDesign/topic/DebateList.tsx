import type { z } from 'zod';
import type { DebateSchema } from '@/core/topicCheck/evidence';
import { PaperRow } from './PaperRow';
import type { Props } from './types';
export function DebateList({ result, ...props }: Props & { result: z.infer<typeof DebateSchema> }) {
  return (
    <>
      <p>
        {result.window} · {result.records_in_window} bài
      </p>
      <h4>Bài gần đây</h4>
      <ul>
        {result.recent.map((paper) => (
          <PaperRow key={paper.id} paper={paper} {...props} />
        ))}
      </ul>
      <h4>Nguồn chung</h4>
      <ul>
        {result.common_ancestors.map((paper) => (
          <li key={paper.id}>
            <span>Được {paper.shared_by ?? 0} bài cùng trích dẫn</span>
            <ul>
              <PaperRow paper={paper} {...props} />
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
