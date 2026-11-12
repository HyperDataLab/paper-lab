import { z } from 'zod';

// Paraphrased from Writing Bank claim-types.
export const CLAIM_TYPES = [
  'descriptive',
  'comparative',
  'correlational',
  'causal',
  'mechanistic',
  'predictive',
  'methodological',
  'generalisation',
  'novelty',
  'null',
  'theoretical',
  'recommendation',
] as const;
export const ClaimTypeSchema = z.enum(CLAIM_TYPES);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export const CLAIM_TYPE_INFO: Record<ClaimType, { label: string; vi: string; needs: string }> = {
  descriptive: { label: 'Descriptive', vi: 'Mô tả', needs: 'Cần đo lường đặc tính trong mẫu được khảo sát.' },
  comparative: {
    label: 'Comparative',
    vi: 'So sánh',
    needs: 'Cần đo cả hai trong cùng điều kiện và báo cáo biến thiên.',
  },
  correlational: {
    label: 'Correlational',
    vi: 'Tương quan',
    needs: 'Cần dữ liệu về hướng và độ lớn của mối liên hệ.',
  },
  causal: {
    label: 'Causal',
    vi: 'Nhân quả',
    needs: 'Cần phân nhóm ngẫu nhiên, can thiệp có kiểm soát hoặc thiết kế nhận diện.',
  },
  mechanistic: {
    label: 'Mechanistic',
    vi: 'Cơ chế',
    needs: 'Cần bằng chứng về con đường tác động, như thí nghiệm loại bỏ thành phần.',
  },
  predictive: {
    label: 'Predictive',
    vi: 'Dự đoán',
    needs: 'Cần hiệu năng dự đoán được báo cáo trên dữ liệu chưa thấy.',
  },
  methodological: {
    label: 'Methodological',
    vi: 'Phương pháp',
    needs: 'Cần số liệu xác thực hoặc độ tin cậy cho mục đích sử dụng.',
  },
  generalisation: {
    label: 'Generalisation',
    vi: 'Khái quát hóa',
    needs: 'Cần mẫu bao phủ phạm vi muốn khái quát.',
  },
  novelty: {
    label: 'Novelty',
    vi: 'Tính mới',
    needs: 'Cần tìm kiếm tài liệu để xác định điều chưa được làm hoặc chỉ ra.',
  },
  null: { label: 'Null', vi: 'Không có hiệu ứng', needs: 'Cần đủ lực thống kê hoặc kiểm định tương đương.' },
  theoretical: { label: 'Theoretical', vi: 'Lý thuyết', needs: 'Cần chứng minh bằng suy luận diễn dịch.' },
  recommendation: {
    label: 'Recommendation',
    vi: 'Khuyến nghị',
    needs: 'Cần một claim thực nghiệm và lập luận về hệ quả.',
  },
};
