-- ABAC 行级权限（FR-PERM-02）：部门属性 + 会话可见性
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments (id) ON DELETE SET NULL;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_department ON users (department_id);
CREATE INDEX IF NOT EXISTS idx_sessions_department ON sessions (department_id);
