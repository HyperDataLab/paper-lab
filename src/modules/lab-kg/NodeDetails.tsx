import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KgGraph, KgGraphNode, KgKeywordDetail, KgPaperDetail } from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { getLabKgKeyword, getLabKgPaper, LabKgError } from '@/shared/labKg/client';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { DataTable } from '@/shared/ui/DataTable';
import { Loading } from '@/shared/ui/StateNote';
import openkg from '@/shared/ui/openkg/openkg.module.css';
import { KIND_LABELS } from './labels';
import styles from './labKg.module.css';

type Detail = { kind: 'paper'; data: KgPaperDetail } | { kind: 'keyword'; data: KgKeywordDetail };

/** A small line of papers per year; the table below it carries the numbers. */
export function Sparkline({ counts, label }: { counts: number[]; label: string }) {
  if (counts.length < 2) return null;
  const max = Math.max(1, ...counts);
  const points = counts.map(
    (count, index) => `${(index / (counts.length - 1)) * 100},${30 - (count / max) * 28}`,
  );
  return (
    <svg
      className={styles.sparkline}
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline points={points.join(' ')} />
    </svg>
  );
}

function PaperList({
  items,
  onCentre,
}: {
  items: { id: string; title: string; year: number | null }[];
  onCentre: (id: string) => void;
}) {
  return (
    <ul className={styles.links}>
      {items.map(({ id, title, year }) => (
        <li key={id}>
          <Button variant="ghost" size="sm" onClick={() => onCentre(id)}>
            {title}
          </Button>{' '}
          {year !== null && <small>{year}</small>}
        </li>
      ))}
    </ul>
  );
}

function PaperDetails({
  data,
  localPaperId,
  onCentre,
}: {
  data: KgPaperDetail;
  localPaperId?: string;
  onCentre: (id: string) => void;
}) {
  const { paper } = data;
  return (
    <>
      <p className={openkg.muted}>
        {[paper.year, paper.venue?.name, paper.citations !== null ? `${paper.citations} trích dẫn` : null]
          .filter((part) => part !== null && part !== undefined)
          .join(' · ')}
      </p>
      {localPaperId && <Link to={`/papers/${encodeURIComponent(localPaperId)}`}>Mở bài trong PaperLab</Link>}
      {data.keywords.length > 0 && (
        <section className={styles.section}>
          <h4>Keywords</h4>
          <div className={styles.chips}>
            {data.keywords.map((keyword) => (
              <Chip key={keyword.id} onClick={() => onCentre(keyword.id)}>
                {keyword.text}
              </Chip>
            ))}
          </div>
        </section>
      )}
      <section className={styles.section}>
        <h4>References trong KG ({data.cites.length})</h4>
        {data.cites.length ? (
          <PaperList items={data.cites} onCentre={onCentre} />
        ) : (
          <p className={openkg.muted}>Chưa có bài nào được dẫn nằm trong KG.</p>
        )}
      </section>
      <section className={styles.section}>
        <h4>Được dẫn bởi ({data.citedBy.length})</h4>
        {data.citedBy.length ? (
          <PaperList items={data.citedBy} onCentre={onCentre} />
        ) : (
          <p className={openkg.muted}>Chưa có bài nào trong KG dẫn bài này.</p>
        )}
      </section>
      {data.contributions.length > 0 && (
        <section className={styles.section}>
          <h4>Contributions</h4>
          <ul className={styles.links}>
            {data.contributions.map((contribution) => (
              <li key={contribution.id}>
                <strong>{contribution.name}</strong>{' '}
                <Badge tone={contribution.review === 'accepted' ? 'success' : 'neutral'}>
                  {contribution.review === 'accepted' ? 'Đã chấp nhận' : 'Ứng viên AI'}
                </Badge>
                <div className={openkg.muted}>{contribution.description}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function KeywordDetails({ data, onCentre }: { data: KgKeywordDetail; onCentre: (id: string) => void }) {
  const counts = data.papersPerYear.map(({ count }) => count);
  return (
    <>
      <p className={openkg.muted}>{data.keyword.frequency} bài trong KG mang keyword này.</p>
      <section className={styles.section}>
        <h4>Keywords đi cùng</h4>
        {data.cooccurring.length ? (
          <ul className={styles.links}>
            {data.cooccurring.slice(0, 12).map((item) => (
              <li key={item.id}>
                <Button variant="ghost" size="sm" onClick={() => onCentre(item.id)}>
                  {item.text}
                </Button>{' '}
                <small>
                  Jaccard {item.jaccard.toFixed(2)} · {item.count} bài chung
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className={openkg.muted}>Chưa có keyword nào đi cùng.</p>
        )}
      </section>
      <section className={styles.section}>
        <h4>Số bài theo năm</h4>
        <Sparkline counts={counts} label={`Số bài mang keyword ${data.keyword.text} theo năm`} />
        {data.papersPerYear.length ? (
          <DataTable aria-label={`Số bài mang keyword ${data.keyword.text} theo năm`}>
            <thead>
              <tr>
                <th scope="col">Năm</th>
                <th scope="col">Số bài</th>
              </tr>
            </thead>
            <tbody>
              {data.papersPerYear.map(({ year, count }) => (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p className={openkg.muted}>Chưa có bài nào có năm xuất bản.</p>
        )}
      </section>
    </>
  );
}

/** Neighbours of a node inside the loaded graph, for kinds the worker has no detail route for. */
function GraphNeighbours({
  node,
  graph,
  onCentre,
}: {
  node: KgGraphNode;
  graph: KgGraph;
  onCentre: (id: string) => void;
}) {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const neighbours = graph.edges
    .flatMap(({ source, target }) => (source === node.id ? [target] : target === node.id ? [source] : []))
    .map((id) => byId.get(id))
    .filter((item): item is KgGraphNode => Boolean(item));
  const unique = [...new Map(neighbours.map((item) => [item.id, item])).values()];
  const papers = unique.filter(({ kind }) => kind === 'paper');
  const others = unique.filter(({ kind }) => kind !== 'paper');
  return (
    <>
      <section className={styles.section}>
        <h4>Bài báo trong đồ thị ({papers.length})</h4>
        {papers.length ? (
          <PaperList
            items={papers.map(({ id, label, year }) => ({ id, title: label, year: year ?? null }))}
            onCentre={onCentre}
          />
        ) : (
          <p className={openkg.muted}>Đồ thị đang hiện không có bài nào nối với nút này.</p>
        )}
      </section>
      {others.length > 0 && (
        <section className={styles.section}>
          <h4>Liên kết khác</h4>
          <div className={styles.chips}>
            {others.map((item) => (
              <Chip key={item.id} onClick={() => onCentre(item.id)}>
                {item.label} · {KIND_LABELS[item.kind]}
              </Chip>
            ))}
          </div>
        </section>
      )}
      <p className={openkg.muted}>
        Chỉ tính các nút đang có trong đồ thị. Đặt nút này làm tâm để xem đủ hơn.
      </p>
    </>
  );
}

export function NodeDetails({
  node,
  graph,
  localPaperId,
  onCentre,
}: {
  node: KgGraphNode;
  graph: KgGraph;
  localPaperId?: string;
  onCentre: (id: string) => void;
}) {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const projectId = useHubProjectId();
  // Results are keyed by node, so a newly selected node never shows the previous node's details.
  const [loaded, setLoaded] = useState<{ id: string; detail?: Detail; error?: LabKgError }>();
  const remote = node.kind === 'paper' || node.kind === 'keyword';
  const { detail, error } = loaded?.id === node.id ? loaded : {};

  useEffect(() => {
    if (!uid || !projectId || (node.kind !== 'paper' && node.kind !== 'keyword')) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getIdToken();
        const next: Detail =
          node.kind === 'paper'
            ? { kind: 'paper', data: await getLabKgPaper(node.id, token, projectId, controller.signal) }
            : { kind: 'keyword', data: await getLabKgKeyword(node.id, token, projectId, controller.signal) };
        if (!controller.signal.aborted) setLoaded({ id: node.id, detail: next });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoaded({
          id: node.id,
          error: cause instanceof LabKgError ? cause : new LabKgError('Không tải được chi tiết nút.'),
        });
      }
    })();
    return () => controller.abort();
  }, [uid, projectId, getIdToken, node.id, node.kind]);

  return (
    <>
      <h3 aria-live="polite">{node.label}</h3>
      <p className={openkg.muted}>
        {KIND_LABELS[node.kind]}
        {node.depth > 0 && ` · trọng số ${node.weight.toFixed(2)} · cách tâm ${node.depth} bước`}
      </p>
      {node.id !== graph.centre && (
        <Button size="sm" onClick={() => onCentre(node.id)}>
          Đặt làm tâm
        </Button>
      )}
      {error && (
        <div role="alert">
          {error.message}
          {error.detail && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error.detail}
            </details>
          )}
        </div>
      )}
      {remote && !detail && !error && <Loading label="Đang tải chi tiết…" />}
      {detail?.kind === 'paper' && (
        <PaperDetails data={detail.data} localPaperId={localPaperId} onCentre={onCentre} />
      )}
      {detail?.kind === 'keyword' && <KeywordDetails data={detail.data} onCentre={onCentre} />}
      {!remote && <GraphNeighbours node={node} graph={graph} onCentre={onCentre} />}
    </>
  );
}
