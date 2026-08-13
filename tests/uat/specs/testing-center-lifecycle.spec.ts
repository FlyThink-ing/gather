import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { login } from '../support/auth';
import { requireAccount } from '../support/skip';
import { BrowserRestClient } from '../support/rest';
import { uatEnv, type AccountKey } from '../support/env';

type Session = { context: BrowserContext; page: Page; rest: BrowserRestClient; developerId: string };

async function session(browser: Browser, baseURL: string, key: AccountKey): Promise<Session> {
  const context = await browser.newContext({ baseURL, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  const rest = new BrowserRestClient();
  rest.attach(page);
  await login(page, requireAccount(key));
  await rest.waitUntilReady(page);
  const me = await rest.request<string>(page, 'rpc/current_developer_id', { method: 'POST', body: {} });
  expect(me.status).toBe(200);
  return { context, page, rest, developerId: me.data! };
}

async function rpc<T>(actor: Session, name: string, body: Record<string, unknown>) {
  return actor.rest.request<T>(actor.page, `rpc/${name}`, { method: 'POST', body });
}

test('外部测试排期、活动、批次、工时、结构化结论退回与批准 @full', async ({ browser }, testInfo) => {
  const testerCredentials = requireAccount('testEngineer');
  const leadCredentials = requireAccount('testLead');
  test.skip(testerCredentials.email === leadCredentials.email, '需测试工程师与测试组长两个不同账号验证职责分离。');

  const baseURL = String(testInfo.project.use.baseURL);
  const sessions: Session[] = [];
  try {
    const tester = await session(browser, baseURL, 'testEngineer'); sessions.push(tester);
    const lead = await session(browser, baseURL, 'testLead'); sessions.push(lead);
    const team = await lead.rest.request<Array<{ id: string }>>(
      lead.page,
      `teams?select=id&is_test_team=eq.true&leader_id=eq.${lead.developerId}&limit=1`,
    );
    const teamId = team.data?.[0]?.id;
    test.skip(!teamId, 'UAT_TEST_LEAD 必须是 is_test_team 小组的 leader。');

    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const planTitle = `UAT-外部测试-${uatEnv.runId}`;
    const plan = await rpc<string>(tester, 'create_test_plan', {
      p_source: 'external_request',
      p_title: planTitle,
      p_test_team_id: teamId,
      p_project_id: null,
      p_external_project_name: `UAT-外部项目-${uatEnv.runId}`,
      p_external_owner_name: 'UAT 外部负责人',
      p_version_name: 'UAT-v1',
      p_test_scope: '登录、权限与核心业务流程',
      p_test_goal: '验证 UAT 外部测试完整状态机',
      p_deliverables: '结构化测试结论',
      p_expected_start: today,
      p_expected_end: end,
      p_environment_note: 'UAT 环境',
      p_priority: 'medium',
      p_related_url: null,
      p_zentao_url: null,
      p_recommended_owner_id: tester.developerId,
      p_report_types: [],
    });
    expect(plan.status).toBe(200);
    const planId = plan.data!;
    const cycles = await tester.rest.request<Array<{ id: string; status: string }>>(
      tester.page,
      `test_cycles?select=id,status&plan_id=eq.${planId}&limit=1`,
    );
    const cycleId = cycles.data?.[0]?.id;
    expect(cycleId).toBeTruthy();

    const schedule = await rpc<null>(lead, 'review_test_schedule', {
      p_cycle_id: cycleId,
      p_accept: true,
      p_main_tester_id: tester.developerId,
      p_planned_start: today,
      p_planned_end: end,
      p_participants: [],
      p_reason: 'UAT 自动化确认排期',
    });
    expect(schedule.status).toBe(204);

    const activity = await rpc<string>(lead, 'add_test_activity', {
      p_cycle_id: cycleId,
      p_activity_type: 'system',
      p_title: `UAT-系统测试活动-${uatEnv.runId}`,
      p_owner_id: tester.developerId,
      p_planned_start: today,
      p_planned_end: end,
      p_planned_hours: 8,
      p_preconditions: 'UAT 环境可用',
      p_expected_deliverable: 'UAT 结构化结论',
      p_participants: [],
    });
    expect(activity.status).toBe(200);
    const activityId = activity.data!;

    const started = await rpc<null>(tester, 'transition_test_cycle', { p_cycle_id: cycleId, p_action: 'start', p_reason: null });
    expect(started.status).toBe(204);
    const task = await tester.rest.request<Array<{ id: string }>>(
      tester.page,
      `tasks?select=id&test_activity_id=eq.${activityId}&limit=1`,
    );
    expect(task.data?.[0]?.id).toBeTruthy();
    const hours = await rpc<string>(tester, 'record_test_work_hours', {
      p_task_id: task.data![0].id,
      p_work_date: today,
      p_hours: 1,
      p_note: 'UAT 自动化工时口径验证',
    });
    expect(hours.status).toBe(200);

    const batch = await rpc<string>(tester, 'add_test_execution_batch', {
      p_cycle_id: cycleId,
      p_activity_id: activityId,
      p_executed_on: today,
      p_environment_name: 'UAT',
      p_build_version: 'UAT-v1',
      p_test_type: 'system',
      p_planned_count: 5,
      p_executed_count: 5,
      p_passed_count: 5,
      p_failed_count: 0,
      p_blocked_count: 0,
      p_skipped_count: 0,
      p_bug_count: 0,
      p_reopen_count: 0,
      p_smoke_passed: null,
      p_issue_summary: '无',
      p_blocker_summary: '无',
      p_risk_summary: '无',
      p_zentao_url: null,
    });
    expect(batch.status).toBe(200);

    const conclusion = {
      p_cycle_id: cycleId,
      p_result: 'pass',
      p_scope: '登录、权限与核心流程',
      p_completion: '计划用例全部执行',
      p_new_issues: '无',
      p_legacy_issues: '无',
      p_blockers: '无',
      p_risks: '无',
      p_release_recommendation: '建议进入下一验收阶段',
    };
    expect((await rpc<null>(tester, 'submit_test_conclusion', conclusion)).status).toBe(204);
    expect((await rpc<null>(lead, 'review_test_conclusion', {
      p_cycle_id: cycleId, p_confirm: false, p_reason: 'UAT 自动化验证退回后允许补充',
    })).status).toBe(204);
    expect((await rpc<null>(tester, 'submit_test_conclusion', conclusion)).status).toBe(204);
    const resubmittedCycle = await tester.rest.request<Array<{ status: string; proposed_result: string }>>(
      tester.page,
      `test_cycles?select=status,proposed_result&id=eq.${cycleId}`,
    );
    expect(resubmittedCycle.data?.[0]).toMatchObject({ status: 'conclusion_pending', proposed_result: 'pass' });
    const approval = await rpc<null>(lead, 'review_test_conclusion', {
      p_cycle_id: cycleId, p_confirm: true, p_reason: 'UAT 自动化确认通过',
    });
    expect(
      approval.status,
      `最终结论批准失败：${approval.errorCode ?? 'UNKNOWN'} ${approval.errorMessage ?? ''}`.trim(),
    ).toBe(204);

    const finalCycle = await tester.rest.request<Array<{ status: string; proposed_result: string }>>(
      tester.page,
      `test_cycles?select=status,proposed_result&id=eq.${cycleId}`,
    );
    expect(finalCycle.data?.[0]).toMatchObject({ status: 'passed', proposed_result: 'pass' });
    const finalPlan = await tester.rest.request<Array<{ status: string }>>(
      tester.page,
      `test_plans?select=status&id=eq.${planId}`,
    );
    expect(finalPlan.data?.[0]?.status).toBe('passed');

    await tester.page.goto(`/#/testing/plans/${planId}`);
    await expect(tester.page.getByRole('heading', { name: planTitle })).toBeVisible();
    await expect(tester.page.getByText('系统测试').first()).toBeVisible();
    await expect(tester.page.getByText('1.0 小时').first()).toBeVisible();
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
});

test('测试建设创建、排期、拆分、更新进度、工时与成果确认 @full', async ({ browser }, testInfo) => {
  const automationCredentials = requireAccount('automationTester');
  const leadCredentials = requireAccount('testLead');
  test.skip(automationCredentials.email === leadCredentials.email, '需自动化测试工程师与测试组长两个不同账号验证职责分离。');

  const baseURL = String(testInfo.project.use.baseURL);
  const sessions: Session[] = [];
  try {
    const automation = await session(browser, baseURL, 'automationTester'); sessions.push(automation);
    const lead = await session(browser, baseURL, 'testLead'); sessions.push(lead);
    const leadRole = await rpc<boolean>(lead, 'is_test_lead', {});
    expect(leadRole.status).toBe(200);
    expect(leadRole.data, 'UAT_TEST_LEAD 必须是已标记为测试小组的小组负责人。').toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const title = `UAT-测试建设-${uatEnv.runId}`;

    const work = await rpc<string>(automation, 'create_test_construction', {
      p_title: title,
      p_work_type: 'automation_script',
      p_goal: '验证测试建设完整状态机',
      p_priority: 'medium',
      p_owner_id: automation.developerId,
      p_planned_start: today,
      p_planned_end: end,
      p_deliverables: '可重复运行的自动化验收脚本',
      p_acceptance_criteria: 'full 用例通过并保留报告',
      p_resource_links: null,
      p_participants: [],
    });
    expect(work.status).toBe(200);
    const workId = work.data!;
    expect((await rpc<null>(automation, 'transition_construction', {
      p_work_id: workId, p_action: 'submit_schedule', p_reason: null,
    })).status).toBe(204);
    expect((await rpc<null>(lead, 'transition_construction', {
      p_work_id: workId, p_action: 'confirm_schedule', p_reason: null,
    })).status).toBe(204);

    const task = await rpc<string>(automation, 'add_construction_task', {
      p_work_id: workId,
      p_title: `UAT-建设子任务-${uatEnv.runId}`,
      p_owner_id: automation.developerId,
      p_planned_start: today,
      p_planned_end: end,
      p_planned_hours: 8,
    });
    expect(task.status).toBe(200);
    const subTaskId = task.data!;
    expect((await rpc<null>(automation, 'update_construction_task', {
      p_construction_task_id: subTaskId, p_status: 'in_progress', p_progress: 50,
    })).status).toBe(204);
    const constructionTask = await automation.rest.request<Array<{ task_id: string; progress: number }>>(
      automation.page,
      `test_construction_tasks?select=task_id,progress&id=eq.${subTaskId}`,
    );
    expect(constructionTask.data?.[0]?.progress).toBe(50);
    expect((await rpc<string>(automation, 'record_test_work_hours', {
      p_task_id: constructionTask.data![0].task_id,
      p_work_date: today,
      p_hours: 1,
      p_note: 'UAT 测试建设工时验证',
    })).status).toBe(200);
    expect((await rpc<null>(automation, 'update_construction_task', {
      p_construction_task_id: subTaskId, p_status: 'done', p_progress: 100,
    })).status).toBe(204);
    expect((await rpc<null>(automation, 'transition_construction', {
      p_work_id: workId, p_action: 'submit_result', p_reason: 'UAT 自动化成果已完成',
    })).status).toBe(204);
    expect((await rpc<null>(lead, 'transition_construction', {
      p_work_id: workId, p_action: 'confirm_result', p_reason: null,
    })).status).toBe(204);

    const finalWork = await automation.rest.request<Array<{ status: string }>>(
      automation.page,
      `test_construction_works?select=status&id=eq.${workId}`,
    );
    expect(finalWork.data?.[0]?.status).toBe('completed');

    type ConstructionSummary = {
      id: string;
      task_count: number;
      done_count: number;
      planned_hours: number;
      actual_hours: number;
    };
    const detail = await rpc<ConstructionSummary & { tasks: Array<{ actual_hours: number; planned_hours: number }> }>(
      automation,
      'get_construction_detail',
      { p_work_id: workId },
    );
    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({ task_count: 1, done_count: 1, planned_hours: 8, actual_hours: 1 });
    expect(detail.data?.tasks).toEqual([
      expect.objectContaining({ planned_hours: 8, actual_hours: 1 }),
    ]);

    const list = await rpc<{ items: ConstructionSummary[] }>(automation, 'get_construction_works', {
      p_status: null,
      p_page: 1,
      p_page_size: 100,
    });
    expect(list.status).toBe(200);
    expect(list.data?.items.find((item) => item.id === workId)).toMatchObject({
      task_count: 1,
      done_count: 1,
      planned_hours: 8,
      actual_hours: 1,
    });

    await automation.page.goto(`/#/testing/construction/${workId}`);
    await expect(automation.page.getByRole('heading', { name: title })).toBeVisible();
    await expect(automation.page.getByText('已完成').first()).toBeVisible();
    await expect(automation.page.getByText('任务进度', { exact: true }).locator('..')).toContainText('1/1');
    await expect(automation.page.getByText('计划工时', { exact: true }).locator('..')).toContainText('8.0 小时');
    await expect(automation.page.getByText('实际工时', { exact: true }).locator('..')).toContainText('1.0 小时');
    await expect(automation.page.getByRole('heading', { name: '建设任务与实际工时' }).locator('..')).toContainText('1.0 小时 / 0.1 人天 / 8.0 小时 / 1.0 人天');
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
});
