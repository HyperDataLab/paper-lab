import { FileCheck2, Link2, PenLine, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ParagraphModes } from '@/modules/evaluate';
import { PageHeader } from '@/shared/ui/PageHeader';
import { buildGeneration } from '@/core/generation';
import { GenerationInputSchema, type GenerationInput } from '@/core/prompts/generation';
import type { Generation } from '@/core/schemas';
import { describeLlmError } from '@/shared/llm/describeError';
import { createLlmGenerator } from '@/shared/llm/llmGenerator';
import { useLlm } from '@/shared/llm/LlmProvider';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { useToast } from '@/shared/ui/toastContext';
import { GenerationForm } from './GenerationForm';
import { GenerationResult } from './GenerationResult';
import { checkLabels } from './checkLabels';
import styles from './page.module.css';

const initial: GenerationInput = {
  mainClaim: '',
  evidence: [{ id: 'e1', text: '', citation: null }],
  audience: 'specialist',
  structure: 'auto',
  preserveTerms: [],
  hedging: 'keep_as_given',
};
export default function Page() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const navigate = useNavigate();
  const repo = useRepositories();
  const { client, ensureConsent } = useLlm();
  const provider = useMemo(() => createLlmGenerator(client), [client]);
  const toast = useToast();
  const [input, setInput] = useState<GenerationInput>(initial);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [restored, setRestored] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [technical, setTechnical] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void repo.generations
      .get(id)
      .then((item) => {
        if (!active) return;
        if (!item) throw new Error('Generation not found');
        setInput(item.input);
        setGeneration(item);
        setRestored((value) => value + 1);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError('Không thể tải đoạn đã soạn.');
          setTechnical(String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [id, repo]);
  function change(value: GenerationInput) {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setInput(value);
    setGeneration(null);
  }
  async function generate() {
    setAttempted(true);
    if (
      !GenerationInputSchema.safeParse(input).success ||
      input.evidence.some((item) => !item.text.trim()) ||
      running
    )
      return;
    setError('');
    setTechnical('');
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    try {
      if (!(await ensureConsent()) || current.signal.aborted) return;
      const result = await provider.generate(input, current.signal);
      if (current.signal.aborted) return;
      const value = buildGeneration(input, result.output, {
        id: crypto.randomUUID(),
        model: result.model,
        createdAt: new Date().toISOString(),
      });
      await repo.generations.create(value);
      if (!current.signal.aborted) setGeneration(value);
    } catch (cause) {
      if (!current.signal.aborted) {
        setError(describeLlmError(cause) ?? 'Không thể soạn đoạn.');
        setTechnical(String(cause));
      }
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  async function accept(override = false) {
    if (!generation || accepting) return;
    setAccepting(true);
    try {
      const analysis = await repo.generations.acceptGeneration(generation.id, override);
      navigate(`/evaluate?id=${analysis.id}`);
    } catch (cause) {
      setError('Không thể dùng đoạn này.');
      setTechnical(String(cause));
    } finally {
      setAccepting(false);
      setConfirm(false);
    }
  }
  const failed = generation?.checks.overall.filter((check) => check.status === 'fail') ?? [];
  return (
    <div className={styles.page}>
      <PageHeader
        title="Soạn đoạn văn"
        lead="Viết một đoạn từ luận điểm và bằng chứng bạn đưa vào. AI không thêm số liệu hay nguồn mới."
      >
        {!id && !generation && <ParagraphModes current="/generate" />}
      </PageHeader>
      {(running || generation) && (
        <ActionBar status={running ? <span role="status">Đang soạn đoạn…</span> : undefined}>
          {running && (
            <Button
              variant="danger"
              onClick={() => {
                controller.current?.abort();
                controller.current = null;
                setRunning(false);
              }}
            >
              Huỷ
            </Button>
          )}
          {generation && (
            <>
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(generation.paragraph)
                    .then(() => toast('Đã sao chép đoạn văn'))
                    .catch((cause: unknown) => {
                      setError('Không thể sao chép đoạn văn.');
                      setTechnical(String(cause));
                    })
                }
              >
                Sao chép
              </Button>
              <Button
                variant="primary"
                disabled={accepting || running}
                onClick={() => (failed.length ? setConfirm(true) : void accept())}
              >
                Dùng đoạn này
              </Button>
            </>
          )}
        </ActionBar>
      )}
      <div className={generation ? styles.grid : styles.setup}>
        <GenerationForm
          key={restored}
          input={input}
          onChange={change}
          attempted={attempted}
          highlighted={highlighted}
          initialStep={restored ? 2 : 0}
          finishLabel={generation ? 'Soạn lại' : 'Soạn đoạn (AI)'}
          finishDisabled={running}
          finishVariant={generation ? 'secondary' : 'primary'}
          onFinish={() => void generate()}
        />
        {generation ? (
          <GenerationResult generation={generation} highlight={setHighlighted} />
        ) : (
          <aside className={styles.guide} aria-labelledby="generate-guide">
            <h2 id="generate-guide">AI sẽ làm gì</h2>
            <ul>
              <li>
                <FileCheck2 size={16} aria-hidden="true" />
                <span>
                  <strong>Chỉ dùng đầu vào của bạn</strong>
                  <small>Không thêm số liệu, nguồn hay sự kiện mới.</small>
                </span>
              </li>
              <li>
                <Link2 size={16} aria-hidden="true" />
                <span>
                  <strong>Gắn mỗi câu với bằng chứng</strong>
                  <small>Rê chuột lên e1, e2… trong đoạn để thấy câu dựa vào đâu.</small>
                </span>
              </li>
              <li>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  <strong>Tự kiểm tra sau khi viết</strong>
                  <small>
                    Số liệu, phủ định và mức dè dặt phải khớp đầu vào; câu không đạt được đánh dấu.
                  </small>
                </span>
              </li>
              <li>
                <PenLine size={16} aria-hidden="true" />
                <span>
                  <strong>Bạn quyết định</strong>
                  <small>Dùng đoạn này sẽ mở nó trong Đánh giá để phân tích tiếp.</small>
                </span>
              </li>
            </ul>
          </aside>
        )}
      </div>
      {error && (
        <div role="alert">
          {error}
          {technical && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              <code>{technical}</code>
            </details>
          )}
        </div>
      )}
      {confirm && (
        <Dialog
          title="Dùng đoạn dù kiểm tra không đạt?"
          description="Hãy xem lại các kiểm tra sau trước khi xác nhận."
          onClose={() => setConfirm(false)}
        >
          <ul>
            {failed.map((check) => (
              <li key={check.id}>
                {checkLabels[check.id] ?? check.id}: {check.detail}
              </li>
            ))}
          </ul>
          <Button onClick={() => setConfirm(false)}>Quay lại</Button>
          <Button variant="primary" disabled={accepting} onClick={() => void accept(true)}>
            Xác nhận dùng đoạn
          </Button>
        </Dialog>
      )}
    </div>
  );
}
