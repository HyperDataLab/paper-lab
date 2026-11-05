import { PanelLeftClose, PanelLeftOpen, Pilcrow } from 'lucide-react';
import { useState } from 'react';
import { SidebarGroup } from './SidebarGroup';
import styles from './shell.module.css';

const groups = [
  { id: 'analysis', label: 'PHÂN TÍCH' },
  { id: 'data', label: 'DỮ LIỆU' },
  { id: 'labs', label: 'SẮP CÓ' },
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
        <Pilcrow className={styles.logo} size={26} aria-hidden="true" />
        {!rail && <span>Paragraph Lab</span>}
      </div>
      <nav aria-label="Điều hướng chính" className={styles.navigation}>
        {groups.map((group) => (
          <SidebarGroup key={group.id} group={group} rail={rail} onNavigate={onNavigate} />
        ))}
      </nav>
      {!mobile && (
        <button
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
        </button>
      )}
    </aside>
  );
}
