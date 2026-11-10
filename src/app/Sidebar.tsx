import { BookOpenText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { SidebarGroup } from './SidebarGroup';
import styles from './shell.module.css';

const groups = [
  { id: 'home', label: '' },
  { id: 'paper', label: 'BÀI BÁO' },
  { id: 'analysis', label: 'VIẾT' },
  { id: 'data', label: 'DỮ LIỆU' },
  { id: 'system', label: '' },
] as const;

function initialCollapsed() {
  try {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

export function Sidebar({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const rail = collapsed && !mobile;
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('sidebar-collapsed', String(next));
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return (
    <aside className={`${styles.sidebar} ${rail ? styles.collapsed : ''}`}>
      <div className={styles.brand}>
        <BookOpenText className={styles.logo} size={26} aria-hidden="true" />
        {!rail && <span>PaperLab</span>}
      </div>
      <nav aria-label="Điều hướng chính" className={styles.navigation}>
        {groups.map((group) => (
          <SidebarGroup key={group.id} group={group} rail={rail} onNavigate={onNavigate} />
        ))}
      </nav>
      {!mobile && (
        <Button
          variant="ghost"
          className={styles.collapse}
          onClick={toggle}
          aria-label={rail ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {rail ? (
            <PanelLeftOpen size={19} />
          ) : (
            <>
              <PanelLeftClose size={19} />
              <span>Thu gọn</span>
            </>
          )}
        </Button>
      )}
    </aside>
  );
}
