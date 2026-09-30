import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const apiUrl = process.env.LOCAL_SUPABASE_URL;
const serviceRoleKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const password = process.env.LOCAL_TEST_PASSWORD;

if (!apiUrl || !serviceRoleKey || !anonKey || !password) {
  throw new Error('本地 Supabase 引导参数不完整。');
}

const client = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const accounts = [
  { key: 'ADMIN', email: 'uat-admin@local.test', name: '本地管理员', position: '系统管理员', role: 'admin' },
  { key: 'MANAGER', email: 'uat-manager@local.test', name: '本地组长', position: '组长', role: 'manager' },
  { key: 'USER', email: 'uat-user@local.test', name: '本地成员', position: '前端工程师', role: 'user' },
  { key: 'TEAM_LEAD', email: 'uat-team-lead@local.test', name: '本地研发组长', position: '组长', role: 'manager' },
  { key: 'OTHER_TEAM_LEAD', email: 'uat-other-team-lead@local.test', name: '本地异组组长', position: '组长', role: 'manager' },
  { key: 'EMPTY_MANAGER', email: 'uat-empty-manager@local.test', name: '本地空组组长', position: '组长', role: 'manager' },
  { key: 'TEAM_MEMBER', email: 'uat-team-member@local.test', name: '本地研发成员', position: '前端工程师', role: 'user' },
  { key: 'OUTSIDER', email: 'uat-outsider@local.test', name: '本地无关成员', position: '前端工程师', role: 'user' },
  { key: 'CROSS_GROUP_OWNER', email: 'uat-cross-owner@local.test', name: '本地跨组负责人', position: '项目负责人', role: 'user' },
  { key: 'PROJECT_OWNER', email: 'uat-project-owner@local.test', name: '本地项目负责人', position: '项目负责人', role: 'user' },
  { key: 'TEST_LEAD', email: 'uat-test-lead@local.test', name: '本地测试组长', position: '测试组长', role: 'manager' },
  { key: 'TEST_ENGINEER', email: 'uat-test-engineer@local.test', name: '本地测试工程师', position: '测试工程师', role: 'user' },
  { key: 'TEST_PARTICIPANT', email: 'uat-test-participant@local.test', name: '本地测试参与人', position: '测试工程师', role: 'user' },
  { key: 'AUTOMATION_TESTER', email: 'uat-automation@local.test', name: '本地自动化测试工程师', position: '自动化测试工程师', role: 'user' },
];

async function allUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

const existingUsers = await allUsers();
const developerIds = new Map();

for (const account of accounts) {
  let user = existingUsers.find((candidate) => candidate.email?.toLowerCase() === account.email);
  if (user) {
    const { data, error } = await client.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { name: account.name, position: account.position },
    });
    if (error) throw new Error(`更新本地账号 ${account.key} 失败：${error.message}`);
    user = data.user;
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { name: account.name, position: account.position },
    });
    if (error || !data.user) throw new Error(`创建本地账号 ${account.key} 失败：${error?.message ?? '未知错误'}`);
    user = data.user;
  }

  const { error: profileError } = await client
    .from('profiles')
    .upsert({ id: user.id }, { onConflict: 'id' });
  if (profileError) throw new Error(`设置本地账号 ${account.key} 资料失败：${profileError.message}`);

  const { error: roleError } = await client
    .from('user_roles')
    .upsert({ user_id: user.id, role: account.role }, { onConflict: 'user_id' });
  if (roleError) throw new Error(`设置本地账号 ${account.key} 角色失败：${roleError.message}`);

  const { data: developer, error: developerError } = await client
    .from('developers')
    .upsert(
      { user_id: user.id, name: account.name, position: account.position, is_active: true },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single();
  if (developerError) throw new Error(`设置本地账号 ${account.key} 档案失败：${developerError.message}`);
  developerIds.set(account.key, developer.id);
}

async function ensureTeam(name, leaderKey, isTestTeam) {
  const leaderId = developerIds.get(leaderKey);
  const { data: existing, error: findError } = await client
    .from('teams')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) {
    const { error } = await client
      .from('teams')
      .update({ leader_id: leaderId, is_test_team: isTestTeam })
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await client
    .from('teams')
    .insert({ name, leader_id: leaderId, is_test_team: isTestTeam })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureMember(teamId, accountKey) {
  const { error } = await client
    .from('developer_teams')
    .upsert(
      { team_id: teamId, developer_id: developerIds.get(accountKey) },
      { onConflict: 'developer_id,team_id' },
    );
  if (error) throw error;
}

const developmentTeamId = await ensureTeam('Local UAT 研发组', 'PROJECT_OWNER', false);
await ensureMember(developmentTeamId, 'USER');

const testTeamId = await ensureTeam('Local UAT 测试组', 'TEST_LEAD', true);
for (const key of ['TEST_ENGINEER', 'TEST_PARTICIPANT', 'AUTOMATION_TESTER']) {
  await ensureMember(testTeamId, key);
}

const root = process.cwd();
const localRunId = `local-${Date.now().toString(36)}`;
await fs.writeFile(
  path.join(root, '.env.local'),
  `SUPABASE_URL=${apiUrl}\nSUPABASE_ANON_KEY=${anonKey}\n`,
  { encoding: 'utf8' },
);

const uatLines = [
  'UAT_BASE_URL=http://127.0.0.1:3000',
  `UAT_RUN_ID=${localRunId}`,
  ...accounts.flatMap((account) => [
    `UAT_${account.key}_EMAIL=${account.email}`,
    `UAT_${account.key}_PASSWORD=${password}`,
  ]),
];
await fs.writeFile(path.join(root, '.env.uat.local'), `${uatLines.join('\n')}\n`, { encoding: 'utf8' });

console.log(`本地测试夹具已就绪：${accounts.length} 个账号、2 个基础小组。`);
