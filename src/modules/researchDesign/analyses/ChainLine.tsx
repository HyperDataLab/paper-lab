import { Link } from 'react-router-dom';
import { chainOf } from '@/core/researchDesign/draft/checkChain';
import type { Draft } from '@/core/researchDesign/draft/schema';
import { Badge } from '@/shared/ui/Badge';
import { methodWords } from './planText';

export function ChainLine({ draft, hypothesisId }: { draft: Draft; hypothesisId: string }) {
  const chain = chainOf(draft, hypothesisId);
  if (!chain.hypothesis) return null;
  const analyses = draft.analyses.filter((a) => a.hypothesis === hypothesisId);
  const target = '?design=measurement';
  const link = (id: string, name?: string) => (
    <Link to={target}>
      <span>{id}</span>
      {name ? ` ${name}` : ''}
    </Link>
  );
  const warning = (text: string) => (
    <span>
      <Badge tone="warning">Cần xem lại</Badge> {text}
    </span>
  );
  const analysisLinks = () =>
    analyses.length ? (
      analyses.map((a) => (
        <span key={a.id}>
          {' '}
          →{' '}
          <Link to={'?design=analyses'}>
            <span>{a.id}</span> {a.method ? methodWords(a.method) : 'chưa chọn phương pháp'}
          </Link>
        </span>
      ))
    ) : chain.hypothesis?.kind !== 'exploratory' ? (
      <> → {warning('chưa có phân tích')}</>
    ) : null;
  return (
    <div>
      {chain.dependent.length === 0 ? (
        <div>
          {link(hypothesisId)} → {warning('chưa gắn biến phụ thuộc')}
          {analysisLinks()}
        </div>
      ) : (
        chain.dependent.map(({ variable, metric }, index) => (
          <div key={chain.hypothesis?.dependent[index]}>
            {link(hypothesisId)} →{' '}
            {variable ? link(variable.id, variable.name) : warning('biến phụ thuộc không tồn tại')} →{' '}
            {variable &&
              (metric ? (
                <>
                  {link(metric.id)} {metric.key ? <span>{metric.key}</span> : warning('metric chưa có key')}
                </>
              ) : (
                warning(variable.metric ? 'metric không tồn tại' : 'chưa có metric')
              ))}
            {analysisLinks()}
          </div>
        ))
      )}
      {chain.independent.length > 0 && (
        <div>
          Biến độc lập:{' '}
          {chain.independent.map((v, index) => (
            <span key={v.id}>
              {index > 0 && ', '}
              {link(v.id, v.name)} ({v.levels.join(', ')})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
