import { modules } from './modules';
it('has no corrupted module labels', () => {
  for (const item of modules) expect(item.label).not.toContain('?');
});
it('has unique ids and paths and is sorted by valid group and order', () => {
  const groups = ['analysis', 'paper', 'data', 'labs', 'system'];
  expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
  expect(new Set(modules.map((m) => m.path)).size).toBe(modules.length);
  for (let i = 0; i < modules.length; i++) {
    const item = modules[i];
    expect(item).toBeDefined();
    if (!item) continue;
    expect(groups).toContain(item.group);
    const previous = modules[i - 1];
    if (previous) {
      expect(groups.indexOf(item.group)).toBeGreaterThanOrEqual(groups.indexOf(previous.group));
      if (previous.group === item.group) expect(item.order).toBeGreaterThan(previous.order);
    }
  }
});
