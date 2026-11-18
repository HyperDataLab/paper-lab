import { expect, it } from 'vitest';
import { SECTION_ROLE_LABELS } from './sectionRoles';

it('labels paper section roles with the English glossary', () => {
  expect(SECTION_ROLE_LABELS).toEqual({
    title: 'Title',
    abstract: 'Abstract',
    introduction: 'Introduction',
    related_work: 'Related work',
    methods: 'Methods',
    results: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    references: 'References',
    appendix: 'Appendix',
    other: 'Khác',
  });
});
