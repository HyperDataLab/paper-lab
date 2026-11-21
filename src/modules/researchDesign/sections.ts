import { lazy } from 'react';

export const researchDesignSections = [
  {
    id: 'topic',
    label: 'Topic và research gaps',
    description: 'Kiểm tra đề tài, bài gần nhất và research gap trước khi đặt research question.',
    component: lazy(() => import('./sections/TopicSection')),
  },
  {
    id: 'questions',
    label: 'Research questions và hypotheses',
    description: 'Xác định research questions và hypotheses.',
    component: lazy(() => import('./sections/QuestionsSection')),
  },
  {
    id: 'design',
    label: 'Research design',
    description: 'Xây dựng research design và xem xét threats to validity.',
    component: lazy(() => import('./sections/DesignSection')),
  },
  {
    id: 'measurement',
    label: 'Measurement',
    description: 'Xác định variables, metrics và datasets.',
    component: lazy(() => import('./sections/MeasurementSection')),
  },
  {
    id: 'bank',
    label: 'Writing Bank',
    description: 'Quản lý nguồn Writing Bank.',
    component: lazy(() => import('./sections/BankSection')),
  },
  {
    id: 'analyses',
    label: 'Statistical analysis',
    description: 'Lập kế hoạch statistical analysis.',
    component: lazy(() => import('./sections/AnalysesSection')),
  },
  {
    id: 'runs',
    label: 'Ma trận chạy',
    description: 'Lập ma trận các lượt chạy.',
    component: lazy(() => import('./sections/RunsSection')),
  },
  {
    id: 'evidence',
    label: 'Bảng so sánh',
    description: 'So sánh dữ kiện giữa các bài báo.',
    component: lazy(() => import('./sections/EvidenceSection')),
  },
  {
    id: 'package',
    label: 'Gói kế hoạch',
    description: 'Chuẩn bị gói kế hoạch nghiên cứu.',
    component: lazy(() => import('./sections/PackageSection')),
  },
] as const;
