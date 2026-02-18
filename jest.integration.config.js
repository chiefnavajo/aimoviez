/**
 * Jest Configuration for Integration Tests
 *
 * These tests run against a real Supabase database (local via `supabase start`).
 * They verify that admin operations work correctly end-to-end.
 *
 * Usage:
 *   1. Start local Supabase: `supabase start`
 *   2. Run tests: `npm run test:integration`
 */

/** @type {import('jest').Config} */
const config = {
  displayName: 'integration',

  // Use Node environment (not jsdom) for API tests
  testEnvironment: 'node',

  // Only run integration tests (exclude load/stress tests by default)
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'load-test',
    'user-behavior-simulation',
  ],

  // TypeScript support
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Longer timeout for database operations
  testTimeout: 30000,

  // Run tests sequentially to avoid database conflicts
  maxWorkers: 1,

  // Setup file for environment variables
  setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.ts'],

  // Coverage settings
  collectCoverageFrom: [
    'src/app/api/admin/**/*.ts',
    '!src/app/api/admin/**/route.ts', // Exclude route files (tested via integration)
  ],

  // Verbose output
  verbose: true,
};

module.exports = config;
