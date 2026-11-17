import type { ModuleDefinition } from './moduleTypes';
import { modules } from './modules';
import { SidebarItem } from './SidebarItem';
import styles from './shell.module.css';

export function SidebarGroup({
  group,
  rail,
  admin,
  onNavigate,
}: {
  group: { id: ModuleDefinition['group']; label: string };
  rail: boolean;
  /** Shows admin-only entries; the lab server decides it (`useAdmin`). */
  admin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className={group.id === 'system' ? styles.system : styles.group}>
      {group.label && (
        <div className={styles.groupTitle}>
          {rail ? <span aria-label={group.label}>···</span> : group.label}
        </div>
      )}
      {modules
        .filter((item) => item.group === group.id && !item.partOf && (admin || !item.adminOnly))
        .map((item) => (
          <SidebarItem key={item.id} item={item} rail={rail} onNavigate={onNavigate} />
        ))}
    </div>
  );
}
