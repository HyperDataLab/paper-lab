export const TOOL_GROUPS = [
  { id: 'search', label: 'Tìm và tra cứu', tools: ['search_papers', 'get_paper', 'recommend_similar'] },
  {
    id: 'topic',
    label: 'Kiểm tra đề tài',
    tools: ['run_duplication_test', 'check_gap_saturation', 'map_topic_debate'],
  },
  {
    id: 'references',
    label: 'Tài liệu và tạp chí',
    tools: ['verify_reference', 'check_retractions', 'get_journal_profile'],
  },
  { id: 'other', label: 'Khác', tools: [] },
] as const;

export function toolGroup(name: string): string {
  return TOOL_GROUPS.find((group) => (group.tools as readonly string[]).includes(name))?.id ?? 'other';
}
