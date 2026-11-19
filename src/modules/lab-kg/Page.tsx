import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { normalizeDoi } from '@/core/library/doi';
import { labKgGraphToPaperKg, labKgIri } from '@/core/labKg/graphKg';
import { toJsonLd, toTurtle } from '@/core/openkg/exportRdf';
import {
  KG_GRAPH_LAYERS,
  kgGraphCentre,
  type KgGraph,
  type KgGraphLayer,
  type KgIngestResult,
  type KgSearchResponse,
  type KgStats,
  type KgTrend,
} from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { downloadText } from '@/shared/calibration/download';
import {
  enqueueLabKg,
  getLabKgGraph,
  getLabKgStats,
  getLabKgTrend,
  LabKgError,
  searchLabKg,
} from '@/shared/labKg/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar, ActionMenu, Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { DataTable } from '@/shared/ui/DataTable';
import { PageHeader } from '@/shared/ui/PageHeader';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { TextField } from '@/shared/ui/TextField';
import { OpenKgGraph } from '@/shared/ui/openkg/OpenKgGraph';
import openkg from '@/shared/ui/openkg/openkg.module.css';
import { KIND_LABELS, LAYER_NAMES } from './labels';
import { NodeDetails, Sparkline } from './NodeDetails';
import styles from './labKg.module.css';

const TREND_KEYWORDS = 5;

function ErrorNote({ error, onRetry }: { error: LabKgError; onRetry?: () => void }) {
  return (
    <div role="alert">
      {error.message}{' '}
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Thử lại
        </Button>
      )}
      {error.detail && (
        <details>
          <summary>Chi tiết kỹ thuật</summary>
          {error.detail}
        </details>
      )}
    </div>
  );
}

const asError = (cause: unknown, fallback: string) =>
  cause instanceof LabKgError ? cause : new LabKgError(fallback);

function TrendTable({ trend }: { trend: KgTrend }) {
  if (!trend.keywords.length) return null;
  return (
    <DataTable aria-label="Số bài theo keyword và năm xuất bản">
      <thead>
        <tr>
          <th scope="col">Keywords</th>
          <th scope="col">Tổng số bài</th>
          <th scope="col">Xu hướng</th>
          {trend.years.map((year) => (
            <th key={year} scope="col">
              {year}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trend.keywords.map((keyword) => (
          <tr key={keyword.id}>
            <th scope="row">{keyword.text}</th>
            <td>{keyword.total}</td>
            <td>
              <Sparkline counts={keyword.counts} label={`Xu hướng của ${keyword.text}`} />
            </td>
            {keyword.counts.map((count, index) => (
              <td key={trend.years[index]}>{count}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

export default function Page() {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const repo = useRepositories();
  const [stats, setStats] = useState<KgStats>();
  const [statsError, setStatsError] = useState<LabKgError>();
  const [statsRefresh, setStatsRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<KgSearchResponse>();
  const [searchError, setSearchError] = useState<LabKgError>();
  const [centre, setCentre] = useState<string>();
  const [depth, setDepth] = useState<1 | 2>(1);
  const [layers, setLayers] = useState<ReadonlySet<KgGraphLayer>>(() => new Set(KG_GRAPH_LAYERS));
  const [graph, setGraph] = useState<KgGraph>();
  const [graphFailure, setGraphFailure] = useState<{ key: string; error: LabKgError }>();
  const [graphRefresh, setGraphRefresh] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [trendResult, setTrendResult] = useState<{ key: string; data: KgTrend }>();
  const [local, setLocal] = useState<ReadonlyMap<string, string>>(new Map());
  const [queueing, setQueueing] = useState(false);
  const [queued, setQueued] = useState<KgIngestResult>();
  const [queueError, setQueueError] = useState<LabKgError>();

  useEffect(() => {
    void repo.paperContext
      .list()
      .then((records) => {
        const byDoi = new Map<string, string>();
        for (const record of records) {
          const doi = normalizeDoi(record.paperDoi ?? record.metadata?.doi ?? '');
          if (doi && !byDoi.has(doi)) byDoi.set(doi, record.paperId);
        }
        setLocal(byDoi);
      })
      .catch(() => undefined);
  }, [repo]);

  useEffect(() => {
    if (!uid) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await getLabKgStats(await getIdToken(), controller.signal);
        if (controller.signal.aborted) return;
        setStats(next);
        setStatsError(undefined);
      } catch (cause) {
        if (!controller.signal.aborted) setStatsError(asError(cause, 'Không tải được số liệu KG của lab.'));
      }
    })();
    return () => controller.abort();
  }, [uid, getIdToken, statsRefresh]);

  const layerKey = KG_GRAPH_LAYERS.filter((layer) => layers.has(layer)).join(',');
  const graphKey = `${centre ?? ''}|${depth}|${layerKey}|${graphRefresh}`;
  const graphError = graphFailure?.key === graphKey ? graphFailure.error : undefined;
  useEffect(() => {
    if (!uid || !centre) return;
    const controller = new AbortController();
    const key = `${centre}|${depth}|${layerKey}|${graphRefresh}`;
    void (async () => {
      try {
        const next = await getLabKgGraph(
          { centre, depth, layers: layerKey ? (layerKey.split(',') as KgGraphLayer[]) : [] },
          await getIdToken(),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setGraph(next);
        setSelected((current) =>
          current && next.nodes.some(({ id }) => id === current) ? current : next.centre,
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setGraphFailure({ key, error: asError(cause, 'Không tải được đồ thị.') });
      }
    })();
    return () => controller.abort();
  }, [uid, getIdToken, centre, depth, layerKey, graphRefresh]);

  const trendKey = (graph?.nodes ?? [])
    .filter(({ kind }) => kind === 'keyword')
    .slice(0, TREND_KEYWORDS)
    .map(({ id }) => id)
    .join(',');
  const trend = trendResult?.key === trendKey ? trendResult.data : undefined;
  useEffect(() => {
    if (!uid || !trendKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await getLabKgTrend(trendKey.split(','), await getIdToken(), controller.signal);
        if (!controller.signal.aborted) setTrendResult({ key: trendKey, data: next });
      } catch {
        /* The trend is supplementary; the graph and node details stay usable without it. */
      }
    })();
    return () => controller.abort();
  }, [uid, getIdToken, trendKey]);

  const kg = useMemo(() => (graph ? labKgGraphToPaperKg(graph) : undefined), [graph]);
  const byIri = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [labKgIri(node), node.id])),
    [graph],
  );
  const current = graph?.nodes.find(({ id }) => id === selected);
  const centreNode = graph?.nodes.find(({ id }) => id === graph.centre);
  const localPaperId = current?.doi ? local.get(normalizeDoi(current.doi) ?? '') : undefined;

  function recentre(id: string) {
    setCentre(id);
    setSelected(id);
    setQueued(undefined);
    setQueueError(undefined);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    const direct = kgGraphCentre(text);
    if (direct) {
      setFound(undefined);
      recentre(direct.id);
      return;
    }
    setSearching(true);
    setSearchError(undefined);
    try {
      setFound(
        await searchLabKg(
          { query: text, keywords: [{ text: text.slice(0, 200), level: 'high' }], topK: 10, mode: 'hybrid' },
          await getIdToken(),
        ),
      );
    } catch (cause) {
      setSearchError(asError(cause, 'Không tìm được trong KG của lab.'));
    } finally {
      setSearching(false);
    }
  }

  async function ingestOutside() {
    if (!graph?.outside.length) return;
    setQueueing(true);
    setQueueError(undefined);
    try {
      setQueued(await enqueueLabKg(graph.outside, await getIdToken(), 'expansion'));
      setStatsRefresh((value) => value + 1);
    } catch (cause) {
      setQueueError(asError(cause, 'Không đưa được bài vào KG của lab.'));
    } finally {
      setQueueing(false);
    }
  }

  const exportFile = (extension: string, mime: string, content: string) =>
    downloadText(
      `lab-kg-${(graph?.centre ?? 'graph').replace(/[^\w.-]+/gu, '_')}.${extension}`,
      content,
      mime,
    );

  const header = (
    <PageHeader
      title="KG của lab"
      lead="Xem quanh một bài, keyword hoặc chủ đề trong knowledge graph chung của lab."
    />
  );
  if (!uid)
    return (
      <div className={styles.page}>
        {header}
        <Empty title="Cần đăng nhập" hint="Hãy đăng nhập bằng tài khoản lab để xem KG của lab." />
      </div>
    );

  const empty = stats && stats.nodes.paper === 0;
  const queue = stats ? stats.queue.pending + stats.queue.processing : 0;
  return (
    <div className={styles.page}>
      {header}
      {statsError ? (
        <ErrorNote error={statsError} onRetry={() => setStatsRefresh((value) => value + 1)} />
      ) : !stats ? (
        <Loading label="Đang tải số liệu KG…" />
      ) : (
        <StatGrid>
          <Stat label="Bài báo" value={stats.nodes.paper} />
          <Stat label="Keywords" value={stats.nodes.keyword} />
          <Stat label="Tác giả" value={stats.nodes.author} />
          <Stat label="Chủ đề" value={stats.nodes.topic} />
          <Stat label="Contributions" value={stats.nodes.contribution} />
          <Stat label="Đang chờ đưa vào" value={queue} />
        </StatGrid>
      )}
      {empty ? (
        <Empty
          title="KG của lab chưa có bài nào"
          hint={`Mở một corpus và bấm “Đưa vào KG của lab”: các bài được lấy từ OpenAlex trong nền, vài phút sau sẽ hiện ở đây.${queue ? ` Đang có ${queue} bài chờ xử lý.` : ''}`}
        >
          <Link to="/corpus">Mở Corpus</Link>
        </Empty>
      ) : (
        <>
          <form className={styles.search} onSubmit={(event) => void search(event)} role="search">
            <TextField
              label="Tìm tâm đồ thị"
              hint="Gõ title, keyword, DOI hoặc OpenAlex ID (W…, keywords/…, topics/…)."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={searching || !query.trim()}>
              {searching ? 'Đang tìm…' : 'Tìm'}
            </Button>
          </form>
          {searchError && <ErrorNote error={searchError} />}
          {found && (
            <section aria-label="Kết quả tìm">
              {found.papers.length ? (
                <ul className={styles.results}>
                  {found.papers.map((paper) => (
                    <li key={paper.openalexId ?? paper.id ?? paper.title}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!(paper.openalexId ?? paper.id)}
                        onClick={() => recentre(paper.openalexId ?? paper.id ?? '')}
                      >
                        {paper.title}
                      </Button>{' '}
                      <small>{[paper.year, paper.venue].filter(Boolean).join(' · ')}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={openkg.muted}>Không có bài nào trong KG khớp với từ khoá này.</p>
              )}
            </section>
          )}
          {!centre ? (
            <p className={openkg.muted}>Tìm một bài rồi chọn nó để xem đồ thị quanh bài đó.</p>
          ) : (
            <div className={openkg.workspace}>
              <div className={styles.controls}>
                <fieldset className={openkg.layers}>
                  <legend>Lớp</legend>
                  {KG_GRAPH_LAYERS.map((layer) => (
                    <Chip
                      key={layer}
                      aria-pressed={layers.has(layer)}
                      onClick={() =>
                        setLayers((previous) => {
                          const next = new Set(previous);
                          if (next.has(layer)) next.delete(layer);
                          else next.add(layer);
                          return next;
                        })
                      }
                    >
                      {LAYER_NAMES[layer]}
                    </Chip>
                  ))}
                </fieldset>
                <SegmentedControl
                  label="Độ sâu"
                  value={String(depth)}
                  onChange={(value) => setDepth(value === '2' ? 2 : 1)}
                  options={[
                    { value: '1', label: '1 bước' },
                    { value: '2', label: '2 bước' },
                  ]}
                />
              </div>
              {graphError && (
                <ErrorNote error={graphError} onRetry={() => setGraphRefresh((value) => value + 1)} />
              )}
              {!graph && !graphError && <Loading label="Đang tải đồ thị…" />}
              {graph && kg && (
                <>
                  <ActionBar
                    status={`Tâm: ${centreNode?.label ?? graph.centre} · ${graph.nodes.length} nút · ${graph.edges.length} liên kết${graph.truncated ? ' · đã giữ các nút mạnh nhất' : ''}`}
                  >
                    {graph.outside.length > 0 && (
                      <Button size="sm" disabled={queueing} onClick={() => void ingestOutside()}>
                        {queueing ? 'Đang gửi…' : `Đưa ${graph.outside.length} bài được dẫn vào KG`}
                      </Button>
                    )}
                    <ActionMenu
                      label="Xuất đồ thị"
                      items={[
                        {
                          label: 'Turtle (.ttl)',
                          onSelect: () => exportFile('ttl', 'text/turtle', toTurtle(kg)),
                        },
                        {
                          label: 'JSON-LD (.jsonld)',
                          onSelect: () => exportFile('jsonld', 'application/ld+json', toJsonLd(kg)),
                        },
                      ]}
                    />
                  </ActionBar>
                  {queued && (
                    <p role="status" className={openkg.muted}>
                      Đã xếp {queued.queued} · Xử lý ngay {queued.processed} · Bỏ qua {queued.skipped} · Lỗi{' '}
                      {queued.errors.length}
                    </p>
                  )}
                  {queueError && <ErrorNote error={queueError} />}
                  <div className={openkg.layout}>
                    <OpenKgGraph
                      graph={kg}
                      centre={centreNode ? labKgIri(centreNode) : undefined}
                      label="Đồ thị KG của lab quanh tâm đã chọn"
                      selected={current ? labKgIri(current) : undefined}
                      onSelect={(iri) => setSelected(byIri.get(iri))}
                    />
                    <aside className={openkg.inspector} aria-label="Chi tiết nút">
                      {current ? (
                        <NodeDetails
                          node={current}
                          graph={graph}
                          localPaperId={localPaperId}
                          onCentre={recentre}
                        />
                      ) : (
                        <p className={openkg.muted}>Chọn một nút để xem chi tiết.</p>
                      )}
                    </aside>
                  </div>
                  <details className={`${openkg.textList} ${styles.nodeList}`}>
                    <summary>Danh sách nút ({graph.nodes.length})</summary>
                    <ul>
                      {graph.nodes.map((node) => (
                        <li key={node.id}>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-pressed={node.id === selected}
                            onClick={() => setSelected(node.id)}
                          >
                            {node.label}
                          </Button>{' '}
                          <small className={openkg.muted}>
                            {KIND_LABELS[node.kind]}
                            {node.depth === 0 ? ' · tâm' : ` · ${node.weight.toFixed(2)}`}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {trend && trend.keywords.length > 0 && (
                    <section>
                      <h3>Keywords theo năm</h3>
                      <TrendTable trend={trend} />
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
