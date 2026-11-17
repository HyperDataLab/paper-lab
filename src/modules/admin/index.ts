import { lazy } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'admin-requests',
  label: 'Duyệt yêu cầu',
  icon: ShieldCheck,
  path: '/admin/requests',
  group: 'system',
  order: 5,
  status: 'ready',
  adminOnly: true,
  page: lazy(() => import('./RequestsPage')),
};
export default module;
