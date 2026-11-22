import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { RESEARCH_HUB_URL } from '@/shared/auth/config';
import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';
import { RemoteDocStore } from './remoteDocStore';
import { createRepositories, type Repositories } from './repositories';
import { ProjectAccessGate } from './ProjectAccessGate';
import { AlertCircle, CloudUpload } from 'lucide-react';
import statusStyles from './storage-status.module.css';

const Context = createContext<Repositories | null>(null);
const StoreContext = createContext<{ store: RemoteDocStore; error: string } | null>(null);
const ProjectContext = createContext<string | null>(null);
type ProjectWorkspaceStatus = 'loading' | 'signed-out' | 'synced' | 'syncing' | 'error' | 'conflict';
const ProjectStatusContext = createContext<{
  projectId: string | null;
  projectName: string;
  status: ProjectWorkspaceStatus;
  error: string;
} | null>(null);
const noopSubscribe = () => () => {};
const idle = () => 'idle' as const;

export function StorageProvider({
  children,
  repositories,
  projectId = null,
  invalidProjectId = false,
}: {
  children: ReactNode;
  repositories?: Repositories;
  projectId?: string | null;
  invalidProjectId?: boolean;
  hideStatusBanner?: boolean;
}) {
  const { user, ready, error: authError, handoffFailed = false, signIn, getAccessToken, getIdToken } = useAuth();
  // A supplied repository is an explicit in-memory/test adapter; production App never supplies one.
  const injectedRepositories = repositories !== undefined;
  const effectiveProjectId = projectId ?? (
    injectedRepositories && import.meta.env.MODE === 'test'
      ? '00000000-0000-4000-8000-000000000001'
      : null
  );
  const uid = user?.uid;
  const token = getAccessToken ?? getIdToken;
  const [configurationError, setConfigurationError] = useState<{ store: RemoteDocStore; message: string } | null>(null);
  const [verification, setVerification] = useState<{
    key: string;
    status: ProjectWorkspaceStatus;
    name: string;
    error: string;
  } | null>(null);
  const verificationKey = uid && effectiveProjectId ? `${uid}:${effectiveProjectId}` : '';

  const storage = useMemo(() => {
    if (repositories || !uid || !effectiveProjectId || invalidProjectId) return null;
    const store = new RemoteDocStore({
      getToken: token,
      projectId: effectiveProjectId,
      onConfigurationError: (message) =>
        setConfigurationError((current) => (message ? { store, message } : current?.store === store ? null : current)),
    });
    return { store, repositories: createRepositories(store) };
  }, [effectiveProjectId, invalidProjectId, repositories, token, uid]);

  useEffect(() => {
    if (injectedRepositories || invalidProjectId || !effectiveProjectId || !ready || !uid) return;

    let active = true;
    void (async () => {
      const accessToken = await token();
      if (!accessToken) throw new Error('Không nhận được phiên HyperDataLab SSO từ ResearchHub.');
      const response = await fetch(projectScopedUrl(`${PDF_WORKER_URL}/v1/me`, effectiveProjectId), {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Project-Id': effectiveProjectId },
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : `Worker trả về HTTP ${response.status}.`;
        throw new Error(detail);
      }
      const name = body && typeof body === 'object' && 'project' in body && body.project && typeof body.project === 'object' && 'name' in body.project && typeof body.project.name === 'string'
        ? body.project.name
        : effectiveProjectId;
      if (active) {
        setVerification({ key: `${uid}:${effectiveProjectId}`, status: 'synced', name, error: '' });
      }
    })().catch((cause: unknown) => {
      if (!active) return;
      setVerification({
        key: `${uid}:${effectiveProjectId}`,
        status: 'error',
        name: effectiveProjectId,
        error: cause instanceof Error ? cause.message : 'Không xác minh được quyền truy cập project ResearchHub.',
      });
    });
    return () => {
      active = false;
    };
  }, [injectedRepositories, invalidProjectId, effectiveProjectId, ready, token, uid]);

  const status: ProjectWorkspaceStatus = injectedRepositories
    ? 'synced'
    : invalidProjectId || !effectiveProjectId
    ? 'error'
    : !ready
      ? 'loading'
      : !uid
        ? 'signed-out'
        : verification?.key === verificationKey
          ? verification.status
          : 'loading';
  const projectName = verification?.key === verificationKey ? verification.name : effectiveProjectId ?? '';
  const projectError = injectedRepositories
    ? ''
    : invalidProjectId
    ? 'projectId trên liên kết ResearchHub không hợp lệ.'
    : !effectiveProjectId
      ? 'Hãy mở PaperLab từ một project ResearchHub.'
      : !uid
        ? authError
        : verification?.key === verificationKey
          ? verification.error
          : '';

  const error = configurationError && configurationError.store === storage?.store ? configurationError.message : '';
  const saveState = useSyncExternalStore(
    storage?.store.subscribe ?? noopSubscribe,
    storage?.store.getSaveStatus ?? idle,
  );
  const visibleStatus = saveState === 'error' ? 'error' : saveState === 'saving' ? 'syncing' : status;
  const projectStatus = useMemo(
    () => ({ projectId: effectiveProjectId, projectName, status: visibleStatus, error: projectError || error }),
    [effectiveProjectId, error, projectError, projectName, visibleStatus],
  );
  const retrySignIn = useCallback(() => void signIn(), [signIn]);

  let gate: ReactNode = null;
  if (invalidProjectId) {
    gate = <section role="alert"><h1>Liên kết project không hợp lệ</h1><p>{projectError}</p></section>;
  } else if (!effectiveProjectId) {
    gate = (
      <section>
        <h1>Cần mở một project ResearchHub</h1>
        <p>PaperLab lưu dữ liệu theo project đang làm việc. Hãy mở công cụ từ project trong ResearchHub.</p>
        {RESEARCH_HUB_URL && <a href={`${RESEARCH_HUB_URL}/projects`}>Mở ResearchHub</a>}
      </section>
    );
  } else if (!ready) {
    gate = (
      <ProjectAccessGate
        title="Đang kết nối phiên làm việc"
        description="PaperLab đang kiểm tra phiên ResearchHub để mở đúng không gian nghiên cứu."
        statusLabel="Đang kiểm tra phiên ResearchHub…"
      />
    );
  } else if (!user) {
    gate = (
      <section role="alert">
        <h1>{handoffFailed ? 'Không nhận được phiên ResearchHub' : 'Cần phiên HyperDataLab SSO'}</h1>
        <p>{authError || 'Mở PaperLab từ project ResearchHub để chuyển phiên hiện tại.'}</p>
        {RESEARCH_HUB_URL && <a href={`${RESEARCH_HUB_URL}/projects/${encodeURIComponent(effectiveProjectId)}`}>Mở project ResearchHub</a>}
        {!handoffFailed && <button type="button" onClick={retrySignIn}>Đăng nhập bằng SSO</button>}
      </section>
    );
  } else if (status === 'loading') {
    gate = (
      <ProjectAccessGate
        title="Đang xác minh project"
        description="Đang kiểm tra quyền truy cập vào không gian nghiên cứu bạn vừa mở."
        statusLabel="Đang xác minh quyền truy cập project…"
      />
    );
  } else if (status === 'error') {
    gate = (
      <section role="alert">
        <h1>Không mở được project</h1>
        <p>{projectError}</p>
        {RESEARCH_HUB_URL && <a href={`${RESEARCH_HUB_URL}/projects/${encodeURIComponent(effectiveProjectId)}`}>Mở project ResearchHub</a>}
      </section>
    );
  }

  return (
    <ProjectStatusContext.Provider value={projectStatus}>
      <ProjectContext.Provider value={effectiveProjectId}>
        <StoreContext.Provider value={storage ? { store: storage.store, error } : null}>
          <Context.Provider value={repositories ?? storage?.repositories ?? null} key={`${uid ?? 'signed-out'}:${effectiveProjectId ?? 'no-project'}`}>
          {injectedRepositories ? children : gate ?? children}
          </Context.Provider>
        </StoreContext.Provider>
      </ProjectContext.Provider>
    </ProjectStatusContext.Provider>
  );
}

export function StorageStatus({ className }: { className?: string }) {
  const storage = useContext(StoreContext);
  const store = storage?.store;
  const repo = useContext(Context);
  const runs = useSyncExternalStore(repo?.paperRuns.subscribe ?? noopSubscribe, repo?.paperRuns.getSaveStatus ?? idle);
  const measurements = useSyncExternalStore(
    repo?.measurements.checkpoints.subscribe ?? noopSubscribe,
    repo?.measurements.checkpoints.getSaveStatus ?? idle,
  );
  const workspace = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSaveStatus ?? idle);
  const pending = [runs, measurements, workspace];
  const status = pending.includes('error') ? 'error' : pending.includes('saving') ? 'saving' : 'idle';
  if (status === 'idle' && !storage?.error) return null;
  return (
    <div className={className} role="status">
      {status !== 'idle' && (
        <span className={`${statusStyles.badge} ${status === 'error' ? statusStyles.error : ''}`}>
          {status === 'saving' ? <CloudUpload size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
          {status === 'saving' ? 'Đang lưu thay đổi…' : 'Lỗi lưu'}
        </span>
      )}
      {storage?.error && <div role="alert">Kho dữ liệu project chưa được cấu hình.<details><summary>Chi tiết kỹ thuật</summary>{storage.error}</details></div>}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHubProjectId() {
  return useContext(ProjectContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectWorkspaceStatus() {
  const value = useContext(ProjectStatusContext);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRepositories() {
  const value = useContext(Context);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
