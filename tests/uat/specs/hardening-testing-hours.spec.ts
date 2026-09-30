import { test, expect, type Browser } from '@playwright/test';
import { uatEnv, type AccountKey } from '../support/env';
import {
  addTeamMember,
  closeHardeningSessions,
  createProject,
  createTasks,
  createTeam,
  isoDate,
  openHardeningSession,
  patchTask,
  requireDistinctAccounts,
  rpc,
  type HardeningSession,
} from '../support/hardening';

type PlanFixture = { planId: string; cycleId: string; activityId: string; taskId: string; title: string };

test.describe('权限与流程加固：测试可见性、工时和布局 @hardening @full', () => {
  test.setTimeout(300_000);

  test('VIS-TEST-01 开发就绪、requested 展示、只读深链与测试职责边界', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = [
      'admin', 'teamLead', 'crossGroupOwner', 'teamMember',
      'testLead', 'testEngineer', 'testParticipant', 'outsider',
    ];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-vis-test`;
      const start = isoDate();
      const end = isoDate(12);
      const projectTeam = await createTeam(actors.admin, `UAT-提测项目组-${suffix}`, actors.teamLead.developerId);
      const testTeam = await createTeam(actors.admin, `UAT-提测测试组-${suffix}`, actors.testLead.developerId, true);
      await addTeamMember(actors.admin, projectTeam, actors.teamMember.developerId);
      await addTeamMember(actors.admin, testTeam, actors.testEngineer.developerId);
      await addTeamMember(actors.admin, testTeam, actors.testParticipant.developerId);
      const projectName = `UAT-VIS-TEST-01-${suffix}`;
      const projectId = await createProject(actors.admin, {
        name: projectName, teamId: projectTeam, ownerId: actors.crossGroupOwner.developerId, start, end,
      });
      const tasks = await createTasks(actors.admin, ['ready-first', 'still-open'].map((name) => ({
        title: `UAT-VIS-TEST-${name}-${suffix}`, projectId,
        developerId: actors.teamMember.developerId, teamId: projectTeam, start, due: end,
      })));

      await approveTask(actors.teamMember, actors.crossGroupOwner, tasks[0].id);
      await expectCandidate(actors.crossGroupOwner, projectId, projectName, false);
      await approveTask(actors.teamMember, actors.crossGroupOwner, tasks[1].id);
      await expectCandidate(actors.crossGroupOwner, projectId, projectName, true);

      const title = `UAT-内部计划-${suffix}`;
      const created = await rpc<string>(actors.crossGroupOwner, 'create_test_plan', planPayload({
        title, testTeamId: testTeam, projectId, start, end,
      }));
      expect(created.status).toBe(200);
      const planId = created.data!;
      const cycleRows = await actors.crossGroupOwner.rest.request<Array<{ id: string; status: string }>>(
        actors.crossGroupOwner.page,
        `test_cycles?select=id,status&plan_id=eq.${planId}`,
      );
      const cycleId = cycleRows.data?.[0]?.id;
      expect(cycleRows.data?.[0]?.status).toBe('requested');
      await expectCandidate(actors.crossGroupOwner, projectId, projectName, false);

      const ownerCenter = await rpc<{ items: Array<{ id: string; cycle_status: string }> }>(actors.crossGroupOwner, 'get_testing_center', {
        p_source: 'internal_project', p_status: null, p_page: 1, p_page_size: 100,
      });
      expect(ownerCenter.data?.items).toContainEqual(expect.objectContaining({ id: planId, cycle_status: 'requested' }));
      for (const actor of [actors.outsider, actors.testEngineer, actors.testParticipant]) {
        const center = await rpc<{ items: Array<{ id: string }> }>(actor, 'get_testing_center', {
          p_source: null, p_status: null, p_page: 1, p_page_size: 100,
        });
        expect(center.data?.items.map(({ id }) => id)).not.toContain(planId);
        const detail = await rpc(actor, 'get_test_plan_detail', { p_plan_id: planId });
        expect(detail.status, `${actor.key} 在建立计划关系前不得深链查看`).toBeGreaterThanOrEqual(400);
      }

      await actors.crossGroupOwner.page.goto(`/#/testing/plans/${planId}`);
      await expect(actors.crossGroupOwner.page.getByRole('heading', { name: title })).toBeVisible();
      await expect(actors.crossGroupOwner.page.getByText('只读访问')).toBeVisible();
      await expect(actors.crossGroupOwner.page.getByRole('button', { name: '确认排期' })).toHaveCount(0);
      const ownerSchedule = await rpc(actors.crossGroupOwner, 'review_test_schedule', {
        p_cycle_id: cycleId, p_accept: true, p_main_tester_id: actors.testEngineer.developerId,
        p_planned_start: start, p_planned_end: end, p_participants: [], p_reason: 'FORBIDDEN',
      });
      expect(ownerSchedule.status).toBeGreaterThanOrEqual(400);

      await actors.testLead.page.goto(`/#/testing/plans/${planId}`);
      await expect(actors.testLead.page.getByRole('button', { name: '确认排期' })).toBeVisible();
      const schedule = await rpc(actors.testLead, 'review_test_schedule', {
        p_cycle_id: cycleId, p_accept: true, p_main_tester_id: actors.testEngineer.developerId,
        p_planned_start: start, p_planned_end: end,
        p_participants: [{ developer_id: actors.testParticipant.developerId, planned_hours: 0 }],
        p_reason: 'UAT 测试组长确认排期',
      });
      expect(schedule.status).toBe(204);

      for (const actor of [actors.crossGroupOwner, actors.testLead, actors.testEngineer, actors.testParticipant]) {
        const detail = await rpc(actor, 'get_test_plan_detail', { p_plan_id: planId });
        expect(detail.status, `${actor.key} 应可查看已建立关系的计划`).toBe(200);
      }
      const stillDenied = await rpc(actors.outsider, 'get_test_plan_detail', { p_plan_id: planId });
      expect(stillDenied.status).toBeGreaterThanOrEqual(400);
      const startByParticipant = await rpc(actors.testParticipant, 'transition_test_cycle', {
        p_cycle_id: cycleId, p_action: 'start', p_reason: null,
      });
      expect(startByParticipant.status, '普通参与人不得代替主测或组长启动轮次').toBeGreaterThanOrEqual(400);
      const startByMain = await rpc(actors.testEngineer, 'transition_test_cycle', {
        p_cycle_id: cycleId, p_action: 'start', p_reason: null,
      });
      expect(startByMain.status).toBe(204);
      const project = await actors.admin.rest.request<Array<{ status: string; test_state: string }>>(
        actors.admin.page,
        `projects?select=status,test_state&id=eq.${projectId}`,
      );
      expect(project.data?.[0]).toMatchObject({ status: 'active', test_state: 'testing' });
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('HOURS-01 + HOURS-VIS-01 两计划工时新增、修正、作废、终态锁定与资源隔离', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'testLead', 'testEngineer', 'automationTester', 'testParticipant'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-hours`;
      const day1 = '2099-01-10';
      const day2 = '2099-01-11';
      const testTeam = await createTeam(actors.admin, `UAT-工时测试组-${suffix}`, actors.testLead.developerId, true);
      await addTeamMember(actors.admin, testTeam, actors.testEngineer.developerId);
      await addTeamMember(actors.admin, testTeam, actors.automationTester.developerId);
      await addTeamMember(actors.admin, testTeam, actors.testParticipant.developerId);

      const planA = await createExternalPlan(actors.testEngineer, actors.testLead, {
        testTeamId: testTeam, main: actors.testEngineer, title: `UAT-HOURS-A-${suffix}`,
        start: day1, end: day2, plannedHours: 5, autoStart: false,
        activityParticipants: [{ developer_id: actors.testParticipant.developerId, planned_hours: 1 }],
      });
      const planB = await createExternalPlan(actors.automationTester, actors.testLead, {
        testTeamId: testTeam, main: actors.automationTester, title: `UAT-HOURS-B-${suffix}`,
        start: day1, end: day2, plannedHours: 7,
      });

      await expectActivityAndTaskStatus(actors.testEngineer, planA, 'todo', 'todo');
      const todoLog = await rpc(actors.testParticipant, 'record_test_work_hours', {
        p_task_id: planA.taskId, p_work_date: day1, p_hours: 0.5,
        p_note: 'FORBIDDEN todo activity entry',
      });
      expect(todoLog.status, 'accepted/todo 阶段即使是活动参与人也不得登记工时').toBeGreaterThanOrEqual(400);
      expect((await rpc(actors.testEngineer, 'transition_test_cycle', {
        p_cycle_id: planA.cycleId, p_action: 'start', p_reason: null,
      })).status).toBe(204);
      await expectActivityAndTaskStatus(actors.testEngineer, planA, 'in_progress', 'in_progress');
      await recordHours(actors.testParticipant, planA.taskId, day1, 0.5, 'UAT participant active entry');

      expect((await rpc(actors.testEngineer, 'transition_test_cycle', {
        p_cycle_id: planA.cycleId, p_action: 'pause', p_reason: 'UAT 验证暂停状态同步',
      })).status).toBe(204);
      await expectActivityAndTaskStatus(actors.testEngineer, planA, 'paused', 'paused');
      expect((await rpc(actors.testEngineer, 'transition_test_cycle', {
        p_cycle_id: planA.cycleId, p_action: 'resume', p_reason: null,
      })).status).toBe(204);
      await expectActivityAndTaskStatus(actors.testEngineer, planA, 'in_progress', 'in_progress');

      const a2 = await recordHours(actors.testEngineer, planA.taskId, day1, 2, 'UAT A day1');
      const a3 = await recordHours(actors.testEngineer, planA.taskId, day2, 3, 'UAT A day2');
      const aVoid = await recordHours(actors.testEngineer, planA.taskId, day2, 1, 'UAT A void candidate');
      await recordHours(actors.automationTester, planB.taskId, day1, 4, 'UAT B isolated');

      const updated = await rpc(actors.testEngineer, 'update_test_work_entry', {
        p_segment_id: a3, p_work_date: day2, p_hours: 2.5,
        p_note: 'UAT A corrected', p_reason: 'UAT 修正误录 3h 为 2.5h',
      });
      expect(updated.status).toBe(200);
      const voided = await rpc(actors.testEngineer, 'void_test_work_entry', {
        p_segment_id: aVoid, p_reason: 'UAT 作废重复工时',
      });
      expect(voided.status).toBe(200);
      await expectPlanHours(actors.testEngineer, planA, 5, 5);

      const day1Resource = await resource(actors.testEngineer, day1, day1);
      const day2Resource = await resource(actors.testEngineer, day2, day2);
      expect(Number(day1Resource.totals.all_sources)).toBeCloseTo(2.5, 5);
      expect(Number(day2Resource.totals.all_sources)).toBeCloseTo(2.5, 5);

      const entries = await rpc<{ items: Array<{ id: string; voided_at: string | null }>; audits: Array<{ action: string }> }>(
        actors.testEngineer,
        'get_test_work_entries',
        { p_task_id: planA.taskId },
      );
      expect(entries.data?.items.find(({ id }) => id === aVoid)?.voided_at).toBeTruthy();
      expect(entries.data?.items.find(({ id }) => id === a2)?.voided_at).toBeNull();
      expect(entries.data?.audits.map(({ action }) => action)).toEqual(expect.arrayContaining(['updated', 'voided']));

      const cancelled = await rpc(actors.testLead, 'transition_test_cycle', {
        p_cycle_id: planA.cycleId, p_action: 'cancel', p_reason: 'UAT 终态工时修正权限验证',
      });
      expect(cancelled.status).toBe(204);
      await expectActivityAndTaskStatus(actors.testEngineer, planA, 'cancelled', 'paused');
      const cancelledLog = await rpc(actors.testParticipant, 'record_test_work_hours', {
        p_task_id: planA.taskId, p_work_date: day2, p_hours: 0.25,
        p_note: 'FORBIDDEN cancelled activity entry',
      });
      expect(cancelledLog.status, 'cancel 后活动终态、底层任务锁定，参与人不得再登记').toBeGreaterThanOrEqual(400);
      const forbiddenTerminalCorrection = await rpc(actors.testEngineer, 'update_test_work_entry', {
        p_segment_id: a3, p_work_date: day2, p_hours: 2.25,
        p_note: 'FORBIDDEN', p_reason: 'UAT 登记人终态不得自行修正',
      });
      expect(forbiddenTerminalCorrection.status).toBeGreaterThanOrEqual(400);
      const leadCorrection = await rpc(actors.testLead, 'update_test_work_entry', {
        p_segment_id: a3, p_work_date: day2, p_hours: 2.25,
        p_note: 'UAT lead terminal correction', p_reason: 'UAT 测试组长确认终态修正',
      });
      expect(leadCorrection.status).toBe(200);
      await expectPlanHours(actors.testEngineer, planA, 5, 4.75);

      const testerResource = await resource(actors.testEngineer, day1, day2);
      const automationResource = await resource(actors.automationTester, day1, day2);
      const leadResource = await resource(actors.testLead, day1, day2);
      expect(Number(testerResource.totals.all_sources)).toBeCloseTo(4.75, 5);
      expect(Number(automationResource.totals.all_sources)).toBeCloseTo(4, 5);
      expect(Number(leadResource.totals.all_sources)).toBeCloseTo(8.75, 5);
      expect(testerResource.rows.some((row) => row.developer_id === actors.automationTester.developerId)).toBe(false);
      expect(automationResource.rows.some((row) => row.developer_id === actors.testEngineer.developerId)).toBe(false);

      const construction = await rpc<string>(actors.automationTester, 'create_test_construction', {
        p_title: `UAT-CONSTRUCTION-HOURS-${suffix}`, p_work_type: 'automation_script',
        p_goal: '验证建设参与人不能代记他人子任务工时', p_priority: 'medium',
        p_owner_id: actors.automationTester.developerId, p_planned_start: '2099-02-01', p_planned_end: '2099-02-02',
        p_deliverables: 'UAT 权限证据', p_acceptance_criteria: '非负责人登记被拒绝', p_resource_links: null,
        p_participants: [{ developer_id: actors.testParticipant.developerId, planned_hours: 1 }],
      });
      expect(construction.status).toBe(200);
      const workId = construction.data!;
      const submitted = await rpc(actors.automationTester, 'transition_construction', {
        p_work_id: workId, p_action: 'submit_schedule', p_reason: null,
      });
      expect(submitted.status).toBe(204);
      const confirmed = await rpc(actors.testLead, 'transition_construction', {
        p_work_id: workId, p_action: 'confirm_schedule', p_reason: null,
      });
      expect(confirmed.status).toBe(204);
      const subTask = await rpc<string>(actors.automationTester, 'add_construction_task', {
        p_work_id: workId, p_title: `UAT-CONSTRUCTION-SUBTASK-${suffix}`,
        p_owner_id: actors.automationTester.developerId, p_planned_start: '2099-02-01',
        p_planned_end: '2099-02-02', p_planned_hours: 2,
      });
      expect(subTask.status).toBe(200);
      const taskRows = await actors.automationTester.rest.request<Array<{ task_id: string }>>(
        actors.automationTester.page,
        `test_construction_tasks?select=task_id&id=eq.${subTask.data}`,
      );
      const constructionTaskId = taskRows.data?.[0]?.task_id;
      expect(constructionTaskId).toBeTruthy();
      const startedConstructionTask = await rpc(actors.automationTester, 'update_construction_task', {
        p_construction_task_id: subTask.data, p_status: 'in_progress', p_progress: 10,
      });
      expect(startedConstructionTask.status).toBe(204);
      const participantLog = await rpc(actors.testParticipant, 'record_test_work_hours', {
        p_task_id: constructionTaskId, p_work_date: '2099-02-01', p_hours: 1,
        p_note: 'FORBIDDEN construction participant proxy log',
      });
      expect(participantLog.status, '建设参与人不得给别人负责的建设子任务登记工时').toBeGreaterThanOrEqual(400);
      const ownerLog = await rpc(actors.automationTester, 'record_test_work_hours', {
        p_task_id: constructionTaskId, p_work_date: '2099-02-01', p_hours: 1,
        p_note: 'UAT construction assignee log',
      });
      expect(ownerLog.status).toBe(200);
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('UI-LAYOUT-01 375/768/1280 下活动卡、nowrap 与资源表可访问', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'testLead', 'testEngineer'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-layout`;
      const teamId = await createTeam(actors.admin, `UAT-布局测试组-${suffix}`, actors.testLead.developerId, true);
      await addTeamMember(actors.admin, teamId, actors.testEngineer.developerId);
      const plan = await createExternalPlan(actors.testEngineer, actors.testLead, {
        testTeamId: teamId, main: actors.testEngineer, title: `UAT-UI-LAYOUT-01-${suffix}`,
        start: '2099-03-01', end: '2099-03-02', plannedHours: 8,
      });

      for (const width of [375, 768, 1280]) {
        await actors.testEngineer.page.setViewportSize({ width, height: 900 });
        await actors.testEngineer.page.goto(`/#/testing/plans/${plan.planId}`);
        const activityTitle = actors.testEngineer.page.getByText(`UAT-活动-${plan.title}`, { exact: true });
        await expect(activityTitle).toBeVisible();
        const card = activityTitle.locator('xpath=../..');
        for (const label of ['计划投入', '实际投入']) {
          const valueCell = card.getByText(label, { exact: true }).locator('..');
          await expect(valueCell).toHaveCSS('white-space', 'nowrap');
        }
        const overflow = await actors.testEngineer.page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        expect(overflow.scroll, `${width}px 下页面不得产生全局横向溢出`).toBeLessThanOrEqual(overflow.client + 1);
      }

      await actors.testEngineer.page.setViewportSize({ width: 375, height: 900 });
      await actors.testEngineer.page.goto('/#/testing');
      await actors.testEngineer.page.getByRole('button', { name: '资源汇总' }).click();
      const table = actors.testEngineer.page.getByRole('table');
      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader', { name: '人员' })).toBeVisible();
      await expect(table.getByRole('columnheader', { name: '计划工时' })).toBeVisible();
      await expect(table.getByRole('columnheader', { name: '内部项目' })).toBeVisible();
      await expect(table.locator('..')).toHaveCSS('overflow-x', 'auto');
    } finally {
      await closeHardeningSessions(sessions);
    }
  });
});

async function openActors<K extends AccountKey>(browser: Browser, baseURL: string, keys: K[], sessions: HardeningSession[]) {
  const result = {} as Record<K, HardeningSession>;
  for (const key of keys) {
    const actor = await openHardeningSession(browser, baseURL, key);
    sessions.push(actor);
    result[key] = actor;
  }
  return result;
}

async function approveTask(assignee: HardeningSession, owner: HardeningSession, taskId: string) {
  expect((await patchTask(assignee, taskId, { status: 'in_progress' })).data?.[0]?.status).toBe('in_progress');
  expect((await patchTask(assignee, taskId, { status: 'review' })).data?.[0]?.status).toBe('review');
  expect((await patchTask(owner, taskId, { status: 'done' })).data?.[0]?.status).toMatch(/^(done|delayed_done)$/);
}

async function expectCandidate(actor: HardeningSession, projectId: string, projectName: string, expected: boolean) {
  const result = await rpc<{ items: Array<{ id: string; name: string }> }>(actor, 'get_eligible_internal_test_projects', {
    p_search: projectName,
  });
  expect(result.status).toBe(200);
  expect(result.data?.items.some(({ id }) => id === projectId)).toBe(expected);
}

function planPayload(input: { title: string; testTeamId: string; projectId: string; start: string; end: string }) {
  return {
    p_source: 'internal_project', p_title: input.title, p_test_team_id: input.testTeamId,
    p_project_id: input.projectId, p_external_project_name: null, p_external_owner_name: null,
    p_version_name: 'UAT-v1', p_test_scope: '整项目已审批开发任务', p_test_goal: '验证权限与流程加固',
    p_deliverables: 'UAT 结构化证据', p_expected_start: input.start, p_expected_end: input.end,
    p_environment_note: 'UAT', p_priority: 'medium', p_related_url: null, p_zentao_url: null,
    p_recommended_owner_id: null, p_report_types: [],
  };
}

async function createExternalPlan(
  creator: HardeningSession,
  lead: HardeningSession,
  input: {
    testTeamId: string;
    main: HardeningSession;
    title: string;
    start: string;
    end: string;
    plannedHours: number;
    autoStart?: boolean;
    activityParticipants?: Array<{ developer_id: string; planned_hours: number }>;
  },
): Promise<PlanFixture> {
  const plan = await rpc<string>(creator, 'create_test_plan', {
    p_source: 'external_request', p_title: input.title, p_test_team_id: input.testTeamId,
    p_project_id: null, p_external_project_name: `UAT-外部-${input.title}`,
    p_external_owner_name: 'UAT 外部负责人', p_version_name: 'UAT-v1',
    p_test_scope: '权限与工时回归', p_test_goal: '验证 0012 工时合同', p_deliverables: 'UAT 证据',
    p_expected_start: input.start, p_expected_end: input.end, p_environment_note: 'UAT',
    p_priority: 'medium', p_related_url: null, p_zentao_url: null,
    p_recommended_owner_id: input.main.developerId, p_report_types: [],
  });
  expect(plan.status).toBe(200);
  const planId = plan.data!;
  const cycles = await creator.rest.request<Array<{ id: string }>>(
    creator.page,
    `test_cycles?select=id&plan_id=eq.${planId}`,
  );
  const cycleId = cycles.data?.[0]?.id;
  expect(cycleId).toBeTruthy();
  expect((await rpc(lead, 'review_test_schedule', {
    p_cycle_id: cycleId, p_accept: true, p_main_tester_id: input.main.developerId,
    p_planned_start: input.start, p_planned_end: input.end, p_participants: [], p_reason: 'UAT 排期',
  })).status).toBe(204);
  const activity = await rpc<string>(lead, 'add_test_activity', {
    p_cycle_id: cycleId, p_activity_type: 'system', p_title: `UAT-活动-${input.title}`,
    p_owner_id: input.main.developerId, p_planned_start: input.start, p_planned_end: input.end,
    p_planned_hours: input.plannedHours, p_preconditions: 'UAT', p_expected_deliverable: 'UAT 结果',
    p_participants: input.activityParticipants ?? [],
  });
  expect(activity.status).toBe(200);
  const task = await input.main.rest.request<Array<{ id: string }>>(
    input.main.page,
    `tasks?select=id&test_activity_id=eq.${activity.data}`,
  );
  expect(task.data?.[0]?.id).toBeTruthy();
  if (input.autoStart !== false) {
    expect((await rpc(input.main, 'transition_test_cycle', {
      p_cycle_id: cycleId, p_action: 'start', p_reason: null,
    })).status).toBe(204);
  }
  return { planId, cycleId: cycleId!, activityId: activity.data!, taskId: task.data![0].id, title: input.title };
}

async function expectActivityAndTaskStatus(
  actor: HardeningSession,
  fixture: PlanFixture,
  activityStatus: 'todo' | 'in_progress' | 'paused' | 'cancelled',
  taskStatus: 'todo' | 'in_progress' | 'paused',
) {
  const activity = await actor.rest.request<Array<{ status: string }>>(
    actor.page,
    `test_activities?select=status&id=eq.${fixture.activityId}`,
  );
  const task = await actor.rest.request<Array<{ status: string }>>(
    actor.page,
    `tasks?select=status&id=eq.${fixture.taskId}`,
  );
  expect(activity.status).toBe(200);
  expect(task.status).toBe(200);
  expect(activity.data?.[0]?.status).toBe(activityStatus);
  expect(task.data?.[0]?.status).toBe(taskStatus);
}

async function recordHours(actor: HardeningSession, taskId: string, date: string, hours: number, note: string) {
  const result = await rpc<string>(actor, 'record_test_work_hours', {
    p_task_id: taskId, p_work_date: date, p_hours: hours, p_note: note,
  });
  expect(result.status).toBe(200);
  expect(result.data).toBeTruthy();
  return result.data!;
}

async function expectPlanHours(actor: HardeningSession, fixture: PlanFixture, planned: number, actual: number) {
  const detail = await rpc<{
    planned_hours: number; actual_hours: number;
    cycles: Array<{ id: string; planned_hours: number; actual_hours: number; activities: Array<{ id: string; actual_hours: number }> }>;
  }>(actor, 'get_test_plan_detail', { p_plan_id: fixture.planId });
  expect(detail.status).toBe(200);
  expect(Number(detail.data?.planned_hours)).toBeCloseTo(planned, 5);
  expect(Number(detail.data?.actual_hours)).toBeCloseTo(actual, 5);
  const cycle = detail.data?.cycles.find(({ id }) => id === fixture.cycleId);
  expect(Number(cycle?.planned_hours)).toBeCloseTo(planned, 5);
  expect(Number(cycle?.actual_hours)).toBeCloseTo(actual, 5);
  expect(Number(cycle?.activities.find(({ id }) => id === fixture.activityId)?.actual_hours)).toBeCloseTo(actual, 5);
  const center = await rpc<{ items: Array<{ id: string; planned_hours: number; actual_hours: number }> }>(actor, 'get_testing_center', {
    p_source: null, p_status: null, p_page: 1, p_page_size: 100,
  });
  const item = center.data?.items.find(({ id }) => id === fixture.planId);
  expect(Number(item?.planned_hours)).toBeCloseTo(planned, 5);
  expect(Number(item?.actual_hours)).toBeCloseTo(actual, 5);
}

async function resource(actor: HardeningSession, from: string, to: string) {
  const result = await rpc<{
    rows: Array<{ developer_id: string; source: string; planned_hours: number; actual_hours: number }>;
    totals: { internal_project: number; external_request: number; construction: number; all_sources: number };
  }>(actor, 'get_test_resource_summary', { p_from: from, p_to: to });
  expect(result.status).toBe(200);
  return result.data!;
}
