import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import moduleBoundaries from './scripts/eslint-module-boundaries.mjs';
// Integration tests render other modules' pages directly; exporting them would defeat lazy loading.
const moduleBoundaryAllowlist = [
  'generate/generate-ui.test.tsx -> evaluate/Page',
  'generate/generate-ui.test.tsx -> history/Page',
  'history/storage-ui.test.tsx -> evaluate/Page',
  'history/storage-ui.test.tsx -> transfer/Page',
  'paper-import/paper-ui.test.tsx -> evaluate/Page',
  'revise/revise-ui.test.tsx -> evaluate/Page',
  'revise/revise-ui.test.tsx -> history/Page',
];
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    plugins: { boundaries: { rules: { 'public-entry': moduleBoundaries } } },
    rules: { 'boundaries/public-entry': ['error', { allow: moduleBoundaryAllowlist }] },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name=/^(button|select|textarea)$/], JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value='file']))",
          message: 'Dùng component trong src/shared/ui',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            'dexie',
            'dexie/*',
            'zustand',
            'zustand/*',
            '@/shared',
            '@/shared/*',
            '@/modules',
            '@/modules/*',
            '@/app',
            '@/app/*',
            '**/shared/**',
            '**/modules/**',
            '**/app/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@/modules', '@/modules/*', '@/app', '@/app/*', '**/modules/**', '**/app/**'] },
      ],
    },
  },
);
