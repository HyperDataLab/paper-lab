export const RUBRIC_VERSION = 'schimel-paragraph-v1';
export const NOT_ASSESSABLE_LIMIT = 2;
export const DIMENSIONS = [
  {
    id: 'sentence_structure',
    label: 'Cấu trúc câu',
    weight: 0.25,
    chapter: 12,
    descriptors: [
      'Cấu trúc câu đứt gãy nghiêm trọng',
      'Nhiều cấu trúc câu khó theo dõi',
      'Cấu trúc câu có điểm rõ và điểm khó theo dõi',
      'Cấu trúc câu nhìn chung rõ ràng',
      'Cấu trúc câu rõ ràng và hiệu quả',
    ],
  },
  {
    id: 'verb_word_choice',
    label: 'Động từ và lựa chọn từ',
    weight: 0.2,
    chapter: 14,
    descriptors: [
      'Động từ và từ ngữ không truyền đạt hành động',
      'Nhiều động từ và từ ngữ thiếu rõ ràng',
      'Lựa chọn từ có điểm mạnh và điểm yếu',
      'Động từ và từ ngữ nhìn chung rõ',
      'Động từ và từ ngữ chính xác, hiệu quả',
    ],
  },
  {
    id: 'concision_modifiers',
    label: 'Tính súc tích và từ bổ nghĩa',
    weight: 0.15,
    chapter: 16,
    descriptors: [
      'Lối diễn đạt rườm rà cản trở ý nghĩa',
      'Nhiều từ bổ nghĩa hoặc cụm từ gây rườm rà',
      'Có chỗ súc tích và chỗ rườm rà',
      'Nhìn chung súc tích và dùng từ bổ nghĩa phù hợp',
      'Súc tích và dùng từ bổ nghĩa hiệu quả',
    ],
  },
  {
    id: 'paragraph_organization',
    label: 'Tổ chức đoạn',
    weight: 0.2,
    chapter: 11,
    descriptors: [
      'Đoạn thiếu tổ chức hoặc ý chính',
      'Tổ chức đoạn có nhiều vấn đề',
      'Tổ chức đoạn rõ ở một số chỗ',
      'Tổ chức đoạn nhìn chung rõ',
      'Ý chính và các câu được tổ chức hiệu quả',
    ],
  },
  {
    id: 'flow_coherence',
    label: 'Mạch và liên kết',
    weight: 0.2,
    chapter: 13,
    descriptors: [
      'Mạch giữa các câu đứt gãy nghiêm trọng',
      'Nhiều chuyển tiếp khó theo dõi',
      'Mạch liên kết có chỗ rõ và chỗ gián đoạn',
      'Mạch giữa các câu nhìn chung rõ',
      'Các câu liên kết mạch lạc và hiệu quả',
    ],
  },
] as const;
export type DimensionId = (typeof DIMENSIONS)[number]['id'];
