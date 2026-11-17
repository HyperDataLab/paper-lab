import { EXAMPLES } from './examples';
import { TOOL_GROUPS } from './groups';
it('PG-02 supplies an example for each known tool', () => {
  expect(Object.keys(EXAMPLES).sort()).toEqual(TOOL_GROUPS.flatMap((group) => [...group.tools]).sort());
  expect(EXAMPLES.check_retractions?.dois).toHaveLength(3);
});
