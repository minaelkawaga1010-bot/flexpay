// Flat ESLint config for the Express backend (src/).
//
// Enabled behind ESLINT_USE_FLAT_CONFIG=true (see the `lint` script)
// because the project is pinned to ESLint 8.57, where eslintrc is still
// the default lookup. @typescript-eslint v6 predates the unified
// `typescript-eslint` meta package, so parser + plugin are wired
// manually here.
//
// Rule policy:
//   • error  — high-signal correctness/security rules the codebase
//              already satisfies, so the gate stays EXIT 0 while still
//              blocking regressions (floating promises, explicit any,
//              debugger, var).
//   • warn   — the broader recommended set. Surfaced for burn-down
//              without failing CI on day one (the backend had no lint
//              config at all before this, so a hard-fail on the full
//              recommended set would be unactionable).
//
// Floating promises are caught WITHOUT type-aware linting via
// eslint-plugin-promise (no `parserOptions.project` needed), keeping the
// lint pass fast.

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import promise from 'eslint-plugin-promise';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'prisma/**',
      'mobile/**',
      'dashboard/**',
      'docs/**',
      '**/*.js',
      '**/*.mjs',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      promise,
    },
    rules: {
      // ── recommended baselines, surfaced as warnings ────────────────
      ...tsPlugin.configs.recommended.rules,
      ...promise.configs.recommended.rules,

      // Downgrade the noisy recommended rules to warn so the first-ever
      // lint run is actionable rather than a wall of red.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'promise/always-return': 'warn',
      'promise/no-callback-in-promise': 'warn',

      // Intentional idioms / pure style — surfaced as warnings, not gate
      // failures:
      //   • no-var-requires: firebase.ts + twilio.service.ts lazy-load
      //     optional deps via require() by design.
      //   • ban-types: the `(string & {})` union idiom in
      //     wps-payment-method.ts preserves literal autocomplete.
      //   • promise/param-names: parameter naming only.
      '@typescript-eslint/no-var-requires': 'warn',
      '@typescript-eslint/ban-types': 'warn',
      'promise/param-names': 'warn',

      // ── hard errors — verified green against the current tree ───────
      '@typescript-eslint/no-explicit-any': 'error',
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      // Floating promises without type info: catch-or-return covers
      // un-awaited .then() chains that drop errors.
      'promise/catch-or-return': ['error', { allowFinally: true }],
    },
  },
];
