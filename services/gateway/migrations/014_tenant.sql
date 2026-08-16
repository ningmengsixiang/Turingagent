-- 多租户隔离（FR-ORG-01/FR-SEC-02）：租户生命周期 + 数据归属
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 种子租户：default（首个用户自动加入）
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'default')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id) ON DELETE SET NULL;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions (tenant_id);
