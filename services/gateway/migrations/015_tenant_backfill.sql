-- 存量会话租户回填：NULL 租户会话回填 default 租户（sessions 无 created_by 列）
UPDATE sessions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
