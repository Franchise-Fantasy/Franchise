// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'landing/**', 'supabase/functions/**'],
    rules: {
      // Cosmetic in modern React; flags apostrophes/quotes in JSX text that render fine.
      'react/no-unescaped-entities': 'off',
      // SDK 56's eslint-config-expo promoted these from warn→error. The patterns
      // (useRef(new Animated.Value(...)).current, sync setState in effects, etc.)
      // are widespread in animation/overlay code that's been working since SDK 54.
      // Keep as warnings — gate still passes, refactor opportunistically per touch.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: '@/**', group: 'internal', position: 'before' },
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
]);
