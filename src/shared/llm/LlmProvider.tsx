import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { getConfig, type LlmConfig } from './config';
import {
  acceptConsent,
  getConsent,
  hasValidConsent,
  providerFor,
  revokeConsent,
  type Consent,
} from './consent';
import { createGatedClient } from './gatedClient';
import type { LlmClient } from './client';
type ContextValue = {
  config: LlmConfig;
  client: LlmClient;
  consent: Consent | null;
  ensureConsent: () => Promise<boolean>;
  refreshConfig: () => void;
  revoke: () => void;
};
const Context = createContext<ContextValue | null>(null);
export function LlmProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(getConfig);
  const [consent, setConsent] = useState(getConsent);
  const [open, setOpen] = useState(false);
  const pending = useRef<Array<(value: boolean) => void>>([]);
  const client = useMemo(() => createGatedClient(config), [config]);
  const ensureConsent = () => {
    if (hasValidConsent(config)) return Promise.resolve(true);
    setOpen(true);
    return new Promise<boolean>((resolve) => pending.current.push(resolve));
  };
  const close = (accepted: boolean) => {
    const record = accepted ? acceptConsent(config) : null;
    if (record) setConsent(record);
    setOpen(false);
    pending.current.splice(0).forEach((resolve) => resolve(Boolean(record)));
  };
  return (
    <Context.Provider
      value={{
        config,
        client,
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
          description="Văn bản đoạn văn sẽ được gửi tới endpoint 9router đã cấu hình. Không tải lên nơi nào khác; dữ liệu còn lại nằm trong trình duyệt này. Bạn có thể thu hồi đồng ý trong Cài đặt."
          onClose={() => close(false)}
        >
          <p>
            Nhà cung cấp: {providerFor(config)} · Model: {config.model}
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
