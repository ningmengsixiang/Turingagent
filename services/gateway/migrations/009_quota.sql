-- 智能体配额计量（FR-ORG-07）：agent_usage 按 agent 累计 token 用量
CREATE TABLE IF NOT EXISTS agent_usage (
  agent_id TEXT PRIMARY KEY,
  tokens BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 配额配置（单行：企业级默认预算；调额端点更新）
CREATE TABLE IF NOT EXISTS quota_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  budget BIGINT NOT NULL DEFAULT 1000000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO quota_config (id, budget) VALUES (1, 1000000)
  ON CONFLICT (id) DO NOTHING;
