-- 项目模板持久化（计划 30）：sessions 记录创建时套用的模板 id
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS template_id TEXT;
