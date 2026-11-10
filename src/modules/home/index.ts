import { lazy } from 'react';
import { House } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'home',
  label: 'Trang chủ',
  icon: House,
  path: '/',
  group: 'home',
  order: 0,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
