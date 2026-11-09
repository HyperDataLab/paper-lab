import { lazy } from 'react';
import { Pilcrow } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'evaluate',
  label: 'Đoạn văn',
  icon: Pilcrow,
  path: '/evaluate',
  group: 'analysis',
  order: 0,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
