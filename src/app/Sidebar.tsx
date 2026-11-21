import { BookOpenText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { useAdmin } from '@/shared/auth/useAdmin';
import { IconButton } from '@/shared/ui/IconButton';
import { SidebarGroup } from './SidebarGroup';
import styles from './shell.module.css';

const groups = [
  { id: 'home', label: '' },
  { id: 'paper', label: 'Nghiên cứu' },
  { id: 'data', label: 'Dữ liệu' },
  { id: 'labs', label: 'Thử nghiệm' },
] as const;
const systemGroup = { id: 'system', label: '' } as const;

function initialCollapsed() {
  try {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

export function Sidebar({
  onNavigate,
  mobile = false,
  desktop = false,
}: {
  onNavigate?: () => void;
  mobile?: boolean;
  desktop?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const { admin } = useAdmin();
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
    <aside
      className={`${styles.sidebar} ${desktop ? styles.desktopSidebar : ''} ${rail ? styles.collapsed : ''}`}
    >
      <div className={styles.brand}>
        <BookOpenText className={styles.logo} size={22} aria-hidden="true" />
        {!rail && <span>PaperLab</span>}
        {!mobile && (
          <IconButton
            className={styles.collapse}
            tooltipSide="right"
            label={rail ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
            onClick={toggle}
          >
            {rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
        )}
      </div>
      <nav aria-label="Điều hướng chính" className={styles.navigation}>
        {groups.map((group) => (
          <SidebarGroup key={group.id} group={group} rail={rail} admin={admin} onNavigate={onNavigate} />
        ))}
      </nav>
      <SidebarGroup group={systemGroup} rail={rail} admin={admin} onNavigate={onNavigate} />
    </aside>
  );
}
