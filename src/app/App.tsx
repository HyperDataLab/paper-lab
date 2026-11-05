import { Menu, Search } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Drawer } from '@/shared/ui/Drawer';
import { IconButton } from '@/shared/ui/IconButton';
import { Kbd } from '@/shared/ui/Kbd';
import { Skeleton } from '@/shared/ui/Skeleton';
import { CommandPalette } from './CommandPalette';
import { modules } from './modules';
import { Sidebar } from './Sidebar';
import styles from './shell.module.css';
type Theme = 'light' | 'dark' | 'system';
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
            <IconButton aria-label="Mở menu" onClick={() => setDrawer(true)}>
              <Menu size={20} />
            </IconButton>
          </div>
          <nav aria-label="Đường dẫn" className={styles.breadcrumb}>
            <span>Paragraph Lab</span>
            <span aria-hidden="true">/</span>
            <strong>{current?.label ?? 'Không tìm thấy'}</strong>
          </nav>
          <div className={styles.topActions}>
            <button
              className={styles.search}
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            >
              <Search size={17} />
              <span>Tìm chức năng</span>
              <Kbd>Ctrl K</Kbd>
            </button>
            <label className={styles.themeLabel}>
              Giao diện{' '}
              <select
                aria-label="Giao diện"
                value={theme}
                onChange={(event) => setTheme(event.target.value as Theme)}
              >
                <option value="system">Hệ thống</option>
                <option value="light">Sáng</option>
                <option value="dark">Tối</option>
              </select>
            </label>
          </div>
        </header>
        <main className={styles.content}>
          <Suspense fallback={<Skeleton />}>
            <Routes>
              <Route path="/" element={<Navigate to="/evaluate" replace />} />
              {modules.map((item) => (
                <Route key={item.id} path={item.path} element={<item.page />} />
              ))}
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
          </Suspense>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
