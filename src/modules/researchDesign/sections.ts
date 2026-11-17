import { lazy } from 'react';

export const researchDesignSections = [
  {
    id: 'topic',
    label: 'Đề tài và khoảng trống',
    description: 'Kiểm tra đề tài, bài gần nhất và khoảng trống trước khi đặt câu hỏi.',
    component: lazy(() => import('./sections/TopicSection')),
  },
  {
    id: 'questions',
    label: 'Câu hỏi và giả thuyết',
    description: 'Xác định câu hỏi và giả thuyết nghiên cứu.',
    component: lazy(() => import('./sections/QuestionsSection')),
  },
  {
    id: 'design',
    label: 'Thiết kế nghiên cứu',
    description: 'Xây dựng thiết kế và xem xét các nguy cơ.',
    component: lazy(() => import('./sections/DesignSection')),
  },
  {
    id: 'measurement',
    label: 'Đo lường',
    description: 'Xác định biến, thước đo và dữ liệu.',
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
    label: 'Phân tích thống kê',
    description: 'Lập kế hoạch phân tích thống kê.',
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
