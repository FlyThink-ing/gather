import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';
import { BrowserRestClient } from '../support/rest';
import type { AccountKey } from '../support/env';
import { uatEnv } from '../support/env';

type Session = {
  context: BrowserContext;
  page: Page;
  rest: BrowserRestClient;
  developerId: string;
};

async function session(browser: Browser, baseURL: string, key: AccountKey): Promise<Session> {
  const context = await browser.newContext({ baseURL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  const rest = new BrowserRestClient();
  rest.attach(page);
  await login(page, requireAccount(key));
  await rest.waitUntilReady(page);
  const me = await rest.request<string>(page, 'rpc/current_developer_id', { method: 'POST', body: {} });
  expect(me.status).toBe(200);
  expect(me.data).toBeTruthy();
  return { context, page, rest, developerId: me.data! };
}

async function patchStatus(actor: Session, taskId: string, body: Record<string, unknown>) {
  return actor.rest.request<Array<{ id: string; status: string }>>(actor.page, `tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body,
    prefer: 'return=representation',
  });
}

test('UAT 任务开始、提交、小组组长批准/驳回及项目负责人越权校验 @full', async ({ browser }, testInfo) => {
  const adminCredentials = requireAccount('admin');
  const ownerCredentials = requireAccount('projectOwner');
  const userCredentials = requireAccount('teamMember');
  const leadCredentials = requireAccount('testLead');
  const groupLeadCredentials = requireAccount('user');
  test.skip(
    new Set([adminCredentials.email, ownerCredentials.email, userCredentials.email, leadCredentials.email, groupLeadCredentials.email]).size < 5,
    '任务全流程需要五个不同账号验证职责边界。',
  );

  const baseURL = String(testInfo.project.use.baseURL);
  const sessions: Session[] = [];
  try {
    const admin = await session(browser, baseURL, 'admin'); sessions.push(admin);
    const owner = await session(browser, baseURL, 'projectOwner'); sessions.push(owner);
    const assignee = await session(browser, baseURL, 'teamMember'); sessions.push(assignee);
    const testLead = await session(browser, baseURL, 'testLead'); sessions.push(testLead);
    const groupLead = await session(browser, baseURL, 'user'); sessions.push(groupLead);
    const testTeams = await testLead.rest.request<Array<{ id: string }>>(
      testLead.page,
      `teams?select=id&is_test_team=eq.true&leader_id=eq.${testLead.developerId}&limit=1`,
    );
    const testTeamId = testTeams.data?.[0]?.id;
    test.skip(!testTeamId, 'UAT_TEST_LEAD 必须是 is_test_team 小组的 leader。');

    const team = await admin.rest.request<Array<{ id: string }>>(admin.page, 'teams', {
      method: 'POST',
      body: { name: `UAT-研发组-${uatEnv.runId}`, leader_id: groupLead.developerId, is_test_team: false },
      prefer: 'return=representation',
    });
    expect(team.status).toBe(201);
    const teamId = team.data?.[0]?.id;
    expect(teamId).toBeTruthy();
    const membership = await admin.rest.request(admin.page, 'developer_teams', {
      method: 'POST', body: { team_id: teamId, developer_id: assignee.developerId },
    });
    expect(membership.status).toBe(201);

    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const projectName = `UAT-任务流转-${uatEnv.runId}`;
    const project = await admin.rest.request<Array<{ id: string }>>(admin.page, 'projects', {
      method: 'POST',
      body: {
        name: projectName,
        description: 'Playwright UAT 自动生成；仅用于验收，保留审计。',
        owner_id: owner.developerId,
        created_by: admin.developerId,
        start_date: today,
        end_date: due,
      },
      prefer: 'return=representation',
    });
    expect(project.status).toBe(201);
    const projectId = project.data?.[0]?.id;
    expect(projectId).toBeTruthy();

    const tasks = await admin.rest.request<Array<{ id: string; title: string }>>(admin.page, 'tasks', {
      method: 'POST',
      body: [
        {
          title: `UAT-任务批准-${uatEnv.runId}`,
          project_id: projectId,
          developer_id: assignee.developerId,
          team_id: teamId,
          start_date: today,
          due_date: due,
          created_by: admin.developerId,
        },
        {
          title: `UAT-任务驳回-${uatEnv.runId}`,
          project_id: projectId,
          developer_id: assignee.developerId,
          team_id: teamId,
          start_date: today,
          due_date: due,
          created_by: admin.developerId,
        },
      ],
      prefer: 'return=representation',
    });
    expect(tasks.status).toBe(201);
    expect(tasks.data).toHaveLength(2);
    const approveTask = tasks.data!.find((item) => item.title.includes('任务批准'))!;
    const rejectTask = tasks.data!.find((item) => item.title.includes('任务驳回'))!;

    for (const task of [approveTask, rejectTask]) {
      const started = await patchStatus(assignee, task.id, { status: 'in_progress' });
      expect(started.status).toBe(200);
      expect(started.data?.[0]?.status).toBe('in_progress');
      if (task.id === approveTask.id) {
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const paused = await patchStatus(assignee, task.id, { status: 'paused' });
          expect(paused.data?.[0]?.status).toBe('paused');
          const resumed = await patchStatus(assignee, task.id, { status: 'in_progress' });
          expect(resumed.data?.[0]?.status).toBe('in_progress');
        }
      }
      const submitted = await patchStatus(assignee, task.id, { status: 'review' });
      expect(submitted.status).toBe(200);
      expect(submitted.data?.[0]?.status).toBe('review');
    }

    const pauseHistory = await groupLead.rest.request<Array<{ paused_at: string; resumed_at: string }>>(
      groupLead.page, `task_pause_periods?select=paused_at,resumed_at&task_id=eq.${approveTask.id}&order=paused_at.asc`,
    );
    expect(pauseHistory.status).toBe(200);
    expect(pauseHistory.data).toHaveLength(2);
    const [firstPause, secondPause] = pauseHistory.data!;
    expect(Date.parse(firstPause.resumed_at)).toBeGreaterThanOrEqual(Date.parse(firstPause.paused_at));
    expect(Date.parse(secondPause.resumed_at)).toBeGreaterThanOrEqual(Date.parse(secondPause.paused_at));
    expect(Date.parse(secondPause.paused_at)).toBeGreaterThanOrEqual(Date.parse(firstPause.resumed_at));

    const ownerTasks = await owner.rest.request<Array<{ id: string }>>(owner.page,
      `tasks?select=id&project_id=eq.${projectId}&status=eq.review`);
    expect(ownerTasks.data?.map(({ id }) => id).sort()).toEqual([approveTask.id, rejectTask.id].sort());
    for (const actor of [owner, testLead]) {
      const forbidden = await patchStatus(actor, approveTask.id, { status: 'done' });
      expect(forbidden.status >= 400 || (forbidden.status === 200 && forbidden.data?.length === 0),
        '无权审批必须由错误响应或 RLS 空结果拒绝').toBe(true);
    }
    const stillReview = await admin.rest.request<Array<{ status: string }>>(admin.page, `tasks?select=status&id=eq.${approveTask.id}`);
    expect(stillReview.data?.[0]?.status).toBe('review');

    const approved = await patchStatus(groupLead, approveTask.id, { status: 'done' });
    expect(approved.status).toBe(200);
    expect(approved.data?.[0]?.status).toMatch(/^(done|delayed_done)$/);

    const rejected = await patchStatus(groupLead, rejectTask.id, {
      status: 'in_progress',
      reject_note: 'UAT 自动化验证：小组组长驳回后由任务负责人继续处理。',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.data?.[0]?.status).toBe('in_progress');
    const resubmitted = await patchStatus(assignee, rejectTask.id, { status: 'review' });
    expect(resubmitted.data?.[0]?.status).toBe('review');
    const approvedAfterReject = await patchStatus(groupLead, rejectTask.id, { status: 'done' });
    expect(approvedAfterReject.data?.[0]?.status).toMatch(/^(done|delayed_done)$/);

    const eligible = await owner.rest.request<{
      items: Array<{ id: string; eligible_task_count: number }>;
    }>(owner.page, 'rpc/get_eligible_internal_test_projects', {
      method: 'POST',
      body: { p_search: projectName },
    });
    expect(eligible.status).toBe(200);
    expect(eligible.data?.items).toContainEqual(expect.objectContaining({ id: projectId, eligible_task_count: 2 }));

    const internalPlanPayload = {
      p_source: 'internal_project',
      p_title: `UAT-内部测试-${uatEnv.runId}`,
      p_test_team_id: testTeamId,
      p_project_id: projectId,
      p_external_project_name: null,
      p_external_owner_name: null,
      p_version_name: 'UAT-v1',
      p_test_scope: '已审批且尚未被通过轮次覆盖的开发任务',
      p_test_goal: '验证内部测试候选项目规则',
      p_deliverables: 'UAT 结构化结论',
      p_expected_start: today,
      p_expected_end: due,
      p_environment_note: 'UAT',
      p_priority: 'medium',
      p_related_url: null,
      p_zentao_url: null,
      p_recommended_owner_id: null,
      p_report_types: [],
    };
    const forbiddenPlan = await assignee.rest.request<string>(assignee.page, 'rpc/create_test_plan', {
      method: 'POST', body: internalPlanPayload,
    });
    expect(forbiddenPlan.status).toBeGreaterThanOrEqual(400);

    const internalPlan = await owner.rest.request<string>(owner.page, 'rpc/create_test_plan', {
      method: 'POST', body: internalPlanPayload,
    });
    expect(internalPlan.status).toBe(200);
    expect(internalPlan.data).toBeTruthy();
    const internalCycle = await owner.rest.request<Array<{ status: string }>>(
      owner.page,
      `test_cycles?select=status&plan_id=eq.${internalPlan.data}&limit=1`,
    );
    expect(internalCycle.data?.[0]?.status).toBe('requested');
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
});
