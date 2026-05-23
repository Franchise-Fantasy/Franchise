/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/mutations/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // The root tsconfig sets `jsx: react-native` (preserve) for Metro, which makes
  // ts-jest emit raw JSX that Node can't parse if a .tsx file leaks into a test's
  // import graph. Override to `react-jsx` so any transitively-imported .tsx
  // compiles. (Tests should still import pure logic, not React component trees.)
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
};
