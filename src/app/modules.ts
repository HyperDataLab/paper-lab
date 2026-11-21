import home from '@/modules/home';
import transfer from '@/modules/transfer';
import adminRequests from '@/modules/admin';
import settings from '@/modules/settings';
import paperImport from '@/modules/paper-import';
import extraction from '@/modules/extraction';
import corpus from '@/modules/corpus';
import labKg from '@/modules/lab-kg';
import playground from '@/modules/playground';

export const modules = [
  home,
  paperImport,
  extraction,
  corpus,
  labKg,
  transfer,
  playground,
  adminRequests,
  settings,
];
