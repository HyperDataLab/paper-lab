import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { RESEARCH_HUB_URL, SSO_BASE_URL } from '@/shared/auth/config';
import {
  ProjectWorkspaceError,
  projectWorkspaceSnapshot,
  pullProjectWorkspace,
  pushProjectWorkspace,
} from '@/shared/projectWorkspace';
import { createDb, type ParagraphDb } from './db';
import { createRepositories, type Repositories } from './repositories';
import styles from './storageProvider.module.css';
import {
  exportProjectWorkspace,
  hasProjectData,
  importProjectWorkspace,
  sameWorkspaceData,
} from './projectWorkspace';

const Context = createContext<Repositories | null>(null);
const ProjectContext = createContext<string | null>(null);
export type ProjectWorkspaceStatus = 'loading' | 'signed-out' | 'synced' | 'syncing' | 'error' | 'conflict';
const ProjectStatusContext = createContext<{
  projectId: string | null;
  projectName: string;
  status: ProjectWorkspaceStatus;
  error: string;
} | null>(null);
const LEGACY_MIGRATION_KEY = 'paperlab:researchhub-migrated-project';
type SyncStatus = ProjectWorkspaceStatus;

const PROJECT_TABLES = new Set([
  'analyses',
  'papers',
  'paperRuns',
  'paperOverviews',
  'paperChecks',
  'paperReviews',
  'paperProbes',
  'measurements',
  'library',
  'stance',
  'paperContext',
  'paperInsights',
  'corpora',
  'corpusProfiles',
  'corpusTopics',
  'topicNames',
  'corpusKeywords',
  'doiKeywords',
  'extractionProjects',
  'researchDesigns',
  'researchDesignBanks',
  'scgRuns',
  'grobid',
]);

async function diagnoseRejectedToken(token: string) {
  if (!SSO_BASE_URL) return 'Không thể đối chiếu token: PaperLab chưa cấu hình SSO_BASE_URL.';
  try {
    const response = await fetch(new URL('/oauth/userinfo', SSO_BASE_URL), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return 'SSO xác nhận token hợp lệ, nhưng PaperLab Worker từ chối token. Cần kiểm tra cấu hình SSO đang chạy trên Worker.';
    }
    if (response.status === 401 || response.status === 403) {
      return `SSO cũng từ chối token (HTTP ${response.status}); PaperLab cần nhận lại phiên mới từ ResearchHub.`;
    }
    return `Không đối chiếu được token với SSO (HTTP ${response.status}).`;
  } catch {
    return 'Không kết nối được SSO để đối chiếu token; không thể kết luận token có hợp lệ hay không.';
  }
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

export function StorageProvider({
  children,
  repositories,
  projectId = null,
  invalidProjectId = false,
  hideStatusBanner = false,
}: {
  children: ReactNode;
  repositories?: Repositories;
  projectId?: string | null;
  invalidProjectId?: boolean;
  hideStatusBanner?: boolean;
}) {
  const db = useMemo(() => createDb(projectId ? `paragraph-lab-${projectId}` : undefined), [projectId]);
  const value = useMemo(() => repositories ?? createRepositories(db), [db, repositories]);
  const {
    user,
    ready: authReady,
    error: authError,
    handoffFailed = false,
    signIn,
    getAccessToken: ssoToken,
    getIdToken,
  } = useAuth();
  const getAccessToken = ssoToken ?? getIdToken;
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [projectName, setProjectName] = useState('');
  const [syncError, setSyncError] = useState('');
  const [sessionRejected, setSessionRejected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const modulesReady = useRef(false);
  const dbCloseTimers = useRef(new Map<ParagraphDb, ReturnType<typeof setTimeout>>());
  const visibleStatus: SyncStatus = invalidProjectId
    ? 'error'
    : !authReady
      ? 'loading'
      : handoffFailed || !user
        ? 'signed-out'
        : status;
  const projectStatus = useMemo(
    () => ({ projectId, projectName, status: visibleStatus, error: syncError }),
    [projectId, projectName, visibleStatus, syncError],
  );

  useEffect(() => {
    const closeTimers = dbCloseTimers.current;
    const pendingClose = closeTimers.get(db);
    if (pendingClose !== undefined) {
      clearTimeout(pendingClose);
      closeTimers.delete(db);
    }
    return () => {
      const closeTimer = setTimeout(() => {
        db.close();
        closeTimers.delete(db);
      }, 0);
      closeTimers.set(db, closeTimer);
    };
  }, [db]);

  useEffect(() => {
    if (invalidProjectId) {
      return;
    }
    if (!projectId) {
      modulesReady.current = false;
      return;
    }
    if (!authReady) {
      return;
    }
    if (!user) {
      modulesReady.current = false;
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let versionValue: string | null = null;
    let pushing = false;
    let dirtyWhilePushing = false;
    let blocked = false;
    modulesReady.current = false;

    const runInitialSync = async () => {
      const token = await getAccessToken();
      if (!token) throw new ProjectWorkspaceError(401, 'Phiên SSO đã hết hạn. Hãy đăng nhập lại.');
      let remote;
      try {
        remote = await pullProjectWorkspace(projectId, token);
      } catch (cause) {
        if (cause instanceof ProjectWorkspaceError && cause.status === 401) {
          throw new ProjectWorkspaceError(401, `${cause.message} ${await diagnoseRejectedToken(token)}`);
        }
        throw cause;
      }
      if (!active) return;
      setProjectName(remote.project.name);
      versionValue = remote.version;
      const local = await exportProjectWorkspace(db, value, projectId);
      if (remote.snapshot) {
        await importProjectWorkspace(db, value, remote.snapshot);
        const merged = await exportProjectWorkspace(db, value, projectId);
        if (!sameWorkspaceData(merged.payload, remote.snapshot.payload)) {
          const result = await pushProjectWorkspace(
            projectWorkspaceSnapshot(projectId, merged.payload),
            versionValue,
            token,
          );
          versionValue = result.version;
        }
        try {
          localStorage.setItem(LEGACY_MIGRATION_KEY, projectId);
        } catch {
          /* Private browsing may disable local storage. */
        }
      } else if (hasProjectData(local.payload)) {
        const result = await pushProjectWorkspace(local, null, token);
        versionValue = result.version;
        try {
          localStorage.setItem(LEGACY_MIGRATION_KEY, projectId);
        } catch {
          /* Private browsing may disable local storage. */
        }
      } else {
        let migratedTo: string | null = null;
        try {
          migratedTo = localStorage.getItem(LEGACY_MIGRATION_KEY);
        } catch {
          /* Continue without a one-time migration marker. */
        }
        if (!migratedTo) {
          const legacyDb = createDb();
          const legacyRepositories = createRepositories(legacyDb);
          try {
            const legacy = await exportProjectWorkspace(legacyDb, legacyRepositories, projectId);
            if (hasProjectData(legacy.payload)) {
              await importProjectWorkspace(db, value, legacy);
              const migrated = await exportProjectWorkspace(db, value, projectId);
              const result = await pushProjectWorkspace(migrated, null, token);
              versionValue = result.version;
            }
            try {
              localStorage.setItem(LEGACY_MIGRATION_KEY, projectId);
            } catch {
              /* Private browsing may disable local storage. */
            }
          } finally {
            legacyDb.close();
          }
        }
      }
      if (!active) return;
      modulesReady.current = true;
      setSessionRejected(false);
      setStatus('synced');
    };

    const pushLatest = async () => {
      if (!active || blocked) return;
      if (pushing) {
        dirtyWhilePushing = true;
        return;
      }
      pushing = true;
      setStatus('syncing');
      try {
        const token = await getAccessToken();
        if (!token) throw new ProjectWorkspaceError(401, 'Phiên SSO đã hết hạn. Hãy đăng nhập lại.');
        const snapshot = await exportProjectWorkspace(db, value, projectId);
        const result = await pushProjectWorkspace(snapshot, versionValue, token);
        versionValue = result.version;
        setProjectName(result.project.name);
        setSyncError('');
        setSessionRejected(false);
        setStatus('synced');
      } catch (cause) {
        if (cause instanceof ProjectWorkspaceError && cause.status === 412) {
          blocked = true;
          setStatus('conflict');
          setSyncError('Project được cập nhật ở phiên khác. Tải lại để ghép bản mới nhất.');
        } else {
          const rejected = cause instanceof ProjectWorkspaceError && cause.status === 401;
          setSessionRejected(rejected);
          setStatus('error');
          setSyncError(cause instanceof Error ? cause.message : 'Không đồng bộ được project.');
        }
      } finally {
        pushing = false;
        if (dirtyWhilePushing && !blocked && active) {
          dirtyWhilePushing = false;
          timer = setTimeout(() => void pushLatest(), 500);
        }
      }
    };

    const schedulePush = () => {
      if (!active || !modulesReady.current || blocked) return;
      setStatus('syncing');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void pushLatest(), 900);
    };

    void Promise.resolve().then(() => {
      if (active) {
        setStatus('loading');
        setSyncError('');
      }
      return runInitialSync();
    }).catch((cause: unknown) => {
      if (!active) return;
      const rejected = cause instanceof ProjectWorkspaceError && cause.status === 401;
      setSessionRejected(rejected);
      setStatus(cause instanceof ProjectWorkspaceError && cause.status === 412 ? 'conflict' : 'error');
      setSyncError(cause instanceof Error ? cause.message : 'Không tải được project từ ResearchHub.');
    });

    const subscribed = db.tables.filter((table) => PROJECT_TABLES.has(table.name));
    for (const table of subscribed) {
      table.hook.creating.subscribe(schedulePush);
      table.hook.updating.subscribe(schedulePush);
      table.hook.deleting.subscribe(schedulePush);
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      for (const table of subscribed) {
        table.hook.creating.unsubscribe(schedulePush);
        table.hook.updating.unsubscribe(schedulePush);
        table.hook.deleting.unsubscribe(schedulePush);
      }
    };
  }, [attempt, authReady, db, getAccessToken, invalidProjectId, projectId, user, value]);

  const retry = useCallback(() => {
    modulesReady.current = false;
    setAttempt((current) => current + 1);
  }, []);
  const workspaceGate = invalidProjectId ? (
    <section role="alert" style={{ padding: 20 }}>
      projectId trên liên kết ResearchHub không hợp lệ.
    </section>
  ) : !projectId ? (
    <section style={{ padding: 20 }}>
      <h1>Cần mở một project ResearchHub</h1>
      <p>PaperLab yêu cầu đăng nhập HyperDataLab SSO và một project bạn có quyền truy cập. Hãy mở PaperLab từ workspace của project trong ResearchHub.</p>
      {RESEARCH_HUB_URL && <a href={`${RESEARCH_HUB_URL}/projects`}>Mở ResearchHub</a>}
    </section>
  ) : projectId && visibleStatus === 'signed-out' ? (
    handoffFailed ? (
      <section className={styles.sessionGate} role="alert">
        <div className={styles.sessionHeading}>
          <span className={styles.sessionIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 20 7v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Z" />
              <path d="M9 12h6M12 9v6" />
            </svg>
          </span>
          <div>
            <h1>Không nhận được phiên từ ResearchHub</h1>
            <p>PaperLab đã bỏ session cũ để tránh dùng nhầm. Mở lại công cụ từ project ResearchHub; PaperLab sẽ nhận phiên hiện tại, không chuyển bạn sang trang đăng nhập SSO.</p>
          </div>
        </div>
        {authError && <p className={styles.sessionError}>{authError}</p>}
        {RESEARCH_HUB_URL && (
          <div className={styles.sessionActions}>
            <a className={styles.sessionPrimary} href={RESEARCH_HUB_URL + '/projects/' + encodeURIComponent(projectId ?? '')}>
              Mở project ResearchHub
            </a>
          </div>
        )}
      </section>
    ) : (
      <section style={{ padding: 20 }}>
        <h1>Đăng nhập ResearchHub</h1>
        <p>Đăng nhập HyperDataLab SSO để mở project này. PaperLab sẽ giữ nguyên projectId qua bước đăng nhập.</p>
        {authError && <p role="alert">{authError}</p>}
        <button type="button" onClick={() => void signIn()}>Đăng nhập bằng SSO</button>
      </section>
    )
  ) : projectId && visibleStatus === 'loading' ? (
    <p role="status" style={{ padding: 20 }}>Đang kiểm tra quyền và tải workspace ResearchHub…</p>
  ) : projectId && (visibleStatus === 'error' || visibleStatus === 'conflict') ? (
    <section role="alert" className={sessionRejected ? styles.sessionGate : undefined}>
      {sessionRejected ? (
        <>
          <div className={styles.sessionHeading}>
            <span className={styles.sessionIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </svg>
            </span>
            <div>
              <h1>Không xác minh được phiên ResearchHub</h1>
              <p>PaperLab không xác minh được phiên đang dùng. Tài khoản ResearchHub vẫn giữ nguyên; hãy mở lại công cụ từ project để chuyển phiên hiện tại sang PaperLab.</p>
            </div>
          </div>
          {authError && <p className={styles.sessionError}>{authError}</p>}
          <div className={styles.sessionActions}>
            {RESEARCH_HUB_URL && (
              <a className={styles.sessionPrimary} href={`${RESEARCH_HUB_URL}/projects/${encodeURIComponent(projectId ?? '')}`}>
                Mở project ResearchHub
              </a>
            )}
            <button className={styles.sessionSecondary} type="button" onClick={retry}>
              Thử lại
            </button>
          </div>
          {syncError && (
            <details className={styles.sessionDetails}>
              <summary>Chi tiết kỹ thuật</summary>
              <code>{syncError}</code>
            </details>
          )}
        </>
      ) : (
        <>
      <h1>
        {visibleStatus === 'conflict'
          ? 'Project có thay đổi mới'
          : 'Không mở được project'}
      </h1>
      <p>{syncError}</p>
      <button
        type="button"
        onClick={
          visibleStatus === 'conflict'
            ? () => window.location.reload()
            : retry
        }
      >
        {visibleStatus === 'conflict'
          ? 'Tải lại và ghép dữ liệu'
          : 'Thử lại'}
      </button>
        </>
      )}
    </section>
  ) : null;

  return (
    <ProjectStatusContext.Provider value={projectStatus}>
      <ProjectContext.Provider value={projectId}>
        <Context.Provider value={value}>
        {workspaceGate ?? (
          <>
            {!hideStatusBanner && projectId ? (
              <div role="status" style={{ padding: '8px 8px', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                ResearchHub · {projectName || projectId} · {visibleStatus === 'syncing' ? 'Đang đồng bộ…' : 'Đã đồng bộ'}
                {visibleStatus === 'error' && syncError && ` · ${syncError}`}
              </div>
            ) : !hideStatusBanner ? (
              <div role="status" style={{ padding: '8px 8px', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                Chưa liên kết ResearchHub project · dữ liệu lưu cục bộ trên trình duyệt.
              </div>
            ) : null}
            {children}
          </>
        )}
        </Context.Provider>
      </ProjectContext.Provider>
    </ProjectStatusContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRepositories() {
  const value = useContext(Context);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
