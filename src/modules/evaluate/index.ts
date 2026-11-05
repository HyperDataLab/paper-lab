import { lazy } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'evaluate',
  label: 'Đánh giá',
  icon: ClipboardCheck,
  path: '/evaluate',
  group: 'analysis',
  order: 0,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
