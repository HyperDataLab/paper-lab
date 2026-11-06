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
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { useToast } from '@/shared/ui/toastContext';
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
      <h1>Cài đặt</h1>
      <Card>
        <h2>Kết nối 9router</h2>
        <TextField
          label="Base URL"
          value={baseUrl}
          placeholder="/llm"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p>
          /llm = proxy của máy chủ (khoá nằm ở máy chủ). URL đầy đủ = gọi trực tiếp, cần khoá và endpoint cho
          phép CORS.
        </p>
        <p>
          Content-Security-Policy khi triển khai chỉ cho phép các host 9router/Worker được liệt kê trong
          firebase.json.
        </p>
        <TextField label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
        <TextField
          label="API key"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          disabled={isProxyBaseUrl(baseUrl)}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className={styles.actions}>
          <Button type="button" disabled={isProxyBaseUrl(baseUrl)} onClick={() => setShow(!show)}>
            {show ? 'Ẩn khoá' : 'Hiện khoá'}
          </Button>
          <Button
            type="button"
            disabled={isProxyBaseUrl(baseUrl)}
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
        <div className={styles.actions}>
          <Button onClick={save}>Lưu</Button>
          <Button
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
      </Card>
      <Card>
        <h2>Kiểm tra kết nối</h2>
        <Button disabled={busy} onClick={() => void test()}>
          {busy ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
        </Button>
        {message && <p role="status">{message}</p>}
        {detail && (
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {detail}
          </details>
        )}
      </Card>
      <Card>
        <h2>Quyền riêng tư</h2>
        {consent && hasValidConsent(config) ? (
          <p>
            Đã đồng ý · phiên bản {consent.version} · {consent.provider} · {consent.model} ·{' '}
            {new Date(consent.acceptedAt).toLocaleString('vi-VN')}
          </p>
        ) : (
          <p>Chưa có đồng ý hợp lệ cho kết nối hiện tại.</p>
        )}
        <Button onClick={revoke}>Thu hồi đồng ý</Button>
      </Card>
    </div>
  );
}
