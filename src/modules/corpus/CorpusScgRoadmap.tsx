import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildPaperModel, sentenceIndex } from '@/core/paperModel';
import { paperDoi } from '@/core/scholarlyContext';
import {
  buildScgRoadmap,
  layoutScgChain,
  SCG_CHAIN_LAYOUT,
  SCG_EDGE_WEIGHT,
  type RoadmapChain,
  type RoadmapEdge,
  type RoadmapExternalNode,
  type RoadmapNode,
} from '@/core/scg/roadmap';
import { SCG_CONTRIBUTION_TYPES, type ScgContributionType, type ScgPaperRun } from '@/core/schemas';
import type { Corpus } from '@/core/schemas/corpus';
import { describeLlmError } from '@/shared/llm/describeError';
import { useLlm } from '@/shared/llm/LlmProvider';
import { llmScg } from '@/shared/llm/llmScg';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { Select } from '@/shared/ui/Select';
import { labelMembers } from './labelRun';
import styles from './roadmap.module.css';

const TOP = 10;
const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
const clip = (text: string, size = 24) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const whereLabel = (node: RoadmapExternalNode) =>
  node.memberId ? 'bài trong corpus, chưa khớp contribution' : 'ngoài corpus';

/** The corpus's SCG runs merged into one graph: coverage, the most built-upon contributions, and chains. */
export function CorpusScgRoadmap({ corpus }: { corpus: Corpus }) {
  const repo = useRepositories();
  const llm = useLlm();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ScgPaperRun[]>();
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [type, setType] = useState('');
  const [selected, setSelected] = useState('');
  const [depth, setDepth] = useState('1');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const paperKey = JSON.stringify(corpus.members.flatMap((m) => m.identifiers.paperIds));

  const load = useCallback(async () => {
    setRuns(await repo.scg.listByPapers(JSON.parse(paperKey) as string[]));
  }, [paperKey, repo]);
  useEffect(() => {
    let active = true;
    void repo.scg
      .listByPapers(JSON.parse(paperKey) as string[])
      .then((value) => {
        if (active) setRuns(value);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [paperKey, repo]);
  useEffect(() => () => abort.current?.abort(), []);

  const roadmap = useMemo(
    () => buildScgRoadmap(runs ?? [], corpus.members, { acceptedOnly }),
    [runs, corpus.members, acceptedOnly],
  );
  // Members with a built paper model whose run is missing or unfinished (passing it as `previous` resumes it).
  const missing = useMemo(() => {
    const byPaper = new Map((runs ?? []).map((run) => [run.paperId, run]));
    return labelMembers(corpus).filter((m) => {
      const run = m.identifiers.paperIds.map((id) => byPaper.get(id)).find(Boolean);
      return !run || run.status !== 'complete';
    });
  }, [corpus, runs]);

  async function backfill() {
    // Oldest first, so a later paper can align to the earlier ones.
    const targets = [...missing].sort((a, b) => (a.stratum.year ?? 9999) - (b.stratum.year ?? 9999));
    if (!targets.length) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    const scholar = createScholarClient({});
    let done = 0;
    let skipped = 0;
    const tally = () =>
      `${done}/${targets.length} bài${skipped ? `, bỏ qua ${skipped} bài không có văn bản` : ''}`;
    try {
      if (!(await llm.ensureConsent('paper'))) return;
      for (const [index, member] of targets.entries()) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const id = member.identifiers.paperIds[0]!;
        setProgress(`Đang trích ${index + 1}/${targets.length}: ${member.title || id}`);
        const paper = await repo.papers.get(id);
        // Built exactly as the paper view builds it, so its fingerprint matches and a run resumes there.
        const model = paper && buildPaperModel({ paper, metadata: null, now: new Date() });
        if (paper && model?.sentences.length) {
          const context = await repo.paperContext.get(id);
          const doi =
            context?.metadata?.doi ?? context?.paperDoi ?? paperDoi(paper) ?? member.identifiers.doi ?? null;
          // Re-read before each paper, so it aligns to the ones done just before it.
          const all = await repo.scg.list();
          const result = await llmScg(llm.client, model, {
            paperId: id,
            doi,
            config: llm.config,
            previous: all.find((run) => run.paperId === id),
            others: all.filter((run) => run.paperId !== id),
            lookupS2CorpusId: scholar.lookupS2CorpusId,
            signal: controller.signal,
            onProgress: async (checkpoint) => {
              await repo.scg.save(checkpoint);
            },
          });
          await repo.scg.save(result);
          await load();
          done++;
        } else skipped++;
      }
      setProgress(`Đã trích contribution cho ${tally()}.`);
    } catch (cause) {
      if (isAbort(cause)) setProgress(`Đã dừng sau ${tally()}. Bấm lại để tiếp tục.`);
      else setError(describeLlmError(cause) ?? String(cause));
      await load();
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  async function openSource(edge: RoadmapEdge) {
    const paper = await repo.papers.get(edge.paperId);
    const keys = new Set(edge.sourceSentenceKeys);
    const sentence = paper && sentenceIndex(paper).find((item) => keys.has(item.key));
    const path = `/papers/${encodeURIComponent(edge.paperId)}`;
    navigate(sentence ? `${path}?p=${sentence.paragraphId}&s=${sentence.start}&e=${sentence.end}` : path);
  }

  const counts = roadmap.typeCounts();
  const ofType = (node: RoadmapNode) =>
    !type || (node.kind === 'contribution' && node.types.includes(type as ScgContributionType));
  const top = roadmap
    .mostBuiltUpon(Number.POSITIVE_INFINITY)
    .filter((item) => ofType(item.node))
    .slice(0, TOP);
  const choices = roadmap
    .contributions()
    .filter(ofType)
    .sort((a, b) => a.name.localeCompare(b.name));
  // A selection that the filters removed from the graph is dropped.
  const chosen = roadmap.nodes.get(selected);
  const levels = Number(depth);
  const ancestors = chosen ? roadmap.ancestors(chosen.id, levels) : undefined;
  const descendants = chosen ? roadmap.descendants(chosen.id, levels) : undefined;
  const { coverage } = roadmap;

  function nodeName(id: string) {
    const node = roadmap.nodes.get(id);
    if (!node) return id;
    if (node.kind === 'external')
      return `${node.name}${node.year ? ` (${node.year})` : ''} · ${whereLabel(node)}`;
    return `${node.name} · ${clip(node.paperTitle, 60)}${node.year ? ` (${node.year})` : ''}`;
  }
  function nameButton(id: string) {
    const node = roadmap.nodes.get(id);
    if (node?.kind !== 'contribution' || id === selected) return <strong>{nodeName(id)}</strong>;
    return (
      <Button size="sm" variant="ghost" onClick={() => setSelected(id)}>
        {nodeName(id)}
      </Button>
    );
  }
  function edgeList(chain: RoadmapChain, label: string, forward: boolean) {
    if (!chain.edges.length) return <p className={styles.muted}>Không có.</p>;
    return (
      <ul className={styles.list} aria-label={label}>
        {chain.edges.map((edge) => (
          <li
            key={edge.id}
            className={`${styles.item} ${edge.review === 'candidate' ? styles.candidate : ''}`}
          >
            <div className={styles.itemHead}>
              {nameButton(forward ? edge.to : edge.from)}
              <Badge tone={edge.coreOrPeripheral === 'core' ? 'accent' : 'neutral'}>
                {edge.coreOrPeripheral === 'core' ? 'cốt lõi' : 'phụ'}
              </Badge>
              <Badge>{edge.review === 'accepted' ? 'Đã chấp nhận' : 'Ứng viên'}</Badge>
            </div>
            <span className={styles.muted}>
              {forward ? `${nodeName(edge.from)} dựa trên nó` : `dựa trên ${nodeName(edge.to)}`}
              {edge.matchType && ` · khớp ${edge.matchType === 'strong' ? 'chặt' : 'lỏng'}`}
            </span>
            {edge.explanation && <span>{edge.explanation}</span>}
            <span>
              <Button size="sm" variant="ghost" onClick={() => void openSource(edge)}>
                Xem trong bài
              </Button>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const unfinished = coverage.withRun - coverage.complete;
  return (
    <Card>
      <section aria-labelledby="corpus-scg-roadmap" className={styles.section}>
        <div className={styles.head}>
          <h2 id="corpus-scg-roadmap">Lộ trình contribution</h2>
          <div className={styles.tools}>
            {missing.length > 0 && (
              <Button size="sm" disabled={busy} onClick={() => void backfill()}>
                Trích contribution cho {missing.length} bài còn thiếu
              </Button>
            )}
            {busy && (
              <Button size="sm" onClick={() => abort.current?.abort()}>
                Dừng
              </Button>
            )}
          </div>
        </div>
        <p className={styles.muted}>
          Contribution của từng bài (Scientific Contribution Graph) nối với nhau qua các nền tảng chúng dựa
          vào. Kết quả là ứng viên cho tới khi bạn chấp nhận trong từng bài; mục đã bác bỏ không được tính.
        </p>
        <p className={styles.muted}>
          {`${coverage.withRun}/${coverage.members} bài có kết quả trích contribution`}
          {unfinished > 0 && ` (${unfinished} chưa xong)`}
          {` · ${roadmap.contributions().length} contribution · ${roadmap.edges.length} liên kết`}
        </p>
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">Không thể trích contribution. {error}</p>}
        {!runs && !error ? (
          <p className={styles.muted}>Đang tải…</p>
        ) : coverage.withRun === 0 ? (
          <p className={styles.muted}>Chưa bài nào của corpus có kết quả trích contribution.</p>
        ) : (
          <>
            <div className={styles.tools}>
              <Select
                label="Loại contribution"
                size="sm"
                inline
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">Mọi loại</option>
                {[...counts].map(([id, count]) => (
                  <option key={id} value={id}>
                    {`${id} (${count})`}
                  </option>
                ))}
              </Select>
              <Checkbox checked={acceptedOnly} onChange={(event) => setAcceptedOnly(event.target.checked)}>
                Chỉ mục đã chấp nhận
              </Checkbox>
            </div>
            {type && <p className={styles.muted}>{SCG_CONTRIBUTION_TYPES[type as ScgContributionType]}</p>}

            <h3>Được xây dựa trên nhiều nhất</h3>
            <p className={styles.muted}>
              {`Điểm = ${SCG_EDGE_WEIGHT.core} cho mỗi contribution dựa vào nó như nền tảng cốt lõi, ${SCG_EDGE_WEIGHT.peripheral} nếu chỉ là nền tảng phụ; chỉ tính contribution trong corpus.`}
            </p>
            {top.length === 0 ? (
              <p className={styles.muted}>Chưa có contribution nào được contribution khác dựa vào.</p>
            ) : (
              <ol className={styles.list} aria-label="Được xây dựa trên nhiều nhất">
                {top.map((item) => (
                  <li key={item.node.id} className={item.node.review === 'candidate' ? styles.candidate : ''}>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(item.node.id)}>
                      {nodeName(item.node.id)}
                    </Button>{' '}
                    <span className={styles.muted}>
                      {`điểm ${item.score} · ${item.core} cốt lõi, ${item.peripheral} phụ · ${item.papers} bài`}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className={styles.tools}>
              <Select
                label="Contribution"
                size="sm"
                inline
                value={chosen ? selected : ''}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Chọn một contribution</option>
                {choices.map((node) => (
                  <option key={node.id} value={node.id}>
                    {`${node.name} · ${clip(node.paperTitle, 40)}`}
                  </option>
                ))}
              </Select>
              <SegmentedControl
                label="Độ sâu"
                value={depth}
                onChange={setDepth}
                options={['1', '2', '3'].map((value) => ({ value, label: `${value} bước` }))}
              />
            </div>
            {chosen && ancestors && descendants && (
              <div className={styles.chain}>
                <ChainGraph selected={chosen} ancestors={ancestors} descendants={descendants} />
                <h3>{`Dựa trên (nền tảng của ${chosen.name})`}</h3>
                {edgeList(ancestors, `${chosen.name} dựa trên`, true)}
                <h3>Được dựa vào bởi</h3>
                {edgeList(descendants, `Dựa vào ${chosen.name}`, false)}
              </div>
            )}
          </>
        )}
      </section>
    </Card>
  );
}

function ChainGraph({
  selected,
  ancestors,
  descendants,
}: {
  selected: RoadmapNode;
  ancestors: RoadmapChain;
  descendants: RoadmapChain;
}) {
  const layout = layoutScgChain(selected, ancestors, descendants);
  const { nodeWidth, nodeHeight, pad } = SCG_CHAIN_LAYOUT;
  return (
    <>
      <p className={styles.muted}>
        {layout.byYear ? 'Mỗi cột là một năm.' : 'Cột là số bước từ contribution đang chọn.'} Mũi tên đi từ
        nền tảng tới contribution dựa trên nó; nét liền là cốt lõi, nét đứt là phụ; mục mờ là ứng viên.
        {layout.hidden > 0 && ` Đồ thị ẩn ${layout.hidden} nút; danh sách bên dưới có đủ.`}
      </p>
      <div className={styles.graphWrap}>
        <svg
          className={styles.graph}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Đồ thị chuỗi của ${selected.name}: ${layout.nodes.length} nút, ${layout.edges.length} liên kết. Danh sách bên dưới có cùng nội dung.`}
        >
          <defs>
            <marker
              id="scg-arrow"
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={styles.arrow} />
            </marker>
          </defs>
          {layout.columns.map((column) => (
            <text key={column.x} x={column.x} y={pad} className={styles.column}>
              {column.label}
            </text>
          ))}
          {layout.edges.map(({ edge, x1, y1, x2, y2 }) => (
            <line
              key={edge.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={edge.coreOrPeripheral === 'core' ? styles.edgeCore : styles.edge}
              strokeWidth={edge.coreOrPeripheral === 'core' ? 2 : 1}
              strokeDasharray={edge.coreOrPeripheral === 'core' ? undefined : '4 3'}
              opacity={edge.review === 'candidate' ? 0.6 : 1}
              markerEnd="url(#scg-arrow)"
            >
              <title>{`${edge.prerequisiteName} (${edge.coreOrPeripheral === 'core' ? 'cốt lõi' : 'phụ'})`}</title>
            </line>
          ))}
          {layout.nodes.map(({ node, x, y, selected: current }) => (
            <g
              key={node.id}
              className={`${styles.node} ${node.kind === 'external' ? styles.external : ''} ${current ? styles.selected : ''}`}
              opacity={node.kind === 'contribution' && node.review === 'candidate' && !current ? 0.6 : 1}
            >
              <title>
                {node.kind === 'contribution'
                  ? `${node.name} · ${node.paperTitle}`
                  : `${node.name} · ${whereLabel(node)}`}
              </title>
              <rect x={x} y={y} width={nodeWidth} height={nodeHeight} />
              <text x={x + 8} y={y + nodeHeight / 2 + 4}>
                {clip(node.name)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
