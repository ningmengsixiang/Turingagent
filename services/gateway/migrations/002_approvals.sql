CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approver_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals (session_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS ref_kind TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ref_id TEXT;
