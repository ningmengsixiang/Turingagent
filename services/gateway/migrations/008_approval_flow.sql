-- 多级审批引擎（FR-APP-02）：approvals 加流程字段 + approval_nodes 表
ALTER TABLE approvals
  DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE approvals
  ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'cancelled'));

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'single'
  CHECK (mode IN ('single', 'all', 'any'));
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS current_node_index INT NOT NULL DEFAULT 0;
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS approval_nodes (
  approval_id UUID NOT NULL REFERENCES approvals (id) ON DELETE CASCADE,
  node_index INT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'all', 'any')),
  approver_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  votes JSONB NOT NULL DEFAULT '{}',
  decided_by TEXT,
  reason TEXT,
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (approval_id, node_index)
);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_approval ON approval_nodes (approval_id);
