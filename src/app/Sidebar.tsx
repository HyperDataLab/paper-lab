import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
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
      className={`${styles.sidebar} ${desktop ? styles.desktopSidebar : ''} ${mobile ? styles.mobileSidebar : ''} ${rail ? styles.collapsed : ''}`}
    >
      <div className={styles.brand}>
        <img className={styles.logo} src="/paperlab-logo.png" alt="PaperLab" />
        {!rail && (
          <span className={styles.brandName} aria-hidden="true">
            PaperLab
          </span>
        )}
        {mobile ? (
          <IconButton className={styles.collapse} tooltipSide="right" label="Đóng menu" onClick={onNavigate}>
            <X size={18} aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton
            className={styles.collapse}
            tooltipSide="right"
            label={rail ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
            aria-expanded={!rail}
            onClick={toggle}
          >
            {rail ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
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
