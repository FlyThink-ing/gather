-- 自动化测试账号与业务夹具仅在显式执行 npm run local:fixtures 时创建。
-- 默认本地启动与数据库重置不创建测试数据。
-- 这里保持无敏感信息，确保 supabase db reset 可以稳定执行。
select 1;
