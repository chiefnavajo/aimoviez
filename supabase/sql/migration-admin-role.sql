-- ============================================================================
-- ADMIN ROLE MIGRATION
-- Adds is_admin column to users table for role-based access control
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Add is_admin column to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Create index for fast admin lookups
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = TRUE;

-- 3. IMPORTANT: Set your admin user(s)
-- Replace 'your-email@example.com' with your actual admin email(s)
-- UPDATE users SET is_admin = TRUE WHERE email = 'your-email@example.com';

-- Example: Set multiple admins
-- UPDATE users SET is_admin = TRUE WHERE email IN (
--   'admin1@example.com',
--   'admin2@example.com'
-- );

-- 4. Verify admin users
-- SELECT id, email, username, is_admin FROM users WHERE is_admin = TRUE;

-- ============================================================================
-- NOTES:
-- - After running this migration, you MUST manually set is_admin = TRUE
--   for your admin user(s) using the UPDATE statement above
-- - Only users with is_admin = TRUE can access /admin routes
-- ============================================================================
