/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/mutations/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/mutations/_nuke.test.ts'],
  globalSetup: '<rootDir>/__tests__/mutations/globalSetup.ts',
  testTimeout: 30000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
