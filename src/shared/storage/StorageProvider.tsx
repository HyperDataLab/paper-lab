import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { RemoteDocStore } from './remoteDocStore';
import { createRepositories, type Repositories } from './repositories';
const Context = createContext<Repositories | null>(null);
const StoreContext = createContext<{ store: RemoteDocStore; error: string } | null>(null);
const noopSubscribe = () => () => {};
const idle = () => 'idle' as const;

export function StorageProvider({
  children,
  repositories,
}: {
  children: ReactNode;
  repositories?: Repositories;
}) {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const [configurationError, setConfigurationError] = useState<{
    store: RemoteDocStore;
    message: string;
  } | null>(null);
  const storage = useMemo(() => {
    if (repositories || !uid) return null;
    const store = new RemoteDocStore({
      getToken: () => getIdToken(uid),
      onConfigurationError: (message) =>
        setConfigurationError((current) =>
          message ? { store, message } : current?.store === store ? null : current,
        ),
    });
    return {
      store,
      repositories: createRepositories(store),
    };
  }, [getIdToken, repositories, uid]);
  const error = configurationError?.store === storage?.store ? (configurationError?.message ?? '') : '';
  return (
    <StoreContext.Provider value={storage ? { store: storage.store, error } : null}>
      <Context.Provider value={repositories ?? storage?.repositories ?? null} key={uid ?? 'signed-out'}>
        {children}
      </Context.Provider>
    </StoreContext.Provider>
  );
}

export function StorageStatus({ className }: { className?: string }) {
  const storage = useContext(StoreContext);
  const store = storage?.store;
  const repo = useContext(Context);
  const runs = useSyncExternalStore(
    repo?.paperRuns.subscribe ?? noopSubscribe,
    repo?.paperRuns.getSaveStatus ?? idle,
  );
  const measurements = useSyncExternalStore(
    repo?.measurements.checkpoints.subscribe ?? noopSubscribe,
    repo?.measurements.checkpoints.getSaveStatus ?? idle,
  );
  const spike = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSaveStatus ?? idle);
  const pending = [runs, measurements, spike];
  const status = pending.includes('error') ? 'error' : pending.includes('saving') ? 'saving' : 'idle';
  if (status === 'idle' && !storage?.error) return null;
  return (
    <div className={className} role="status">
      {status !== 'idle' && <span>{status === 'saving' ? 'Đang lưu…' : 'Lỗi lưu'}</span>}
      {storage?.error && (
        <div role="alert">
          Kho dữ liệu lab chưa được cấu hình.
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {storage.error}
          </details>
        </div>
      )}
    </div>
  );
}
// The provider and its hook form one public storage entry point.
// eslint-disable-next-line react-refresh/only-export-components
export function useRepositories() {
  const value = useContext(Context);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
