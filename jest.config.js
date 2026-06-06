/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/mutations/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Edge (Deno) modules import siblings with an explicit `.ts` extension, which
    // Node/ts-jest resolution doesn't expect. Strip it on relative specifiers so
    // pure edge logic (e.g. poll-news/rotowire-html.ts) is unit-testable. Does
    // not match `.tsx`.
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  // The root tsconfig sets `jsx: react-native` (preserve) for Metro, which makes
  // ts-jest emit raw JSX that Node can't parse if a .tsx file leaks into a test's
  // import graph. Override to `react-jsx` so any transitively-imported .tsx
  // compiles. (Tests should still import pure logic, not React component trees.)
  // Ignore TS5097 only: edge (Deno) modules import siblings with an explicit
  // `.ts` extension, which the app tsconfig disallows. Suppressing just that one
  // diagnostic lets pure edge logic (poll-news/rotowire-html.ts) be unit-tested
  // while every other type error in tests is still reported.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' }, diagnostics: { ignoreCodes: [5097] } }],
  },
};
