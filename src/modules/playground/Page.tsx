import { useEffect, useMemo, useState } from 'react';
import { EXAMPLES } from '@/core/playground/examples';
import { buildBody, schemaToFields, valuesFrom, type Values } from '@/core/playground/formFields';
import { TOOL_GROUPS, toolGroup } from '@/core/playground/groups';
import { useAuth } from '@/shared/auth/authContext';
import {
  createLabResearchClient,
  labResearchErrorMessage,
  LAB_RESEARCH_URL,
  type LabTool,
} from '@/shared/labResearch';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { PageHeader } from '@/shared/ui/PageHeader';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { ToolForm } from './ToolForm';
import { ResultView } from './ResultView';
import styles from './page.module.css';

type Run = { tool: string; time: string; duration: number; ok: boolean; output?: unknown; error?: unknown };
export default function Page() {
  const { user, ready, getIdToken } = useAuth();
  const client = useMemo(
    () => createLabResearchClient({ baseUrl: LAB_RESEARCH_URL, getToken: getIdToken }),
    [getIdToken],
  );
  const [health, setHealth] = useState<boolean | null>(null);
  const [tools, setTools] = useState<LabTool[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [group, setGroup] = useState('search');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [shown, setShown] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
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
  }, [client]);
  useEffect(() => {
    let active = true;
    if (ready && user)
      void client.listTools().then(
        (items) => {
          if (active) {
            setTools(items);
            setSelected('');
            setLoadError(null);
          }
        },
        (error: unknown) => {
          if (active) setLoadError(error);
        },
      );
    return () => {
      active = false;
    };
  }, [client, user, ready]);
  const tool = user ? tools.find((item) => item.name === selected) : undefined;
  const fields = useMemo(() => schemaToFields(tool?.input_schema ?? {}), [tool]);
  function select(item: LabTool) {
    setSelected(item.name);
    setValues(valuesFrom(schemaToFields(item.input_schema)));
    setErrors({});
  }
  async function run() {
    if (!tool) return;
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
    }
    setRuns((previous) => [entry, ...previous].slice(0, 10));
    setShown(entry);
    setRunning(false);
  }
  const error = shown && !shown.ok ? shown.error : loadError;
  return (
    <div className={styles.page}>
      <PageHeader title="Playground" lead="Thử các công cụ nghiên cứu của lab." />
      <Card>
        <p>Máy chủ: {LAB_RESEARCH_URL || 'chưa cấu hình'}</p>
        <Badge tone={health === true ? 'success' : health === false ? 'danger' : 'neutral'}>
          {health === null ? 'Đang kiểm tra…' : health ? 'Máy chủ hoạt động' : 'Không kết nối được'}
        </Badge>
        <p>
          {!ready
            ? 'Đang kiểm tra tài khoản…'
            : user
              ? `Đã đăng nhập: ${user.email}`
              : 'Đăng nhập tài khoản lab để chạy công cụ'}
        </p>
      </Card>
      <Card>
        <h2>Công cụ</h2>
        <SegmentedControl
          label="Nhóm công cụ"
          value={group}
          onChange={(value) => {
            setGroup(value);
            setSelected('');
          }}
          options={TOOL_GROUPS.map(({ id, label }) => ({ value: id, label }))}
        />
        <div className={styles.tools}>
          {(user ? tools : [])
            .filter((item) => toolGroup(item.name) === group)
            .map((item) => (
              <div key={item.name}>
                <Button onClick={() => select(item)}>{item.name}</Button>
                <p>{item.description}</p>
              </div>
            ))}
        </div>
        {tool && (
          <section className={styles.form}>
            <h3>{tool.name}</h3>
            <ToolForm
              fields={fields}
              values={values}
              errors={errors}
              change={(name, value) => setValues((previous) => ({ ...previous, [name]: value }))}
            />
            <div>
              <Button
                disabled={!EXAMPLES[tool.name]}
                onClick={() => {
                  setValues(valuesFrom(fields, EXAMPLES[tool.name]));
                  setErrors({});
                }}
              >
                Điền ví dụ
              </Button>{' '}
              <Button variant="primary" disabled={running || !user} onClick={() => void run()}>
                {running ? 'Đang chạy…' : 'Chạy'}
              </Button>
            </div>
          </section>
        )}
      </Card>
      {error != null && (
        <Card>
          <div role="alert">
            <p>{labResearchErrorMessage(error)}</p>
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error instanceof Error ? error.message : String(error)}
            </details>
          </div>
        </Card>
      )}
      {shown && (
        <Card>
          <h2>Kết quả · {shown.tool}</h2>
          <p>
            {shown.ok ? 'Thành công' : 'Lỗi'} · {shown.duration} ms
          </p>
          {shown.ok && <ResultView output={shown.output} />}
        </Card>
      )}
      <Card>
        <h2>Lịch sử phiên</h2>
        <p>Kết quả chỉ giữ trong phiên này và không được lưu.</p>
        {runs.map((entry, index) => (
          <p key={`${entry.time}-${index}`}>
            <Button size="sm" onClick={() => setShown(entry)}>
              {entry.tool} · {new Date(entry.time).toLocaleTimeString('vi-VN')} ·{' '}
              {entry.ok ? 'Thành công' : 'Lỗi'} · {entry.duration} ms
            </Button>
          </p>
        ))}
      </Card>
    </div>
  );
}
