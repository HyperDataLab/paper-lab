import { TOOL_GROUPS, toolGroup } from './groups';
it('PG-01 groups known tools and leaves unknown tools in Khác', () => {
  expect(TOOL_GROUPS.flatMap((group) => group.tools)).toHaveLength(9);
  expect(toolGroup('get_paper')).toBe('search');
  expect(toolGroup('map_topic_debate')).toBe('topic');
  expect(toolGroup('verify_reference')).toBe('references');
  expect(toolGroup('new_tool')).toBe('other');
});
