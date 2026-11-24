import { Menu, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Drawer } from '@/shared/ui/Drawer';
import { IconButton } from '@/shared/ui/IconButton';
import { Button } from '@/shared/ui/Button';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { Kbd } from '@/shared/ui/Kbd';
import { Skeleton } from '@/shared/ui/Skeleton';
import { StorageProvider, StorageStatus } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { AuthProvider } from '@/shared/auth/AuthProvider';
import { AccountButton } from './AccountButton';
import { CommandPalette } from './CommandPalette';
import { modules } from './modules';
import { Sidebar } from './Sidebar';
import { PageEnter } from '@/shared/motion/PageEnter';
import PaperMapPage from '@/modules/paper-import/PaperMapPage';
import ExtractionProjectPage from '@/modules/extraction/ProjectPage';
import CorpusDetail from '@/modules/corpus/DetailPage';
import ReportPage from '@/modules/report/ReportPage';
import ComparePage from '@/modules/report/ComparePage';
import styles from './shell.module.css';
type Theme = 'light' | 'dark' | 'system';
const THEME_LABELS: Record<Theme, string> = { system: 'Hệ thống', light: 'Sáng', dark: 'Tối' };
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
function readTheme(): Theme {
  try {
    const value = localStorage.getItem('theme');
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* Storage may be unavailable. */
  }
  return 'light';
}
export function App() {
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const location = useLocation();
  const navigate = useNavigate();
  const rawProjectId = new URLSearchParams(location.search).get('projectId');
  const validProjectId =
    rawProjectId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(rawProjectId)
      ? rawProjectId
      : null;
  const invalidProjectId = rawProjectId !== null && !validProjectId;
  const [lastProjectId, setLastProjectId] = useState<string | null>(validProjectId);
  // Keep the current workspace mounted while navigation restores a query param omitted by a module link.
  const workspaceProjectId =
    validProjectId ?? (!invalidProjectId && rawProjectId === null ? lastProjectId : null);
  const current = modules.find(
    (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
  );
  const knownRoute =
    modules.some(
      (item) =>
        location.pathname === item.path ||
        (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)),
    ) ||
    location.pathname === '/compare' ||
    /^\/(?:report|papers|extraction|corpus)\/[^/]+$/u.test(location.pathname);
  // Workspaces and wide tables use the whole window; lists, forms and home stay at a readable width.
  const wideContent =
    location.pathname === '/' ||
    location.pathname === '/compare' ||
    location.pathname === '/extraction' ||
    location.pathname === '/papers' ||
    location.pathname.startsWith('/extraction/') ||
    location.pathname.startsWith('/corpus/') ||
    location.pathname.startsWith('/papers/') ||
    location.pathname === '/lab-kg' ||
    location.pathname === '/playground';
  // A paper is a workspace: on wide screens it fills the window and its columns scroll on their own.
  const appContent = /^\/papers\/[^/]+/.test(location.pathname);
  const projectDetailContent = /^\/extraction\/[^/]+$/u.test(location.pathname);
  const corpusDetailContent = /^\/corpus\/[^/]+$/u.test(location.pathname);
  const fullWidthPageContent =
    location.pathname === '/' ||
    location.pathname === '/papers' ||
    location.pathname === '/extraction' ||
    location.pathname === '/corpus' ||
    location.pathname === '/lab-kg' ||
    location.pathname === '/playground' ||
    location.pathname === '/transfer';
  useEffect(() => {
    if (invalidProjectId) {
      // Route changes may remove projectId for one render; keep the last accepted ID for that transition.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastProjectId(null);
      return;
    }
    if (validProjectId) {
      // This mirrors the URL handoff into render state so StorageProvider never remounts during navigation.
      setLastProjectId(validProjectId);
      return;
    }
    if (lastProjectId && !rawProjectId) {
      const query = new URLSearchParams(location.search);
      query.set('projectId', lastProjectId);
      navigate(`${location.pathname}?${query.toString()}${location.hash}`, { replace: true });
    }
  }, [
    invalidProjectId,
    lastProjectId,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    rawProjectId,
    validProjectId,
  ]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [theme]);
  if (!knownRoute)
    return (
      <main>
        <h1>Không tìm thấy trang</h1>
        <p>Đường dẫn này không tồn tại.</p>
      </main>
    );
  return (
    <ToastProvider>
      <AuthProvider>
        <div className={styles.shell}>
          <Sidebar desktop />
          <Drawer open={drawer} onClose={closeDrawer}>
            <Sidebar mobile onNavigate={closeDrawer} />
          </Drawer>
          <div className={styles.main}>
            <header className={styles.topbar}>
              <div className={styles.mobileMenu}>
                <IconButton label="Mở menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
                  <Menu size={20} />
                </IconButton>
              </div>
              <nav aria-label="Đường dẫn" className={styles.breadcrumb}>
                <span>PaperLab</span>
                <span aria-hidden="true">/</span>
                <strong>{current?.label ?? 'Không tìm thấy'}</strong>
              </nav>
              <div className={styles.topActions}>
                <Button
                  className={styles.search}
                  aria-label="Tìm chức năng"
                  onClick={() =>
                    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
                  }
                >
                  <Search size={16} />
                  <span>Tìm hoặc chạy lệnh…</span>
                  <Kbd>Ctrl K</Kbd>
                </Button>
                <AccountButton />
                <IconButton
                  variant="ghost"
                  label={`Giao diện: ${THEME_LABELS[theme]}. Bấm để đổi`}
                  onClick={() => setTheme(NEXT_THEME[theme])}
                >
                  {theme === 'dark' ? (
                    <Moon size={18} />
                  ) : theme === 'light' ? (
                    <Sun size={18} />
                  ) : (
                    <Monitor size={18} />
                  )}
                </IconButton>
              </div>
            </header>
            <main
              className={`${styles.content} ${wideContent ? styles.wideContent : ''} ${appContent ? styles.appContent : ''} ${projectDetailContent ? styles.projectDetailContent : ''} ${corpusDetailContent ? styles.corpusDetailContent : ''} ${fullWidthPageContent ? styles.fullWidthPageContent : ''}`}
            >
              <StorageProvider
                key={workspaceProjectId ?? 'local-workspace'}
                projectId={workspaceProjectId}
                invalidProjectId={invalidProjectId}
                hideStatusBanner={appContent}
              >
                <StorageStatus className={styles.storageStatus} />
                <LlmProvider>
                  <Suspense fallback={<Skeleton />}>
                    <PageEnter key={location.pathname}>
                      <Routes>
                        {modules.map((item) => (
                          <Route key={item.id} path={item.path} element={<item.page />} />
                        ))}
                        <Route path="/report/:id" element={<ReportPage />} />
                        <Route path="/compare" element={<ComparePage />} />
                        <Route path="/papers/:id" element={<PaperMapPage />} />
                        <Route path="/extraction/:id" element={<ExtractionProjectPage />} />
                        <Route path="/corpus/:id" element={<CorpusDetail />} />
                        <Route
                          path="*"
                          element={
                            <div>
                              <h1>Không tìm thấy trang</h1>
                              <p>Đường dẫn này không tồn tại.</p>
                            </div>
                          }
                        />
                      </Routes>
                    </PageEnter>
                  </Suspense>
                </LlmProvider>
              </StorageProvider>
            </main>
          </div>
          <CommandPalette />
        </div>
      </AuthProvider>
    </ToastProvider>
  );
}
