import type { Section } from '../schemas/paper';

export interface SectionNode {
  section: Section;
  children: SectionNode[];
}

/** Rebuilds the paper's outline from the flat, document-ordered section list and each section's level. */
export function buildSectionTree(sections: Section[]): SectionNode[] {
  const roots: SectionNode[] = [];
  const path: SectionNode[] = [];
  for (const section of sections) {
    const node: SectionNode = { section, children: [] };
    while (path.length && (path.at(-1)?.section.level ?? 0) >= section.level) path.pop();
    const parent = path.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    path.push(node);
  }
  return roots;
}

/** The section's own id and those of everything nested under it, in document order. */
export function subtreeIds(node: SectionNode): string[] {
  return [node.section.id, ...node.children.flatMap(subtreeIds)];
}
