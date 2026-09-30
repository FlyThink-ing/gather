import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { login } from './auth';
import { account, type AccountKey, type UatAccount } from './env';
import { BrowserRestClient } from './rest';

export type HardeningSession = {
  key: AccountKey;
  context: BrowserContext;
  page: Page;
  rest: BrowserRestClient;
  developerId: string;
};

export function strictAccount(key: AccountKey): UatAccount {
  const credentials = account(key);
  if (!credentials) {
    throw new Error(`权限加固回归缺少 ${key} 账号；请仅在本地 .env.uat 中填写对应变量。关键用例不会跳过。`);
  }
  return credentials;
}

export function requireDistinctAccounts(keys: AccountKey[]) {
  const rows = keys.map((key) => ({ key, credentials: strictAccount(key) }));
  const emails = new Set(rows.map(({ credentials }) => credentials.email.toLowerCase()));
  expect(emails.size, `权限矩阵要求以下账号互不相同：${keys.join('、')}`).toBe(rows.length);
}

export async function openHardeningSession(
  browser: Browser,
  baseURL: string,
  key: AccountKey,
): Promise<HardeningSession> {
  const context = await browser.newContext({ baseURL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  const rest = new BrowserRestClient();
  rest.attach(page);
  await login(page, strictAccount(key));
  await rest.waitUntilReady(page);
  const me = await rest.request<string>(page, 'rpc/current_developer_id', { method: 'POST', body: {} });
  expect(me.status, `${key} 必须绑定有效人员档案`).toBe(200);
  expect(me.data, `${key} 必须绑定有效人员档案`).toBeTruthy();
  return { key, context, page, rest, developerId: me.data! };
}

export async function closeHardeningSessions(sessions: HardeningSession[]) {
  await Promise.all(sessions.map(({ context }) => context.close()));
}

export function rpc<T>(actor: HardeningSession, name: string, body: Record<string, unknown> = {}) {
  return actor.rest.request<T>(actor.page, `rpc/${name}`, { method: 'POST', body });
}

export async function createTeam(
  admin: HardeningSession,
  name: string,
  leaderId: string,
  isTestTeam = false,
) {
  const result = await admin.rest.request<Array<{ id: string }>>(admin.page, 'teams', {
    method: 'POST',
    body: { name, leader_id: leaderId, is_test_team: isTestTeam },
    prefer: 'return=representation',
  });
  expect(result.status, `创建 UAT 小组失败：${result.errorCode ?? ''} ${result.errorMessage ?? ''}`).toBe(201);
  expect(result.data?.[0]?.id).toBeTruthy();
  return result.data![0].id;
}

export async function addTeamMember(admin: HardeningSession, teamId: string, developerId: string) {
  const result = await admin.rest.request(admin.page, 'developer_teams', {
    method: 'POST',
    body: { team_id: teamId, developer_id: developerId },
    prefer: 'return=representation',
  });
  expect(result.status, `创建 UAT 小组成员关系失败：${result.errorCode ?? ''} ${result.errorMessage ?? ''}`).toBe(201);
}

export async function createProject(
  admin: HardeningSession,
  input: { name: string; teamId: string; ownerId: string; start: string; end: string },
) {
  const result = await admin.rest.request<Array<{ id: string }>>(admin.page, 'projects', {
    method: 'POST',
    body: {
      name: input.name,
      description: 'UAT 权限加固自动化数据；仅用于验收并保留审计。',
      team_id: input.teamId,
      owner_id: input.ownerId,
      created_by: admin.developerId,
      start_date: input.start,
      end_date: input.end,
    },
    prefer: 'return=representation',
  });
  expect(result.status, `创建 UAT 项目失败：${result.errorCode ?? ''} ${result.errorMessage ?? ''}`).toBe(201);
  expect(result.data?.[0]?.id).toBeTruthy();
  return result.data![0].id;
}

export type CreatedTask = { id: string; title: string; status: string };

export async function createTasks(
  admin: HardeningSession,
  rows: Array<{
    title: string;
    projectId?: string | null;
    developerId: string;
    teamId?: string | null;
    start: string;
    due: string;
  }>,
) {
  const result = await admin.rest.request<CreatedTask[]>(admin.page, 'tasks', {
    method: 'POST',
    body: rows.map((row) => ({
      title: row.title,
      description: 'UAT 权限加固自动化任务；仅用于验收并保留审计。',
      project_id: row.projectId ?? null,
      developer_id: row.developerId,
      team_id: row.teamId ?? null,
      start_date: row.start,
      due_date: row.due,
      created_by: admin.developerId,
      task_type: 'dev',
      work_source: 'development',
    })),
    prefer: 'return=representation',
  });
  expect(result.status, `创建 UAT 任务失败：${result.errorCode ?? ''} ${result.errorMessage ?? ''}`).toBe(201);
  expect(result.data).toHaveLength(rows.length);
  return result.data!;
}

export async function patchTask(actor: HardeningSession, taskId: string, body: Record<string, unknown>) {
  return actor.rest.request<Array<CreatedTask>>(actor.page, `tasks?id=eq.${taskId}`, {
    method: 'PATCH', body, prefer: 'return=representation',
  });
}

export async function taskState(admin: HardeningSession, taskId: string) {
  const result = await admin.rest.request<Array<CreatedTask>>(admin.page, `tasks?select=id,title,status&id=eq.${taskId}`);
  expect(result.status).toBe(200);
  expect(result.data).toHaveLength(1);
  return result.data![0];
}

export async function expectDenied(result: { status: number; data: unknown; errorCode: string | null }) {
  if (result.status >= 400) return;
  expect(result.data, 'RLS 静默过滤时必须返回空集合，不能返回被修改对象').toEqual([]);
}

export function listTasksBody(overrides: Record<string, unknown> = {}) {
  return {
    p_scope: 'all', p_query: null, p_task_type: null, p_project_id: null,
    p_statuses: null, p_priority: null, p_assignee: null, p_team_id: null,
    p_timing: null, p_preset: null, p_result: null, p_blocked: null,
    p_summary: null, p_focus_id: null, p_page: 1, p_page_size: 100,
    ...overrides,
  };
}

export function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
