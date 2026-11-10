import { useState } from 'react';
import { z } from 'zod';
import { CONNECTION_TEST_SYSTEM, CONNECTION_TEST_USER, PROMPT_VERSIONS } from '@/core/prompts';
import { defaultConfig, isProxyBaseUrl, resetConfig, saveConfig, validateConfig } from '@/shared/llm/config';
import { hasValidConsent } from '@/shared/llm/consent';
import {
  InvalidModelOutputError,
  LlmConfigError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from '@/shared/llm/errors';
import { useLlm } from '@/shared/llm/LlmProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { useToast } from '@/shared/ui/toastContext';
import { getScholarEmail, saveScholarEmail } from '@/shared/scholar/settings';
import styles from './page.module.css';
export default function Page() {
  const toast = useToast();
  const { config, client, consent, ensureConsent, refreshConfig, revoke } = useLlm();
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [key, setKey] = useState(config.key ?? '');
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [scholarEmail, setScholarEmail] = useState(() => getScholarEmail() ?? '');
  const [scholarMessage, setScholarMessage] = useState('');
  const proxy = isProxyBaseUrl(baseUrl);
  const save = () => {
    try {
      const next = { baseUrl: baseUrl.trim(), model: model.trim(), key };
      validateConfig(next);
      saveConfig(next);
      refreshConfig();
      setMessage('Đã lưu cài đặt.');
      toast('Đã lưu');
      setDetail('');
    } catch {
      setMessage('URL hoặc model không hợp lệ, hoặc không thể lưu trên trình duyệt này.');
    }
  };
  const test = async () => {
    if (!(await ensureConsent())) return;
    setBusy(true);
    setMessage('');
    setDetail('');
    try {
      const result = await client.completeJson({
        system: CONNECTION_TEST_SYSTEM,
        user: CONNECTION_TEST_USER,
        schema: z.object({ ok: z.literal(true), model: z.string() }),
        schemaName: 'connection_test',
        promptVersion: PROMPT_VERSIONS.connectionTest,
      });
      setMessage(`Kết nối thành công: ${result.data.model} · ${result.meta.latencyMs} ms`);
    } catch (error) {
      setMessage(
        error instanceof LlmHttpError && error.status === 401
          ? 'Khoá không hợp lệ'
          : error instanceof LlmTimeoutError
            ? 'Kết nối quá thời gian chờ'
            : error instanceof InvalidModelOutputError
              ? 'Phản hồi của model không hợp lệ'
              : error instanceof LlmConfigError
                ? 'Cấu hình kết nối không hợp lệ'
                : error instanceof LlmNetworkError
                  ? 'Không kết nối được (kiểm tra CORS hoặc mạng)'
                  : 'Không thể kiểm tra kết nối',
      );
      setDetail(error instanceof Error ? error.message : 'Lỗi không xác định');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.page}>
      <PageHeader
        title="Cài đặt"
        lead="Kết nối AI, tra cứu bài báo và quyền riêng tư. Mọi thiết lập chỉ lưu trong trình duyệt này."
      />
      <Card>
        <div className={styles.section}>
          <header>
            <h2>Kết nối AI</h2>
            <p>PaperLab gọi model qua 9router, một endpoint tương thích OpenAI.</p>
          </header>
          <TextField
            label="Base URL"
            value={baseUrl}
            placeholder="/llm"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className={styles.hint}>
            /llm = proxy của máy chủ (khoá nằm ở máy chủ). URL đầy đủ = gọi trực tiếp, cần khoá và endpoint
            cho phép CORS.
          </p>
          <TextField label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
          <div className={styles.keyRow}>
            <TextField
              label="API key"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              disabled={proxy}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="button" disabled={proxy} onClick={() => setShow(!show)}>
              {show ? 'Ẩn khoá' : 'Hiện khoá'}
            </Button>
            <Button
              type="button"
              disabled={proxy}
              onClick={() => {
                setKey('');
                try {
                  saveConfig({ ...config, key: '' });
                  refreshConfig();
                } catch {
                  setMessage('Không thể xoá khoá.');
                }
              }}
            >
              Xoá khoá
            </Button>
          </div>
          <p className={styles.hint}>
            {proxy
              ? 'Đang dùng proxy nên không cần nhập khoá.'
              : 'Khoá chỉ lưu trong trình duyệt này và chỉ gửi tới endpoint ở trên.'}
          </p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            Content-Security-Policy khi triển khai chỉ cho phép các host 9router/Worker được liệt kê trong
            firebase.json.
          </details>
          <div className={styles.footer}>
            <Button variant="primary" onClick={save}>
              Lưu
            </Button>
            <Button disabled={busy} onClick={() => void test()}>
              {busy ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
            </Button>
            <span className={styles.spacer} />
            <Button
              variant="ghost"
              onClick={() => {
                try {
                  resetConfig();
                  const defaults = defaultConfig();
                  setBaseUrl(defaults.baseUrl);
                  setModel(defaults.model);
                  setKey('');
                  refreshConfig();
                  setMessage('Đã khôi phục mặc định.');
                } catch {
                  setMessage('Không thể khôi phục mặc định.');
                }
              }}
            >
              Khôi phục mặc định
            </Button>
          </div>
          {message && <p role="status">{message}</p>}
          {detail && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {detail}
            </details>
          )}
        </div>
      </Card>
      <Card>
        <div className={styles.section}>
          <header>
            <h2>Tra cứu bài báo</h2>
            <p>
              Unpaywall yêu cầu một email trong mỗi lượt tra cứu. Email chỉ lưu trên trình duyệt này và chỉ
              gửi tới Unpaywall. Để trống thì thư viện vẫn tra qua OpenAlex, Crossref và Europe PMC.
            </p>
          </header>
          <TextField
            label="Email cho Unpaywall"
            type="email"
            value={scholarEmail}
            onChange={(event) => setScholarEmail(event.target.value)}
          />
          <div className={styles.start}>
            <Button
              onClick={() =>
                setScholarMessage(saveScholarEmail(scholarEmail) ? 'Đã lưu email.' : 'Email chưa hợp lệ.')
              }
            >
              Lưu email
            </Button>
          </div>
          {scholarMessage && <p role="status">{scholarMessage}</p>}
        </div>
      </Card>
      <Card>
        <div className={styles.section}>
          <header>
            <h2>Quyền riêng tư</h2>
            <p>Mỗi lần gọi AI, văn bản được gửi tới endpoint ở trên. App hỏi bạn đồng ý trước lần gọi đầu.</p>
          </header>
          {consent && hasValidConsent(config) ? (
            <div className={styles.statusRow}>
              <Badge tone="success">Đã đồng ý</Badge>
              <span>
                phiên bản {consent.version} · {consent.provider} · {consent.model} ·{' '}
                {new Date(consent.acceptedAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ) : (
            <div className={styles.statusRow}>
              <Badge>Chưa đồng ý</Badge>
              <span>Chưa có đồng ý hợp lệ cho kết nối hiện tại.</span>
            </div>
          )}
          <div className={styles.start}>
            <Button onClick={revoke}>Thu hồi đồng ý</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
