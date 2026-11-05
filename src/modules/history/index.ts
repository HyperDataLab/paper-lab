import { lazy } from 'react';
import { History } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'history',
  label: 'Lịch sử',
  icon: History,
  path: '/history',
  group: 'data',
  order: 3,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
