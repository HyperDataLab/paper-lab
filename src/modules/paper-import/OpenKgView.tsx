import { useMemo, useState } from 'react';
import { KG_LAYERS, toJsonLd, toSciAtlasReport, toTurtle, type KgLayer, type PaperKg } from '@/core/openkg';
import type { Finding, PaperModelSentence } from '@/core/schemas';
import { downloadText } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { OpenKgGraph } from '@/shared/ui/openkg/OpenKgGraph';
import { OpenKgTriples } from '@/shared/ui/openkg/OpenKgTriples';
import { LAYER_LABELS } from '@/shared/ui/openkg/labels';
import styles from '@/shared/ui/openkg/openkg.module.css';

const EXPORTS = [
  { label: 'Turtle (.ttl)', extension: 'ttl', mime: 'text/turtle', serialize: toTurtle },
  { label: 'JSON-LD (.jsonld)', extension: 'jsonld', mime: 'application/ld+json', serialize: toJsonLd },
  { label: 'Báo cáo (.md)', extension: 'md', mime: 'text/markdown', serialize: toSciAtlasReport },
];
const SALIENCE_LABELS = new Map([
  ['high', 'Cao'],
  ['middle', 'Vừa'],
  ['low', 'Thấp'],
]);

export function OpenKgView({
  kg,
  sentences,
  hasLookup,
  hasScg,
  hasArguments,
  onLocation,
}: {
  kg: PaperKg;
  sentences: PaperModelSentence[];
  hasLookup: boolean;
  hasScg: boolean;
  hasArguments: boolean;
  onLocation: (location: Finding['locations'][number]) => void;
}) {
  const [enabled, setEnabled] = useState<readonly KgLayer[]>(KG_LAYERS);
  const [selected, setSelected] = useState<string>();
  const [showText, setShowText] = useState(false);
  const article = kg.nodes.find((node) => node.type === 'Paper');
  const counts = new Map<KgLayer, number>();
  for (const edge of kg.edges) counts.set(edge.layer, (counts.get(edge.layer) ?? 0) + 1);
  const { graph, nodes } = useMemo(() => {
    const nodes = new Map(
      kg.nodes
        .filter((node) => node.type === 'Paper' || enabled.includes(node.layer))
        .map((node) => [node.id, node]),
    );
    const edges = kg.edges.filter(
      (edge) => enabled.includes(edge.layer) && nodes.has(edge.s) && nodes.has(edge.o),
    );
    return { graph: { nodes: [...nodes.values()], edges }, nodes };
  }, [kg, enabled]);
  const byKey = useMemo(() => new Map(sentences.map((sentence) => [sentence.key, sentence])), [sentences]);
  const current = selected ? nodes.get(selected) : undefined;
  const selectedEdges = current
    ? graph.edges.filter((edge) => edge.s === current.id || edge.o === current.id)
    : [];
  const salience = SALIENCE_LABELS.get(String(current?.attrs.salience));
  const lookupMissing = 'Chưa có dữ liệu OpenAlex trong Thư viện DOI.';
  const notices: Partial<Record<KgLayer, string>> = {
    evidential: !counts.get('evidential') ? 'Chưa có references hoặc thông tin nơi xuất bản.' : undefined,
    conceptual: !hasScg
      ? 'Chưa chạy SCG để lấy contribution và nền tảng.'
      : !counts.get('conceptual')
        ? 'Chưa có từ khóa hoặc contribution đã trích.'
        : undefined,
    disciplinary: !counts.get('disciplinary')
      ? hasLookup
        ? 'Bản tra cứu chưa lưu mã phân loại.'
        : lookupMissing
      : undefined,
    expertise: !counts.get('expertise')
      ? hasLookup
        ? 'Bản tra cứu chưa lưu tác giả có mã định danh.'
        : lookupMissing
      : undefined,
    normative: !counts.get('normative')
      ? hasArguments
        ? 'Chưa có claim gắn với văn bản hiện tại.'
        : 'Chưa chạy phân tích argument.'
      : undefined,
  };
  return (
    <div className={styles.workspace}>
      <div className={styles.toolbar}>
        <fieldset className={styles.layers}>
          <legend>Số bộ ba theo lớp</legend>
          {KG_LAYERS.map((layer) => (
            <span key={layer} className={styles.toggle} data-layer={layer}>
              <Checkbox
                checked={enabled.includes(layer)}
                onChange={({ currentTarget: { checked } }) =>
                  setEnabled((previous) =>
                    checked ? [...previous, layer] : previous.filter((value) => value !== layer),
                  )
                }
              >
                <span className={styles.swatch} aria-hidden="true" />
                {LAYER_LABELS[layer]} ({counts.get(layer) ?? 0})
              </Checkbox>
            </span>
          ))}
        </fieldset>
        <div className={styles.exports} role="group" aria-label="Xuất đồ thị">
          {EXPORTS.map(({ label, extension, mime, serialize }) => (
            <Button
              key={extension}
              size="sm"
              onClick={() =>
                downloadText(
                  `openkg-${article?.id.split('/').at(-1) ?? 'paper'}.${extension}`,
                  serialize(kg),
                  mime,
                )
              }
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {Object.values(notices).some(Boolean) && (
        <ul className={styles.notices} aria-label="Dữ liệu còn thiếu">
          {KG_LAYERS.map(
            (layer) =>
              notices[layer] && (
                <li key={layer}>
                  <strong>{LAYER_LABELS[layer]}</strong> · <span>{notices[layer]}</span>
                </li>
              ),
          )}
        </ul>
      )}
      <div className={styles.layout}>
        <OpenKgGraph graph={graph} selected={current?.id} onSelect={setSelected} />
        <aside className={styles.inspector} aria-label="Chi tiết nút">
          <h3 aria-live="polite">{current?.label ?? 'Chi tiết nút'}</h3>
          {current ? (
            <>
              {salience && <p className={styles.muted}>Mức nổi bật · {salience}</p>}
              <OpenKgTriples edges={selectedEdges} nodes={nodes} sentences={byKey} onLocation={onLocation} />
            </>
          ) : (
            <p className={styles.muted}>Chọn một nút để xem các bộ ba và câu dẫn chứng.</p>
          )}
        </aside>
      </div>
      <details className={styles.textList} onToggle={(event) => setShowText(event.currentTarget.open)}>
        <summary>Danh sách bộ ba ({graph.edges.length})</summary>
        {showText && (
          <OpenKgTriples edges={graph.edges} nodes={nodes} sentences={byKey} onLocation={onLocation} />
        )}
      </details>
    </div>
  );
}
