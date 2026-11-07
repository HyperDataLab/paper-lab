import type { Issue } from '../schemas';

export function mergeHumanDecisions(incoming: Issue[], current: Issue[]): Issue[] {
  return incoming.map((item) => {
    const previous = current.find((value) => value.id === item.id);
    return previous && (previous.status === 'confirmed_by_human' || previous.status === 'dismissed_by_human')
      ? { ...item, status: previous.status, severity: previous.severity }
      : item;
  });
}
