export const words: Record<string, string> = {
  independent: 'Độc lập',
  dependent: 'Phụ thuộc',
  control: 'Kiểm soát',
  covariate: 'Covariate',
  maximize: 'Càng cao càng tốt',
  minimize: 'Càng thấp càng tốt',
  target: 'Giá trị mục tiêu',
  last: 'Giá trị cuối',
  max: 'Lớn nhất',
  min: 'Nhỏ nhất',
  mean: 'Trung bình',
  higher_better: 'Càng cao càng tốt',
  lower_better: 'Càng thấp càng tốt',
  target_value: 'Giá trị mục tiêu',
  descriptive: 'Mô tả',
  classification: 'Phân loại',
  regression: 'Hồi quy',
  ranking_retrieval: 'Xếp hạng và truy xuất',
  nlp_generation: 'Sinh ngôn ngữ',
  vision: 'Thị giác',
  clustering: 'Phân cụm',
  calibration_uncertainty: 'Hiệu chuẩn và bất định',
  efficiency_systems: 'Hiệu năng hệ thống',
  agreement_reliability: 'Đồng thuận và độ tin cậy',
  statistics_effect_size: 'Thống kê và cỡ hiệu ứng',
  active: 'Đang hoạt động',
  saturated: 'Bão hoà',
  superseded: 'Đã thay thế',
  deprecated: 'Ngừng sử dụng',
  maintenance: 'Bảo trì',
  unknown: 'Chưa biết',
};
export const word = (value: string | null) => (value ? (words[value] ?? value) : 'Chưa chọn');

export const claimWord = (value: string) =>
  (
    ({ descriptive: 'mô tả', comparative: 'so sánh', inferential: 'suy luận thống kê' }) as Record<
      string,
      string
    >
  )[value] ?? value;

/** RD's per-error messages, so a refused change says why. */
export const errorWords: Record<string, string> = {
  invalid_text: 'Vui lòng nhập nội dung.',
  invalid_key: 'Key không hợp lệ.',
  invalid_hash: 'Mã SHA-256 không hợp lệ.',
  in_use: 'Mục này vẫn đang được sử dụng.',
  unknown_question: 'research question không còn tồn tại.',
  unknown_hypothesis: 'hypothesis không còn tồn tại.',
  unknown_threat: 'threat to validity không còn tồn tại.',
  has_hypotheses: 'research question vẫn còn hypothesis.',
  duplicate_threat: 'threat to validity đã tồn tại.',
  no_design: 'Chưa chọn research design.',
  unknown_variable: 'variable không còn tồn tại.',
  unknown_metric: 'Metric không còn tồn tại.',
  unknown_dataset: 'Dataset không còn tồn tại.',
  unknown_condition: 'Điều kiện không còn tồn tại.',
  wrong_role: 'variable không đúng vai trò.',
  conflict: 'Dữ liệu vừa thay đổi ở nơi khác. Tải lại trang rồi thử lại.',
};
export const fallbackError = 'Không thể lưu thay đổi. Vui lòng thử lại.';
