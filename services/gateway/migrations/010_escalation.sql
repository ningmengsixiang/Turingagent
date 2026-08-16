-- 审批超时升级（FR-APP-06）：节点激活时间 + 升级计数 + 超时配置
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS last_node_activated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS escalated_count INT NOT NULL DEFAULT 0;

-- 超时配置（单行，默认 24h）
CREATE TABLE IF NOT EXISTS approval_timeout (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timeout_hours INT NOT NULL DEFAULT 24,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO approval_timeout (id, timeout_hours) VALUES (1, 24)
  ON CONFLICT (id) DO NOTHING;
