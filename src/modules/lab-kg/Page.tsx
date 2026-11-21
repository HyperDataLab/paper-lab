import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { normalizeDoi } from '@/core/library/doi';
import { labKgGraphToPaperKg, labKgIri } from '@/core/labKg/graphKg';
import { toJsonLd, toTurtle } from '@/core/openkg/exportRdf';
import {
  KG_GRAPH_KIND_LAYER,
  KG_GRAPH_LAYERS,
  kgGraphCentre,
  type KgGraph,
  type KgGraphLayer,
  type KgIngestResult,
  type KgOverview,
  type KgSearchResponse,
  type KgStats,
  type KgTrend,
} from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { downloadText } from '@/shared/calibration/download';
import {
  asLabKgError,
  enqueueLabKg,
  getLabKgGraph,
  getLabKgOverview,
  getLabKgStats,
  getLabKgTrend,
  LabKgError,
  searchLabKg,
} from '@/shared/labKg/client';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
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
import { AskKg } from './AskKg';
import { EmptyKg } from './EmptyKg';
import { ErrorNote } from './ErrorNote';
import { KIND_LABELS, LAYER_NAMES } from './labels';
import { NodeDetails, Sparkline } from './NodeDetails';
import { NotInKg } from './NotInKg';
import styles from './labKg.module.css';

const TREND_KEYWORDS = 5;
/** While the queue has work, the counts are refreshed this often. */
export const STATS_REFRESH_MS = 20_000;

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

function StartingPoints({ overview, onCentre }: { overview: KgOverview; onCentre: (id: string) => void }) {
  if (!overview.papers.length && !overview.keywords.length) return null;
  return (
    <section className={styles.starts} aria-labelledby="lab-kg-starts">
      <h2 id="lab-kg-starts" className={styles.heading}>
        Điểm bắt đầu
      </h2>
      {overview.papers.length > 0 && (
        <div className={styles.startGroup}>
          <h3>Bài được dẫn nhiều nhất</h3>
          <div className={styles.chips}>
            {overview.papers.map((paper) => (
              <Chip
                key={paper.id}
                count={paper.citations ?? undefined}
                title={[paper.title, paper.year].filter(Boolean).join(' · ')}
                onClick={() => onCentre(paper.id)}
              >
                {paper.title.length > 60 ? `${paper.title.slice(0, 57)}…` : paper.title}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {overview.keywords.length > 0 && (
        <div className={styles.startGroup}>
          <h3>Keywords phổ biến</h3>
          <div className={styles.chips}>
            {overview.keywords.map((keyword) => (
              <Chip key={keyword.id} count={keyword.frequency} onClick={() => onCentre(keyword.id)}>
                {keyword.text}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Page() {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const projectId = useHubProjectId();
  const repo = useRepositories();
  const [stats, setStats] = useState<KgStats>();
  const [statsError, setStatsError] = useState<LabKgError>();
  const [statsRefresh, setStatsRefresh] = useState(0);
  const [overview, setOverview] = useState<KgOverview>();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<KgSearchResponse>();
  const [searchError, setSearchError] = useState<LabKgError>();
  const [centre, setCentre] = useState<string>();
  const [depth, setDepth] = useState<1 | 2>(1);
  const [layers, setLayers] = useState<ReadonlySet<KgGraphLayer>>(() => new Set(KG_GRAPH_LAYERS));
  const [graphResult, setGraphResult] = useState<{ key: string; data: KgGraph }>();
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
    if (!uid || !projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const next = await getLabKgStats(await getIdToken(), projectId, controller.signal);
        if (controller.signal.aborted) return;
        setStats(next);
        setStatsError(undefined);
        if (next.queue.pending + next.queue.processing > 0)
          timer = setTimeout(() => setStatsRefresh((value) => value + 1), STATS_REFRESH_MS);
      } catch (cause) {
        if (!controller.signal.aborted)
          setStatsError(asLabKgError(cause, 'Không tải được số liệu KG của lab.'));
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [uid, projectId, getIdToken, statsRefresh]);

  const paperCount = stats?.nodes.paper ?? 0;
  useEffect(() => {
    if (!uid || !projectId || !paperCount) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await getLabKgOverview(await getIdToken(), projectId, controller.signal);
        if (!controller.signal.aborted) setOverview(next);
      } catch {
        /* Starting points are a shortcut; search works without them. */
      }
    })();
    return () => controller.abort();
  }, [uid, projectId, getIdToken, paperCount]);

  const layerKey = KG_GRAPH_LAYERS.filter((layer) => layers.has(layer)).join(',');
  const graphKey = `${centre ?? ''}|${depth}|${layerKey}|${graphRefresh}`;
  const graphError = graphFailure?.key === graphKey ? graphFailure.error : undefined;
  // A graph for another centre, depth or layer set is not shown while the new one loads.
  const graph = graphResult?.key === graphKey ? graphResult.data : undefined;
  useEffect(() => {
    if (!uid || !projectId || !centre) return;
    const controller = new AbortController();
    const key = `${centre}|${depth}|${layerKey}|${graphRefresh}`;
    void (async () => {
      try {
        const next = await getLabKgGraph(
          { centre, depth, layers: layerKey ? (layerKey.split(',') as KgGraphLayer[]) : [] },
          await getIdToken(),
          projectId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setGraphResult({ key, data: next });
        setSelected((current) =>
          current && next.nodes.some(({ id }) => id === current) ? current : next.centre,
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setGraphFailure({ key, error: asLabKgError(cause, 'Không tải được đồ thị.') });
      }
    })();
    return () => controller.abort();
  }, [uid, projectId, getIdToken, centre, depth, layerKey, graphRefresh]);

  const trendKey = (graph?.nodes ?? [])
    .filter(({ kind }) => kind === 'keyword')
    .slice(0, TREND_KEYWORDS)
    .map(({ id }) => id)
    .join(',');
  const trend = trendResult?.key === trendKey ? trendResult.data : undefined;
  useEffect(() => {
    if (!uid || !projectId || !trendKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await getLabKgTrend(
          trendKey.split(','),
          await getIdToken(),
          projectId,
          controller.signal,
        );
        if (!controller.signal.aborted) setTrendResult({ key: trendKey, data: next });
      } catch {
        /* The trend is supplementary; the graph and node details stay usable without it. */
      }
    })();
    return () => controller.abort();
  }, [uid, projectId, getIdToken, trendKey]);

  const kg = useMemo(() => (graph ? labKgGraphToPaperKg(graph) : undefined), [graph]);
  const byIri = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [labKgIri(node), node.id])),
    [graph],
  );
  const layerCounts = useMemo(() => {
    const counts = new Map<KgGraphLayer, number>();
    for (const node of graph?.nodes ?? []) {
      if (node.id === graph?.centre) continue;
      const layer = KG_GRAPH_KIND_LAYER[node.kind];
      counts.set(layer, (counts.get(layer) ?? 0) + 1);
    }
    return counts;
  }, [graph]);
  const current = graph?.nodes.find(({ id }) => id === selected);
  const centreNode = graph?.nodes.find(({ id }) => id === graph.centre);
  const localPaperId = current?.doi ? local.get(normalizeDoi(current.doi) ?? '') : undefined;
  const centreRef = centre ? (kgGraphCentre(centre) ?? { id: centre, kind: 'paper' as const }) : undefined;

  function recentre(id: string) {
    setCentre(id);
    setSelected(id);
    setQueued(undefined);
    setQueueError(undefined);
  }

  async function runSearch(text: string) {
    if (!projectId) {
      setSearchError(new LabKgError('Mở một project ResearchHub để tìm trong KG.'));
      return;
    }
    const direct = kgGraphCentre(text);
    if (direct) {
      setFound(undefined);
      setSearchError(undefined);
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
          projectId,
        ),
      );
    } catch (cause) {
      setSearchError(asLabKgError(cause, 'Không tìm được trong KG của lab.'));
    } finally {
      setSearching(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text) void runSearch(text);
  }

  async function ingestOutside() {
    if (!graph?.outside.length) return;
    setQueueing(true);
    setQueueError(undefined);
    try {
      if (!projectId) throw new LabKgError('Mở một project ResearchHub để thêm vào KG.');
      setQueued(await enqueueLabKg(graph.outside, await getIdToken(), projectId, 'expansion'));
      setStatsRefresh((value) => value + 1);
    } catch (cause) {
      setQueueError(asLabKgError(cause, 'Không đưa được bài vào KG của lab.'));
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

  const empty = stats !== undefined && stats.nodes.paper === 0;
  const queue = stats ? stats.queue.pending + stats.queue.processing : 0;
  return (
    <div className={styles.page}>
      {header}
      <div className={styles.launchGrid}>
        <section className={styles.explore} aria-labelledby="lab-kg-explore-heading">
          <div className={styles.panelHeading}>
            <h2 id="lab-kg-explore-heading" className={styles.heading}>
              Khám phá đồ thị
            </h2>
            <p className={styles.muted}>Tìm bài báo, keyword hoặc chủ đề để xem các mối liên hệ.</p>
          </div>
          <form className={styles.search} onSubmit={search} role="search">
            <TextField
              label="Tìm tâm đồ thị"
              hint="Nhập tiêu đề, keyword, DOI hoặc OpenAlex ID."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="submit"
              variant={centre ? 'secondary' : 'primary'}
              disabled={searching || !query.trim()}
            >
              {searching ? 'Đang tìm…' : 'Tìm trong KG'}
            </Button>
          </form>
          <p className={styles.exploreFootnote}>
            Nếu bài chưa có trong KG, PaperLab sẽ gợi ý cách đưa bài vào ở bước tiếp theo.
          </p>
        </section>
        <AskKg key={uid} />
      </div>
      {statsError ? (
        <ErrorNote error={statsError} onRetry={() => setStatsRefresh((value) => value + 1)} />
      ) : !stats ? (
        <Loading label="Đang tải số liệu KG…" />
      ) : (
        <div className={styles.stats}>
          <StatGrid>
            <Stat label="Bài báo" value={stats.nodes.paper} />
            <Stat label="Keywords" value={stats.nodes.keyword} />
            <Stat label="Tác giả" value={stats.nodes.author} />
            <Stat label="Chủ đề" value={stats.nodes.topic} />
            <Stat label="Contributions" value={stats.nodes.contribution} />
            <Stat label="Đang chờ đưa vào" value={queue} />
          </StatGrid>
        </div>
      )}
      {searchError && <ErrorNote error={searchError} onRetry={() => void runSearch(query.trim())} />}
      {empty && !centre && <EmptyKg queue={queue} onQueued={() => setStatsRefresh((value) => value + 1)} />}
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
            <p className={openkg.muted}>
              Không có bài nào trong KG khớp với từ khoá này. Nếu bạn biết DOI của bài, hãy gõ DOI để đưa bài
              vào KG.
            </p>
          )}
        </section>
      )}
      {!centre ? (
        overview && !empty ? (
          <StartingPoints overview={overview} onCentre={recentre} />
        ) : (
          !empty && (
            <div className={styles.chooseCentre}>
              <strong>Chọn một điểm bắt đầu</strong>
              <span className={styles.muted}>
                Nhập DOI, OpenAlex ID hoặc từ khóa ở trên để mở đồ thị liên quan.
              </span>
            </div>
          )
        )
      ) : (
        <div className={openkg.workspace}>
          <div className={styles.controls}>
            <fieldset className={openkg.layers}>
              <legend>Lớp</legend>
              {KG_GRAPH_LAYERS.map((layer) => (
                <Chip
                  key={layer}
                  aria-pressed={layers.has(layer)}
                  count={graph && layers.has(layer) ? (layerCounts.get(layer) ?? 0) : undefined}
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
          {graphError && centreRef && graphError.status === 404 ? (
            <NotInKg
              centre={centreRef}
              onPresent={() => {
                setGraphRefresh((value) => value + 1);
                setStatsRefresh((value) => value + 1);
              }}
              onSearch={(text) => {
                setQuery(text);
                void runSearch(text);
              }}
            />
          ) : (
            graphError && (
              <ErrorNote error={graphError} onRetry={() => setGraphRefresh((value) => value + 1)} />
            )
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
              <div className={`${openkg.layout} ${styles.canvas}`}>
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
    </div>
  );
}
