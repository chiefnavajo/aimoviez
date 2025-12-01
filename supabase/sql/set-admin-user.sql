-- Set Admin User
-- Run this in Supabase SQL Editor after signing in with Google

-- Step 1: First, check if your user exists in the users table
-- Replace 'your-email@gmail.com' with your actual Google email
SELECT id, email, username, is_admin, created_at
FROM users
WHERE email ILIKE '%@%'
ORDER BY created_at DESC
LIMIT 10;

-- Step 2: If your user exists, set them as admin
-- Replace 'your-email@gmail.com' with your actual Google email
UPDATE users
SET is_admin = TRUE
WHERE email = 'your-email@gmail.com';

-- Step 3: If your user does NOT exist, you need to create them first
-- This happens if the app didn't auto-create a user record on sign-in
-- Replace values with your actual info:
/*
INSERT INTO users (email, username, is_admin, created_at)
VALUES (
  'your-email@gmail.com',
  'YourUsername',
  TRUE,
  NOW()
)
ON CONFLICT (email) DO UPDATE SET is_admin = TRUE;
*/

-- Step 4: Verify the admin was set
SELECT id, email, username, is_admin FROM users WHERE is_admin = TRUE;
