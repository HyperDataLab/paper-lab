import { Menu, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
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
import { LabDataGate } from './LabDataGate';
import { CommandPalette } from './CommandPalette';
import { modules } from './modules';
import { Sidebar } from './Sidebar';
import { PageEnter } from '@/shared/motion/PageEnter';
import ReportPage from '@/modules/report/ReportPage';
import ComparePage from '@/modules/report/ComparePage';
import PaperMapPage from '@/modules/paper-import/PaperMapPage';
import ExtractionProjectPage from '@/modules/extraction/ProjectPage';
import CorpusDetail from '@/modules/corpus/DetailPage';
import styles from './shell.module.css';
type Theme = 'light' | 'dark' | 'system';
const THEME_LABELS: Record<Theme, string> = { system: 'Hệ thống', light: 'Sáng', dark: 'Tối' };
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
function readTheme(): Theme {
  try {
    const value = localStorage.getItem('theme');
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Storage may be unavailable. */
  }
  return 'system';
}
export function App() {
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const location = useLocation();
  const current = modules.find(
    (item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
  );
  // Workspaces and wide tables use the whole window; lists, forms and home stay at a readable width.
  const wideContent =
    location.pathname === '/evaluate' ||
    location.pathname.startsWith('/extraction/') ||
    location.pathname.startsWith('/corpus/') ||
    location.pathname.startsWith('/papers/');
  // A paper is a workspace: on wide screens it fills the window and its columns scroll on their own.
  const appContent = /^\/papers\/[^/]+/.test(location.pathname);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [theme]);
  return (
    <ToastProvider>
      <AuthProvider>
        <div className={styles.shell}>
          <div className={styles.desktopSidebar}>
            <Sidebar />
          </div>
          <Drawer open={drawer} onClose={closeDrawer}>
            <Sidebar mobile onNavigate={closeDrawer} />
          </Drawer>
          <div className={styles.main}>
            <header className={styles.topbar}>
              <div className={styles.mobileMenu}>
                <IconButton label="Mở menu" onClick={() => setDrawer(true)}>
                  <Menu size={20} />
                </IconButton>
              </div>
              <nav aria-label="Đường dẫn" className={styles.breadcrumb}>
                <span>PaperLab</span>
                <span aria-hidden="true">/</span>
                <strong>
                  {current?.label ??
                    (location.pathname.startsWith('/report/')
                      ? 'Báo cáo'
                      : location.pathname === '/compare'
                        ? 'So sánh'
                        : 'Không tìm thấy')}
                </strong>
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
              className={`${styles.content} ${wideContent ? styles.wideContent : ''} ${appContent ? styles.appContent : ''}`}
            >
              <StorageProvider>
                <StorageStatus className={styles.storageStatus} />
                <LlmProvider>
                  <Suspense fallback={<Skeleton />}>
                    <PageEnter key={location.pathname}>
                      <Routes>
                        {modules.map((item) => (
                          <Route
                            key={item.id}
                            path={item.path}
                            element={
                              item.id === 'settings' || item.id === 'playground' ? (
                                <item.page />
                              ) : (
                                <LabDataGate>
                                  <item.page />
                                </LabDataGate>
                              )
                            }
                          />
                        ))}
                        <Route
                          path="/report/:id"
                          element={
                            <LabDataGate>
                              <ReportPage />
                            </LabDataGate>
                          }
                        />
                        <Route
                          path="/compare"
                          element={
                            <LabDataGate>
                              <ComparePage />
                            </LabDataGate>
                          }
                        />
                        <Route
                          path="/papers/:id"
                          element={
                            <LabDataGate>
                              <PaperMapPage />
                            </LabDataGate>
                          }
                        />
                        <Route
                          path="/extraction/:id"
                          element={
                            <LabDataGate>
                              <ExtractionProjectPage />
                            </LabDataGate>
                          }
                        />
                        <Route
                          path="/corpus/:id"
                          element={
                            <LabDataGate>
                              <CorpusDetail />
                            </LabDataGate>
                          }
                        />
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
