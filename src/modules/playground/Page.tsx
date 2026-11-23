import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { EXAMPLES } from '@/core/playground/examples';
import { buildBody, schemaToFields, valuesFrom, type Values } from '@/core/playground/formFields';
import { TOOL_GROUPS, toolGroup } from '@/core/playground/groups';
import { useAuth } from '@/shared/auth/authContext';
import { useAdmin } from '@/shared/auth/useAdmin';
import {
  createLabResearchClient,
  labResearchErrorMessage,
  LAB_RESEARCH_URL,
  type LabTool,
} from '@/shared/labResearch';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { ActivityStatus } from '@/shared/ui/ActivityStatus';
import { Card } from '@/shared/ui/Card';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ToolForm } from './ToolForm';
import { ResultView } from './ResultView';
import styles from './page.module.css';

type Run = { tool: string; time: string; duration: number; ok: boolean; output?: unknown; error?: unknown };
type ToolCatalog = { uid: string; attempt: number; tools: LabTool[]; error?: unknown };

export default function Page() {
  const { user, ready, getAccessToken, getIdToken } = useAuth();
  const { admin, checking: adminChecking } = useAdmin();
  const getToken = getAccessToken ?? getIdToken;
  const client = useMemo(() => createLabResearchClient({ baseUrl: LAB_RESEARCH_URL, getToken }), [getToken]);
  const [health, setHealth] = useState<boolean | null>(null);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [catalog, setCatalog] = useState<ToolCatalog>({ uid: '', attempt: -1, tools: [] });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [group, setGroup] = useState('search');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [shown, setShown] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!ready || !user || adminChecking || !admin) return;
    let active = true;
    void client.health().then(
      () => {
        if (active) setHealth(true);
      },
      () => {
        if (active) setHealth(false);
      },
    );
    return () => {
      active = false;
    };
  }, [admin, adminChecking, client, healthAttempt, ready, user]);

  useEffect(() => {
    if (!ready || !user || adminChecking || !admin) return;
    let active = true;
    void client.listTools().then(
      (items) => {
        if (!active) return;
        setCatalog({ uid: user.uid, attempt: catalogAttempt, tools: items });
        setSelected((current) => (items.some((item) => item.name === current) ? current : ''));
      },
      (error: unknown) => {
        if (!active) return;
        setCatalog({ uid: user.uid, attempt: catalogAttempt, tools: [], error });
      },
    );
    return () => {
      active = false;
    };
  }, [admin, adminChecking, catalogAttempt, client, ready, user]);

  const catalogState = !ready
    ? 'auth-loading'
    : !user
      ? 'signed-out'
      : catalog.uid !== user.uid || catalog.attempt !== catalogAttempt
        ? 'loading'
        : catalog.error
          ? 'error'
          : 'ready';
  const tools = user && catalog.uid === user.uid ? catalog.tools : [];
  const visibleTools = tools.filter((item) => toolGroup(item.name) === group);
  const tool = tools.find((item) => item.name === selected);
  const fields = useMemo(() => schemaToFields(tool?.input_schema ?? {}), [tool]);

  if (adminChecking) {
    return (
      <div className={styles.page}>
        <PageHeader title="Playground" lead="Thử và kiểm tra các công cụ nghiên cứu của lab." />
        <Card className={styles.accessState}>
          <ActivityStatus label="Đang xác minh quyền quản trị…" />
        </Card>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className={styles.page}>
        <PageHeader title="Playground" lead="Thử và kiểm tra các công cụ nghiên cứu của lab." />
        <Card className={styles.accessState}>
          <LockKeyhole size={22} aria-hidden="true" />
          <div>
            <h2>Playground chỉ dành cho admin</h2>
            <p>
              {!ready || !user
                ? 'Đăng nhập bằng tài khoản lab có quyền admin để dùng các công cụ thử nghiệm.'
                : 'Tài khoản hiện tại không có quyền admin. Quyền này được xác nhận bởi máy chủ lab.'}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  function selectTool(item: LabTool) {
    setSelected(item.name);
    setValues(valuesFrom(schemaToFields(item.input_schema)));
    setErrors({});
    setShown(null);
  }

  function changeGroup(value: string) {
    setGroup(value);
    setSelected('');
    setValues({});
    setErrors({});
    setShown(null);
  }

  function changeField(name: string, value: string | boolean) {
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }

  async function run() {
    if (!tool || running) return;
    const result = buildBody(fields, values);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) return;

    setRunning(true);
    const start = performance.now();
    const time = new Date().toISOString();
    let entry: Run;
    try {
      const output = await client.callTool(tool.name, result.body);
      entry = { tool: tool.name, time, duration: Math.round(performance.now() - start), ok: true, output };
    } catch (error) {
      entry = { tool: tool.name, time, duration: Math.round(performance.now() - start), ok: false, error };
    } finally {
      setRunning(false);
    }
    setRuns((previous) => [entry, ...previous].slice(0, 10));
    setShown(entry);
  }

  const catalogError = catalogState === 'error' ? catalog.error : undefined;
  return (
    <div className={styles.page}>
      <PageHeader title="Playground" lead="Thử và kiểm tra các công cụ nghiên cứu của lab." />

      <Card className={styles.connection}>
        <div className={styles.connectionMain}>
          <span className={styles.connectionIcon}>
            <Server size={18} aria-hidden="true" />
          </span>
          <div className={styles.connectionText}>
            <strong>Lab Research MCP</strong>
            <span>{LAB_RESEARCH_URL || 'Máy chủ chưa được cấu hình'}</span>
          </div>
          <Badge tone={health === true ? 'success' : health === false ? 'danger' : 'neutral'}>
            <span
              className={`${styles.statusDot} ${health === true ? styles.online : health === false ? styles.offline : ''}`}
            />
            {health === null ? 'Đang kiểm tra' : health ? 'Đang hoạt động' : 'Không kết nối được'}
          </Badge>
        </div>
        <div className={styles.connectionActions}>
          <span className={styles.sessionState}>
            <ShieldCheck size={15} aria-hidden="true" />
            {!ready
              ? 'Đang xác thực phiên…'
              : user
                ? 'Đã xác thực tài khoản lab'
                : 'Cần đăng nhập tài khoản lab'}
          </span>
          {health === false && (
            <Button size="sm" onClick={() => setHealthAttempt((attempt) => attempt + 1)}>
              <RefreshCw size={14} aria-hidden="true" /> Thử kết nối lại
            </Button>
          )}
        </div>
      </Card>

      <div className={styles.workspace}>
        <Card className={styles.catalogPanel}>
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon}>
              <Wrench size={17} aria-hidden="true" />
            </span>
            <div>
              <h2>Công cụ</h2>
              <p>
                {catalogState === 'ready' ? `${tools.length} công cụ khả dụng` : 'Danh mục Lab Research MCP'}
              </p>
            </div>
          </div>

          <div className={styles.groupList} role="group" aria-label="Nhóm công cụ">
            {TOOL_GROUPS.map(({ id, label }) => (
              <Button
                key={id}
                size="sm"
                className={`${styles.groupButton} ${group === id ? styles.groupButtonSelected : ''}`}
                aria-pressed={group === id}
                onClick={() => changeGroup(id)}
              >
                {label}
              </Button>
            ))}
          </div>

          {catalogState === 'auth-loading' && <ActivityStatus label="Đang kiểm tra tài khoản…" />}
          {catalogState === 'signed-out' && (
            <div className={styles.inlineNotice} role="status">
              Đăng nhập tài khoản lab để tải danh sách và chạy công cụ.
            </div>
          )}
          {catalogState === 'loading' && <ActivityStatus label="Đang tải danh sách công cụ…" />}
          {catalogError != null && (
            <div className={styles.errorNotice} role="alert">
              <strong>{labResearchErrorMessage(catalogError)}</strong>
              <details>
                <summary>Chi tiết kỹ thuật</summary>
                {catalogError instanceof Error ? catalogError.message : String(catalogError)}
              </details>
              <Button size="sm" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>
                <RefreshCw size={14} aria-hidden="true" /> Thử tải lại
              </Button>
            </div>
          )}
          {catalogState === 'ready' && tools.length === 0 && (
            <div className={styles.emptyCatalog}>
              <FlaskConical size={19} aria-hidden="true" />
              <strong>Chưa có công cụ khả dụng</strong>
              <span>Máy chủ đã phản hồi nhưng chưa công bố công cụ nào.</span>
            </div>
          )}
          {catalogState === 'ready' && tools.length > 0 && visibleTools.length === 0 && (
            <div className={styles.inlineNotice}>Nhóm này hiện chưa có công cụ.</div>
          )}
          {catalogState === 'ready' && visibleTools.length > 0 && (
            <div className={styles.toolList} aria-label="Danh sách công cụ">
              {visibleTools.map((item) => (
                <Button
                  key={item.name}
                  className={`${styles.toolOption} ${selected === item.name ? styles.toolOptionSelected : ''}`}
                  aria-pressed={selected === item.name}
                  onClick={() => selectTool(item)}
                >
                  <span className={styles.toolOptionTitle}>{item.name}</span>
                  <span className={styles.toolOptionDescription}>
                    {item.description || 'Không có mô tả.'}
                  </span>
                </Button>
              ))}
            </div>
          )}

          <section className={styles.history} aria-labelledby="playground-history-title">
            <div className={styles.historyHeading}>
              <Clock3 size={15} aria-hidden="true" />
              <h3 id="playground-history-title">Lịch sử phiên</h3>
              <span>{runs.length}</span>
            </div>
            {runs.length === 0 ? (
              <p>Chạy công cụ để xem các kết quả gần đây trong phiên này.</p>
            ) : (
              <ul>
                {runs.map((entry, index) => (
                  <li key={`${entry.time}-${index}`}>
                    <Button
                      size="sm"
                      className={`${styles.historyItem} ${shown === entry ? styles.historyItemActive : ''}`}
                      aria-pressed={shown === entry}
                      onClick={() => setShown(entry)}
                    >
                      <span>{entry.ok ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}</span>
                      <span className={styles.historyText}>
                        <strong>{entry.tool}</strong>
                        <small>
                          {new Date(entry.time).toLocaleTimeString('vi-VN')} · {entry.duration} ms
                        </small>
                      </span>
                      <Badge tone={entry.ok ? 'success' : 'danger'}>{entry.ok ? 'OK' : 'Lỗi'}</Badge>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Card>

        <Card className={styles.workPanel}>
          {!tool ? (
            <div className={styles.workEmpty}>
              <span className={styles.emptyIcon}>
                <FlaskConical size={24} aria-hidden="true" />
              </span>
              <h2>Không gian chạy công cụ</h2>
              <p>Chọn một công cụ ở danh sách để xem đầu vào, điền dữ liệu và chạy thử.</p>
              <div className={styles.emptySteps}>
                <span>
                  <b>1</b> Chọn công cụ
                </span>
                <span>
                  <b>2</b> Kiểm tra dữ liệu
                </span>
                <span>
                  <b>3</b> Xem kết quả
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.workHeading}>
                <div className={styles.workTitle}>
                  <span className={styles.panelIcon}>
                    <FlaskConical size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <span className={styles.eyebrow}>LAB RESEARCH TOOL</span>
                    <h2>{tool.name}</h2>
                  </div>
                </div>
                <Badge tone="accent">{fields.length} trường đầu vào</Badge>
              </div>
              <p className={styles.toolDescription}>{tool.description || 'Công cụ chưa có mô tả.'}</p>
              <form
                className={styles.form}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void run();
                }}
              >
                {fields.length > 0 ? (
                  <ToolForm fields={fields} values={values} errors={errors} change={changeField} />
                ) : (
                  <div className={styles.inlineNotice}>Công cụ này không yêu cầu tham số đầu vào.</div>
                )}
                <div className={styles.formFooter}>
                  <div className={styles.formHint}>
                    {running ? (
                      <ActivityStatus label="Đang chờ máy chủ xử lý…" />
                    ) : (
                      <span>Kiểm tra các trường bắt buộc trước khi chạy.</span>
                    )}
                  </div>
                  <div className={styles.formActions}>
                    {EXAMPLES[tool.name] && (
                      <Button
                        type="button"
                        onClick={() => {
                          setValues(valuesFrom(fields, EXAMPLES[tool.name]));
                          setErrors({});
                        }}
                      >
                        Điền ví dụ
                      </Button>
                    )}
                    <Button type="submit" variant="primary" disabled={running || !user}>
                      {running ? 'Đang chạy…' : 'Chạy công cụ'}
                    </Button>
                  </div>
                </div>
              </form>
            </>
          )}

          {shown && (
            <section className={styles.result} aria-live="polite" aria-label="Kết quả chạy công cụ">
              <div className={styles.resultHeading}>
                <div>
                  <span className={styles.eyebrow}>
                    {shown === runs[0] ? 'LẦN CHẠY MỚI NHẤT' : 'LỊCH SỬ PHIÊN'}
                  </span>
                  <h2>{shown.ok ? 'Kết quả' : 'Không thể chạy công cụ'}</h2>
                  <p>
                    {shown.tool} · {new Date(shown.time).toLocaleString('vi-VN')} · {shown.duration} ms
                  </p>
                </div>
                <Badge tone={shown.ok ? 'success' : 'danger'}>{shown.ok ? 'Thành công' : 'Thất bại'}</Badge>
              </div>
              {shown.ok ? (
                <ResultView key={shown.time} output={shown.output} />
              ) : (
                <div className={styles.errorNotice} role="alert">
                  <strong>{labResearchErrorMessage(shown.error)}</strong>
                  <details>
                    <summary>Chi tiết kỹ thuật</summary>
                    {shown.error instanceof Error ? shown.error.message : String(shown.error)}
                  </details>
                </div>
              )}
            </section>
          )}
        </Card>
      </div>
    </div>
  );
}
