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
    },
  },
]);
