import { lazy } from 'react';
import { Settings } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'settings',
  label: 'Cài đặt',
  icon: Settings,
  path: '/settings',
  group: 'system',
  order: 6,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
