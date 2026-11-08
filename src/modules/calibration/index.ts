import { lazy } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'calibration',
  label: 'Hiệu chuẩn',
  icon: SlidersHorizontal,
  path: '/calibration',
  group: 'labs',
  order: 5,
  status: 'beta',
  page: lazy(() => import('./Page')),
};
export default module;
