-- ============================================================================
-- AUDIT LOG TABLE
-- Tracks admin actions for security and compliance
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who performed the action
  admin_id UUID REFERENCES users(id),
  admin_email TEXT NOT NULL,

  -- What action was performed
  action TEXT NOT NULL,  -- 'approve_clip', 'reject_clip', 'toggle_feature', 'reset_season', etc.
  resource_type TEXT NOT NULL,  -- 'clip', 'user', 'season', 'feature_flag', etc.
  resource_id TEXT,  -- ID of the affected resource

  -- Details
  details JSONB DEFAULT '{}',  -- Additional context (old_value, new_value, reason, etc.)

  -- Request metadata
  ip_address TEXT,
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "Admins can read audit logs" ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- Service role can insert (from API)
-- No direct insert policy for users - only via API with service role

COMMENT ON TABLE audit_logs IS 'Tracks all admin actions for security audit trail';
