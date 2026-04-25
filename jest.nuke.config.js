/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/mutations/_nuke.test.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
