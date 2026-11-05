import { lazy } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'transfer',
  label: 'Xuất/Nhập',
  icon: ArrowLeftRight,
  path: '/transfer',
  group: 'data',
  order: 4,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
