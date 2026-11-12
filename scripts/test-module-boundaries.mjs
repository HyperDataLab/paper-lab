import { RuleTester } from 'eslint';
import rule from './eslint-module-boundaries.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const filename = `${process.cwd()}/src/modules/alpha/nested/file.js`;
tester.run('public-entry', rule, {
  valid: [
    { filename, code: "import x from '@/modules/beta';" },
    { filename, code: "export * from '../../beta/index';" },
    { filename, code: "import x from '@/modules/alpha/internal';" },
    {
      filename,
      code: "import x from '../../beta/internal';",
      options: [{ allow: ['alpha/nested/file.js -> beta/internal'] }],
    },
  ],
  invalid: [
    { filename, code: "import x from '@/modules/beta/internal';", errors: [{ messageId: 'internal' }] },
    { filename, code: "export * from '../../beta/internal';", errors: [{ messageId: 'internal' }] },
    { filename, code: "import('../../beta/internal');", errors: [{ messageId: 'internal' }] },
    { filename, code: "require('../../beta/internal');", errors: [{ messageId: 'internal' }] },
  ],
});
