import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Architectural boundary enforcement (spec §12, §25).
 *
 * The dependency direction is strictly one-way:
 *   music-model → midi / quantization → practice-engine → playback-engine
 *   → device-adapters → stores/services → components/pages
 *
 * The practice engine and music model must never reach "upward" into UI,
 * transport, MIDI, or device code. These rules make a violation fail `npm run lint`.
 */
const boundary = (name, forbidden) => ({
  files: [`src/${name}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidden.flatMap((f) => [
          { group: [`@/${f}`, `@/${f}/*`], message: `${name} must not import from ${f} (architectural boundary).` },
          { group: [`**/${f}/*`], message: `${name} must not import from ${f} (architectural boundary).` },
        ]),
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },
  boundary('music-model', ['midi', 'quantization', 'practice-engine', 'playback-engine', 'device-adapters', 'stores', 'services', 'components', 'pages', 'recognition']),
  boundary('practice-engine', ['midi', 'playback-engine', 'device-adapters', 'stores', 'services', 'components', 'pages', 'recognition']),
  boundary('quantization', ['midi', 'practice-engine', 'playback-engine', 'device-adapters', 'stores', 'services', 'components', 'pages', 'recognition']),
  boundary('midi', ['practice-engine', 'playback-engine', 'device-adapters', 'stores', 'services', 'components', 'pages', 'recognition']),
  boundary('playback-engine', ['device-adapters', 'stores', 'services', 'components', 'pages', 'recognition']),
  boundary('device-adapters', ['stores', 'services', 'components', 'pages']),
  {
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
