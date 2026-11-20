import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { criticModelFor, getConfig, type LlmConfig } from './config';
import {
  acceptConsent,
  getConsent,
  hasValidConsent,
  hasPaperConsent,
  hasAutoResearchConsent,
  providerFor,
  revokeConsent,
  type Consent,
  type ConsentScope,
} from './consent';
import { createGatedClient } from './gatedClient';
import type { LlmClient } from './client';
type ContextValue = {
  config: LlmConfig;
  client: LlmClient;
  criticClient: LlmClient;
  consent: Consent | null;
  ensureConsent: (scope?: ConsentScope) => Promise<boolean>;
  refreshConfig: () => void;
  revoke: () => void;
};
const Context = createContext<ContextValue | null>(null);
export function LlmProvider({
  children,
  innerClient,
}: {
  children: ReactNode;
  /** Test seam: replaces the network client. It is still wrapped by the consent gate. */
  innerClient?: LlmClient;
}) {
  const [config, setConfig] = useState(getConfig);
  const [consent, setConsent] = useState(getConsent);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ConsentScope>();
  const pending = useRef<Array<(value: boolean) => void>>([]);
  const client = useMemo(() => createGatedClient(config, innerClient), [config, innerClient]);
  const criticClient = useMemo(
    () =>
      criticModelFor(config) === config.model
        ? client
        : createGatedClient({ ...config, model: criticModelFor(config) }, innerClient),
    [config, client, innerClient],
  );
  const ensureConsent = (requestedScope?: ConsentScope) => {
    if (
      requestedScope === 'autoresearch'
        ? hasAutoResearchConsent(config)
        : requestedScope === 'paper'
          ? hasPaperConsent(config) && hasValidConsent(config)
          : hasValidConsent(config)
    )
      return Promise.resolve(true);
    setScope(requestedScope);
    setOpen(true);
    return new Promise<boolean>((resolve) => pending.current.push(resolve));
  };
  const close = (accepted: boolean) => {
    const paper = scope === 'paper' || scope === 'autoresearch';
    const record = accepted ? acceptConsent(config, paper, scope === 'autoresearch') : null;
    if (record) setConsent(record);
    setOpen(false);
    pending.current.splice(0).forEach((resolve) => resolve(Boolean(record)));
  };
  return (
    <Context.Provider
      value={{
        config,
        client,
        criticClient,
        consent,
        ensureConsent,
        refreshConfig: () => {
          setConfig(getConfig());
          setConsent(getConsent());
        },
        revoke: () => {
          revokeConsent();
          setConsent(getConsent());
        },
      }}
    >
      {children}
      {open && (
        <Dialog
          title="Thông báo quyền riêng tư"
          description={
            scope === 'autoresearch'
              ? 'Charter, chỉ dẫn, nội dung bài báo được chọn và dữ liệu AutoResearch sẽ được gửi tới các model đã cấu hình qua 9router. Từ khoá tra cứu có thể được gửi tới OpenAlex và máy chủ lab khi đã đăng nhập. Bạn có thể thu hồi đồng ý trong Cài đặt.'
              : scope === 'paper'
                ? 'Các đoạn được chọn của bản thảo sẽ được gửi tới mô hình đã cấu hình. Bạn có thể thu hồi đồng ý trong Cài đặt.'
                : scope === 'kg'
                  ? 'Câu hỏi và schema của KG sẽ được gửi tới model đã cấu hình qua 9router. SQL được chạy trên máy chủ lab. Bạn có thể thu hồi đồng ý trong Cài đặt.'
                  : 'Văn bản của paragraph sẽ được gửi tới endpoint 9router đã cấu hình. Không tải lên nơi nào khác; dữ liệu còn lại nằm trong trình duyệt này. Bạn có thể thu hồi đồng ý trong Cài đặt.'
          }
          onClose={() => close(false)}
        >
          <p>
            Nhà cung cấp: {providerFor(config)} · Model: {config.model}
            {scope === 'autoresearch' && ` · Critic: ${criticModelFor(config)}`}
          </p>
          <Button onClick={() => close(true)}>Đồng ý và tiếp tục</Button>{' '}
          <Button onClick={() => close(false)}>Huỷ</Button>
        </Dialog>
      )}
    </Context.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useLlm() {
  const value = useContext(Context);
  if (!value) throw new Error('LlmProvider is missing');
  return value;
}
