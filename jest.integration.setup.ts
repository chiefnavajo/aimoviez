/**
 * Jest Integration Test Setup
 *
 * This file runs before integration tests to configure the environment.
 */

import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Fallback to local Supabase defaults
if (!process.env.TEST_SUPABASE_URL) {
  process.env.TEST_SUPABASE_URL = 'http://localhost:54321';
}

// Use local Supabase anon key as fallback
if (!process.env.TEST_SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    'Warning: No Supabase service key found. Tests may fail.\n' +
    'Set TEST_SUPABASE_SERVICE_KEY in .env.test or ensure local Supabase is running.'
  );
}

// Increase timeout for database operations
jest.setTimeout(30000);

// Global setup
beforeAll(() => {
  console.log('Integration tests starting...');
  console.log(`Supabase URL: ${process.env.TEST_SUPABASE_URL}`);
});

afterAll(() => {
  console.log('Integration tests complete.');
});
