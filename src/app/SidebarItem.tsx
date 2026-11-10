import { NavLink, useLocation } from 'react-router-dom';
import { Badge } from '@/shared/ui/Badge';
import { Tooltip } from '@/shared/ui/Tooltip';
import type { ModuleDefinition } from './moduleTypes';
import { modules } from './modules';
import styles from './shell.module.css';

export function SidebarItem({
  item,
  rail,
  onNavigate,
}: {
  item: ModuleDefinition;
  rail: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const childActive = modules.some((other) => other.partOf === item.id && pathname.startsWith(other.path));
  const content = (
    <>
      <Icon size={19} aria-hidden="true" />
      {!rail && (
        <>
          <span className={styles.itemLabel}>{item.label}</span>
          {item.status === 'soon' && <Badge>Sắp có</Badge>}
          {item.status === 'beta' && <Badge>Beta</Badge>}
        </>
      )}
    </>
  );
  const element =
    item.status === 'soon' ? (
      <span className={`${styles.navItem} ${styles.disabled}`} aria-disabled="true" aria-label={item.label}>
        {content}
      </span>
    ) : (
      <NavLink
        to={item.path}
        end={item.path === '/'}
        onClick={onNavigate}
        className={({ isActive }) => `${styles.navItem} ${isActive || childActive ? styles.active : ''}`}
        aria-label={rail ? item.label : undefined}
      >
        {content}
      </NavLink>
    );
  return <div>{rail ? <Tooltip label={item.label}>{element}</Tooltip> : element}</div>;
}
