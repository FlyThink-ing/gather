import { test, expect, type Browser } from '@playwright/test';
import { uatEnv, type AccountKey } from '../support/env';
import {
  addTeamMember,
  closeHardeningSessions,
  createProject,
  createTasks,
  createTeam,
  expectDenied,
  isoDate,
  listTasksBody,
  openHardeningSession,
  patchTask,
  requireDistinctAccounts,
  rpc,
  taskState,
  type HardeningSession,
} from '../support/hardening';

test.describe('权限与流程加固：项目、任务、范围和统计 @hardening @full', () => {
  test.setTimeout(240_000);

  test('AUTH-PROJ-01 项目业务编辑、治理与管理员审计五层一致', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'teamLead', 'otherTeamLead', 'crossGroupOwner', 'teamMember'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-proj-auth`;
      const start = isoDate();
      const end = isoDate(14);
      const ownerTeam = await createTeam(actors.admin, `UAT-权限项目组-${suffix}`, actors.teamLead.developerId);
      await createTeam(actors.admin, `UAT-权限异组-${suffix}`, actors.otherTeamLead.developerId);
      await addTeamMember(actors.admin, ownerTeam, actors.teamMember.developerId);
      const projectName = `UAT-AUTH-PROJ-01-${suffix}`;
      const projectId = await createProject(actors.admin, {
        name: projectName, teamId: ownerTeam, ownerId: actors.crossGroupOwner.developerId, start, end,
      });
      await createTasks(actors.admin, [{
        title: `UAT-AUTH-PROJ-可见任务-${suffix}`,
        projectId, developerId: actors.teamMember.developerId, teamId: ownerTeam, start, due: end,
      }]);

      await assertProjectUi(actors.crossGroupOwner, projectName, { visible: true, edit: true, govern: false });
      await assertProjectUi(actors.teamLead, projectName, { visible: true, edit: false, govern: true });
      await assertProjectUi(actors.teamMember, projectName, { visible: true, edit: false, govern: false });
      await assertProjectUi(actors.otherTeamLead, projectName, { visible: false, edit: false, govern: false });
      await assertProjectUi(actors.admin, projectName, { visible: true, edit: true, govern: true });

      const ownerDescription = `UAT owner business update ${suffix}`;
      const ownerUpdate = await rpc(actors.crossGroupOwner, 'update_project_business', {
        p_project_id: projectId, p_name: projectName, p_description: ownerDescription,
        p_start_date: start, p_end_date: end,
      });
      expect(ownerUpdate.status).toBe(200);
      await expectProjectDescription(actors.admin, projectId, ownerDescription);

      for (const actor of [actors.teamLead, actors.otherTeamLead, actors.teamMember]) {
        const denied = await rpc(actor, 'update_project_business', {
          p_project_id: projectId, p_name: projectName, p_description: `FORBIDDEN-${actor.key}`,
          p_start_date: start, p_end_date: end,
        });
        expect(denied.status, `${actor.key} 不得编辑项目业务字段`).toBeGreaterThanOrEqual(400);
        const direct = await actor.rest.request<unknown[]>(actor.page, `projects?id=eq.${projectId}`, {
          method: 'PATCH', body: { description: `FORBIDDEN-REST-${actor.key}` }, prefer: 'return=representation',
        });
        await expectDenied(direct);
        await expectProjectDescription(actors.admin, projectId, ownerDescription);
      }

      const foreignGovernance = await rpc(actors.otherTeamLead, 'change_project_governance', {
        p_project_id: projectId, p_team_id: ownerTeam, p_owner_id: actors.crossGroupOwner.developerId,
        p_reason: 'UAT 异组组长越权治理验证',
      });
      expect(foreignGovernance.status).toBeGreaterThanOrEqual(400);
      const leadGovernance = await rpc(actors.teamLead, 'change_project_governance', {
        p_project_id: projectId, p_team_id: ownerTeam, p_owner_id: actors.crossGroupOwner.developerId,
        p_reason: 'UAT 归属组长治理审计验证',
      });
      expect(leadGovernance.status).toBe(200);

      const adminNoReason = await rpc(actors.admin, 'admin_update_project_business', {
        p_project_id: projectId, p_name: projectName, p_description: 'FORBIDDEN-ADMIN-NO-REASON',
        p_start_date: start, p_end_date: end, p_reason: '',
      });
      expect(adminNoReason.status).toBeGreaterThanOrEqual(400);
      await expectProjectDescription(actors.admin, projectId, ownerDescription);

      const adminDescription = `UAT admin audited update ${suffix}`;
      const adminUpdate = await rpc(actors.admin, 'admin_update_project_business', {
        p_project_id: projectId, p_name: projectName, p_description: adminDescription,
        p_start_date: start, p_end_date: end, p_reason: 'UAT 管理员异常处置原因',
      });
      expect(adminUpdate.status).toBe(200);
      await expectProjectDescription(actors.admin, projectId, adminDescription);
      const audits = await actors.admin.rest.request<Array<{ action: string; reason: string }>>(
        actors.admin.page,
        `project_admin_action_audits?select=action,reason&project_id=eq.${projectId}`,
      );
      expect(audits.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'structure_update', reason: 'UAT 归属组长治理审计验证' }),
        expect.objectContaining({ action: 'business_update', reason: 'UAT 管理员异常处置原因' }),
      ]));
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('AUTH-TASK-01 执行、管理、审批、删除矩阵跨 UI/RPC/RLS/落库一致', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'teamLead', 'otherTeamLead', 'crossGroupOwner', 'teamMember', 'outsider'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-task-auth`;
      const start = isoDate();
      const end = isoDate(10);
      const teamId = await createTeam(actors.admin, `UAT-任务权限组-${suffix}`, actors.teamLead.developerId);
      const otherTeamId = await createTeam(actors.admin, `UAT-任务权限异组-${suffix}`, actors.otherTeamLead.developerId);
      await addTeamMember(actors.admin, teamId, actors.teamMember.developerId);
      const projectId = await createProject(actors.admin, {
        name: `UAT-AUTH-TASK-01-${suffix}`, teamId, ownerId: actors.crossGroupOwner.developerId, start, end,
      });
      const invisibleProjectId = await createProject(actors.admin, {
        name: `UAT-AUTH-TASK-不可见项目-${suffix}`, teamId: otherTeamId,
        ownerId: actors.otherTeamLead.developerId, start, end,
      });
      const rows = await createTasks(actors.admin, [
        'todo', 'jump-done', 'jump-delayed', 'in-progress', 'paused', 'review-owner',
        'review-delayed', 'review-admin', 'admin-action', 'delete-guard',
      ].map((name) => ({
        title: `UAT-AUTH-TASK-${name}-${suffix}`, projectId,
        developerId: actors.teamMember.developerId, teamId,
        start: name === 'review-delayed' ? isoDate(-3) : start,
        due: name === 'review-delayed' ? isoDate(-2) : end,
      })));
      const byName = (needle: string) => rows.find((row) => row.title.includes(needle))!;

      const legalSelfTitle = `UAT-AUTH-TASK-LEGAL-SELF-${suffix}`;
      const legalSelf = await actors.teamMember.rest.request<Array<{ id: string; title: string }>>(
        actors.teamMember.page,
        'tasks',
        {
          method: 'POST',
          body: {
            title: legalSelfTitle, description: 'UAT 合法本人开发任务', project_id: projectId,
            developer_id: actors.teamMember.developerId, team_id: teamId, start_date: start, due_date: end,
            created_by: actors.teamMember.developerId, task_type: 'dev', work_source: 'development',
          },
          prefer: 'return=representation',
        },
      );
      expect(legalSelf.status, '普通用户应能合法创建本人 development/dev 任务').toBe(201);
      expect(legalSelf.data?.[0]?.title).toBe(legalSelfTitle);

      const forgedRows = [
        { marker: 'TEST-ACTIVITY', task_type: 'dev', work_source: 'test_activity' },
        { marker: 'CONSTRUCTION', task_type: 'dev', work_source: 'construction' },
        { marker: 'TASK-TYPE-TEST', task_type: 'test', work_source: 'development' },
      ];
      for (const forged of forgedRows) {
        const title = `UAT-AUTH-TASK-FORGED-${forged.marker}-${suffix}`;
        const result = await actors.teamMember.rest.request(actors.teamMember.page, 'tasks', {
          method: 'POST',
          body: {
            title, project_id: projectId, developer_id: actors.teamMember.developerId, team_id: teamId,
            start_date: start, due_date: end, created_by: actors.teamMember.developerId,
            task_type: forged.task_type, work_source: forged.work_source,
          },
          prefer: 'return=representation',
        });
        expect(result.status, `普通用户不得伪造 ${forged.marker} 任务`).toBeGreaterThanOrEqual(400);
        await expectNoTaskByTitle(actors.admin, title);
      }

      const invisibleTitle = `UAT-AUTH-TASK-INVISIBLE-PROJECT-${suffix}`;
      const invisibleAttach = await actors.teamMember.rest.request(actors.teamMember.page, 'tasks', {
        method: 'POST',
        body: {
          title: invisibleTitle, project_id: invisibleProjectId,
          developer_id: actors.teamMember.developerId, team_id: otherTeamId,
          start_date: start, due_date: end, created_by: actors.teamMember.developerId,
          task_type: 'dev', work_source: 'development',
        },
        prefer: 'return=representation',
      });
      expect(invisibleAttach.status, '普通用户不得用已知 UUID 把自建任务挂到不可见项目').toBeGreaterThanOrEqual(400);
      await expectNoTaskByTitle(actors.admin, invisibleTitle);

      await move(actors.teamMember, byName('in-progress').id, 'in_progress');
      await move(actors.teamMember, byName('paused').id, 'in_progress');
      await move(actors.teamMember, byName('paused').id, 'paused');
      for (const name of ['review-owner', 'review-admin']) {
        await move(actors.teamMember, byName(name).id, 'in_progress');
        await move(actors.teamMember, byName(name).id, 'review');
      }
      await move(actors.teamMember, byName('review-delayed').id, 'in_progress');
      const delayedSubmit = await patchTask(actors.teamMember, byName('review-delayed').id, {
        status: 'review', delay_note: 'UAT 终态锁定验证：超期任务提交审批。',
      });
      expect(delayedSubmit.data?.[0]?.status).toBe('review');

      await assertTaskUi(actors.teamMember, byName('todo').id, { visible: true, titles: ['开始', '编辑'], absent: ['本组改派/调整计划（需原因）'] });
      await assertTaskUi(actors.teamLead, byName('todo').id, { visible: true, titles: ['本组改派/调整计划（需原因）'], absent: ['开始', '编辑'] });
      await assertTaskUi(actors.crossGroupOwner, byName('review-owner').id, { visible: true, titles: ['审批通过（需确认详情）'], absent: ['编辑'] });
      await assertTaskUi(actors.otherTeamLead, byName('todo').id, { visible: false, titles: [], absent: ['开始', '编辑'] });
      await assertTaskUi(actors.outsider, byName('todo').id, { visible: false, titles: [], absent: ['开始', '编辑'] });
      await assertTaskUi(actors.admin, byName('admin-action').id, {
        visible: true, titles: ['管理员异常调整（需原因）', '管理员异常代执行（需原因）'], absent: ['开始', '编辑', '删除'],
      });

      for (const actor of [actors.teamLead, actors.otherTeamLead, actors.crossGroupOwner, actors.outsider, actors.admin]) {
        const before = await taskState(actors.admin, byName('in-progress').id);
        const denied = await patchTask(actor, byName('in-progress').id, { status: 'paused' });
        await expectDenied(denied);
        expect((await taskState(actors.admin, byName('in-progress').id)).status).toBe(before.status);
      }

      for (const [name, terminal] of [['jump-done', 'done'], ['jump-delayed', 'delayed_done']] as const) {
        const before = await taskRecord(actors.admin, byName(name).id);
        const illegalJump = await patchTask(actors.teamMember, byName(name).id, { status: terminal });
        expect(illegalJump.status, `assignee 不得从 todo 直接跳转到 ${terminal}`).toBeGreaterThanOrEqual(400);
        expect(await taskRecord(actors.admin, byName(name).id)).toEqual(before);
      }

      const manage = await rpc(actors.teamLead, 'lead_manage_task', {
        p_task_id: byName('todo').id, p_developer_id: actors.teamMember.developerId,
        p_start_date: start, p_due_date: end, p_priority: 'high', p_reason: 'UAT 本组调整计划审计',
      });
      expect(manage.status).toBe(200);
      for (const actor of [actors.otherTeamLead, actors.crossGroupOwner, actors.outsider]) {
        const denied = await rpc(actor, 'lead_manage_task', {
          p_task_id: byName('todo').id, p_developer_id: actors.teamMember.developerId,
          p_start_date: start, p_due_date: end, p_priority: 'urgent', p_reason: 'UAT 越权管理验证',
        });
        expect(denied.status).toBeGreaterThanOrEqual(400);
      }
      const lockedManage = await rpc(actors.teamLead, 'lead_manage_task', {
        p_task_id: byName('review-owner').id, p_developer_id: actors.teamMember.developerId,
        p_start_date: start, p_due_date: end, p_priority: 'high', p_reason: 'UAT review 锁定验证',
      });
      expect(lockedManage.status).toBeGreaterThanOrEqual(400);

      expect((await patchTask(actors.teamMember, byName('todo').id, { status: 'in_progress' })).data?.[0]?.status).toBe('in_progress');
      expect((await patchTask(actors.teamMember, byName('in-progress').id, { status: 'paused' })).data?.[0]?.status).toBe('paused');
      expect((await patchTask(actors.teamMember, byName('paused').id, { status: 'in_progress' })).data?.[0]?.status).toBe('in_progress');

      const wrongApproval = await patchTask(actors.teamLead, byName('review-owner').id, { status: 'done' });
      await expectDenied(wrongApproval);
      const reviewBefore = await taskRecord(actors.admin, byName('review-owner').id);
      const smuggledApproval = await patchTask(actors.crossGroupOwner, byName('review-owner').id, {
        status: 'done',
        title: `${reviewBefore.title}-FORBIDDEN`,
        priority: 'urgent',
        developer_id: actors.crossGroupOwner.developerId,
        team_id: null,
        project_id: null,
        start_date: isoDate(1),
        due_date: isoDate(2),
      });
      expect(smuggledApproval.status, '项目 owner 审批时夹带业务字段必须整体失败').toBeGreaterThanOrEqual(400);
      expect(await taskRecord(actors.admin, byName('review-owner').id)).toEqual(reviewBefore);
      const ownerApproval = await patchTask(actors.crossGroupOwner, byName('review-owner').id, { status: 'done' });
      expect(ownerApproval.data?.[0]?.status).toMatch(/^(done|delayed_done)$/);
      const doneBefore = await taskRecord(actors.admin, byName('review-owner').id);
      const doneRewrite = await patchTask(actors.teamMember, byName('review-owner').id, {
        status: doneBefore.status, title: `${doneBefore.title}-FORBIDDEN`,
      });
      expect(doneRewrite.status, 'done 同状态字段更新必须失败').toBeGreaterThanOrEqual(400);
      expect(await taskRecord(actors.admin, byName('review-owner').id)).toEqual(doneBefore);

      const delayedApproval = await patchTask(actors.crossGroupOwner, byName('review-delayed').id, { status: 'done' });
      expect(delayedApproval.data?.[0]?.status).toBe('delayed_done');
      const delayedBefore = await taskRecord(actors.admin, byName('review-delayed').id);
      const delayedRewrite = await patchTask(actors.teamMember, byName('review-delayed').id, {
        status: 'delayed_done', priority: 'urgent',
      });
      expect(delayedRewrite.status, 'delayed_done 同状态字段更新必须失败').toBeGreaterThanOrEqual(400);
      expect(await taskRecord(actors.admin, byName('review-delayed').id)).toEqual(delayedBefore);

      const adminNoReason = await rpc(actors.admin, 'admin_execute_task_action', {
        p_task_id: byName('admin-action').id, p_action: 'start', p_reason: '', p_delay_note: null,
      });
      expect(adminNoReason.status).toBeGreaterThanOrEqual(400);
      expect((await taskState(actors.admin, byName('admin-action').id)).status).toBe('todo');
      const adminAction = await rpc(actors.admin, 'admin_execute_task_action', {
        p_task_id: byName('admin-action').id, p_action: 'start', p_reason: 'UAT 管理员异常代执行原因', p_delay_note: null,
      });
      expect(adminAction.status).toBe(200);
      expect((await taskState(actors.admin, byName('admin-action').id)).status).toBe('in_progress');

      const proxyNoReason = await rpc(actors.admin, 'admin_proxy_task_review', {
        p_task_id: byName('review-admin').id, p_approve: true, p_reason: '', p_reject_note: null,
      });
      expect(proxyNoReason.status).toBeGreaterThanOrEqual(400);
      const proxyApproval = await rpc(actors.admin, 'admin_proxy_task_review', {
        p_task_id: byName('review-admin').id, p_approve: true,
        p_reason: 'UAT 管理员异常代办审批原因', p_reject_note: null,
      });
      expect(proxyApproval.status).toBe(204);

      for (const actor of [actors.teamMember, actors.teamLead, actors.otherTeamLead, actors.crossGroupOwner, actors.admin]) {
        const deletion = await actor.rest.request<unknown[]>(actor.page, `tasks?id=eq.${byName('delete-guard').id}`, {
          method: 'DELETE', prefer: 'return=representation',
        });
        await expectDenied(deletion);
        expect((await taskState(actors.admin, byName('delete-guard').id)).id).toBe(byName('delete-guard').id);
      }

      const audits = await actors.admin.rest.request<Array<{ action: string; reason: string }>>(
        actors.admin.page,
        `task_management_audits?select=action,reason&task_id=in.(${byName('todo').id},${byName('admin-action').id})`,
      );
      expect(audits.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'lead_manage', reason: 'UAT 本组调整计划审计' }),
        expect.objectContaining({ action: 'admin_execute', reason: 'UAT 管理员异常代执行原因' }),
      ]));
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('VIS-TASK-01 + SCOPE-EMPTY-01 scope、项目来源、focus 和 RPC 不得扩权', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'teamLead', 'emptyManager', 'teamMember', 'outsider'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const suffix = `${uatEnv.runId}-scope-empty`;
      const start = isoDate();
      const end = isoDate(5);
      const populatedTeam = await createTeam(actors.admin, `UAT-范围有成员组-${suffix}`, actors.teamLead.developerId);
      const emptyTeam = await createTeam(actors.admin, `UAT-范围空组-${suffix}`, actors.emptyManager.developerId);
      await addTeamMember(actors.admin, populatedTeam, actors.teamMember.developerId);
      const projectId = await createProject(actors.admin, {
        name: `UAT-VIS-TASK-01-${suffix}`, teamId: populatedTeam,
        ownerId: actors.teamLead.developerId, start, end,
      });
      const rows = await createTasks(actors.admin, [
        { title: `UAT-SCOPE-OWN-${suffix}`, developerId: actors.emptyManager.developerId, teamId: emptyTeam, start, due: end },
        { title: `UAT-SCOPE-FOREIGN-${suffix}`, projectId, developerId: actors.teamMember.developerId, teamId: populatedTeam, start, due: end },
        { title: `UAT-SCOPE-LEAD-OWN-${suffix}`, developerId: actors.teamLead.developerId, teamId: null, start, due: end },
        { title: `UAT-SCOPE-TEAM-ID-ONLY-${suffix}`, developerId: actors.outsider.developerId, teamId: populatedTeam, start, due: end },
      ]);
      const own = rows.find((row) => row.title.includes('SCOPE-OWN'))!;
      const foreign = rows.find((row) => row.title.includes('SCOPE-FOREIGN'))!;
      const leadOwn = rows.find((row) => row.title.includes('SCOPE-LEAD-OWN'))!;
      const teamIdOnly = rows.find((row) => row.title.includes('SCOPE-TEAM-ID-ONLY'))!;

      const teamScope = await rpc<{ items: Array<{ id: string }>; total: number }>(actors.teamLead, 'list_tasks', listTasksBody({
        p_scope: 'team', p_query: suffix,
      }));
      expect(teamScope.status).toBe(200);
      expect(teamScope.data?.items.map(({ id }) => id).sort()).toEqual([leadOwn.id, foreign.id].sort());
      expect(teamScope.data?.items.map(({ id }) => id)).not.toContain(teamIdOnly.id);

      for (const scope of ['mine', 'team', 'all']) {
        const result = await rpc<{ items: Array<{ id: string }>; total: number }>(actors.emptyManager, 'list_tasks', listTasksBody({
          p_scope: scope, p_query: suffix,
        }));
        expect(result.status).toBe(200);
        expect(result.data?.items.map(({ id }) => id)).toEqual([own.id]);
        expect(result.data?.total).toBe(1);
      }
      const focus = await rpc<{ items: Array<{ id: string }>; total: number }>(actors.emptyManager, 'list_tasks', listTasksBody({
        p_scope: 'all', p_focus_id: foreign.id,
      }));
      expect(focus.data).toMatchObject({ items: [], total: 0 });
      const direct = await actors.emptyManager.rest.request<unknown[]>(actors.emptyManager.page, `tasks?select=id&id=eq.${foreign.id}`);
      expect(direct.data).toEqual([]);

      for (const url of [
        `/#/tasks?scope=all&q=${encodeURIComponent(suffix)}`,
        `/#/tasks?scope=all&source=project&project=${projectId}`,
        `/#/tasks?scope=all&focus=${foreign.id}`,
      ]) {
        await actors.emptyManager.page.goto(url);
        await expect(actors.emptyManager.page.locator(`#task-row-${foreign.id}`)).toHaveCount(0);
      }
      await actors.emptyManager.page.goto(`/#/tasks?scope=all&focus=${own.id}`);
      await expect(actors.emptyManager.page.locator(`#task-row-${own.id}`)).toBeVisible();
    } finally {
      await closeHardeningSessions(sessions);
    }
  });

  test('COUNT-REVIEW-01 + NAV-METRIC-01 待我审批计数、ID 与键盘导航一致', async ({ browser }, testInfo) => {
    const keys: AccountKey[] = ['admin', 'teamLead', 'crossGroupOwner', 'teamMember'];
    requireDistinctAccounts(keys);
    const sessions: HardeningSession[] = [];
    const baseURL = String(testInfo.project.use.baseURL);
    try {
      const actors = await openActors(browser, baseURL, keys, sessions);
      const before = await rpc<number>(actors.crossGroupOwner, 'get_my_pending_approval_count');
      expect(before.status).toBe(200);
      expect(before.data, 'UAT_CROSS_GROUP_OWNER 必须是无历史待审批的专用账号，才能验证恰好 1 条').toBe(0);

      const suffix = `${uatEnv.runId}-review-count`;
      const start = isoDate();
      const end = isoDate(7);
      const teamId = await createTeam(actors.admin, `UAT-跨组审批-${suffix}`, actors.teamLead.developerId);
      await addTeamMember(actors.admin, teamId, actors.teamMember.developerId);
      const projectName = `UAT-COUNT-REVIEW-01-${suffix}`;
      const projectId = await createProject(actors.admin, {
        name: projectName, teamId, ownerId: actors.crossGroupOwner.developerId, start, end,
      });
      const [task] = await createTasks(actors.admin, [{
        title: `UAT-唯一待审批-${suffix}`, projectId, developerId: actors.teamMember.developerId, teamId, start, due: end,
      }]);
      await move(actors.teamMember, task.id, 'in_progress');
      await move(actors.teamMember, task.id, 'review');

      const pending = await rpc<number>(actors.crossGroupOwner, 'get_my_pending_approval_count');
      const dashboard = await rpc<{ pending_my_approval: number }>(actors.crossGroupOwner, 'get_dashboard_task_counts');
      const list = await rpc<{ items: Array<{ id: string }>; total: number }>(actors.crossGroupOwner, 'list_tasks', listTasksBody({
        p_scope: 'all', p_preset: 'pending_my_approval',
      }));
      expect(pending.data).toBe(1);
      expect(dashboard.data?.pending_my_approval).toBe(1);
      expect(list.data?.total).toBe(1);
      expect(list.data?.items.map(({ id }) => id)).toEqual([task.id]);

      const summaries = await rpc<Array<{ id: string; review_count: number }>>(actors.crossGroupOwner, 'get_project_summaries');
      expect(summaries.data?.find(({ id }) => id === projectId)?.review_count).toBe(1);

      await actors.crossGroupOwner.page.goto('/#/dashboard');
      const card = actors.crossGroupOwner.page.getByRole('button', { name: /待我审批/ });
      await expect(card).toContainText('1');
      await card.focus();
      await expect(card).toBeFocused();
      await card.press('Enter');
      await expect(actors.crossGroupOwner.page).toHaveURL(/#\/tasks\?scope=all&preset=pending_my_approval/);
      await expect(actors.crossGroupOwner.page.locator(`#task-row-${task.id}`)).toBeVisible();
      await expect(actors.crossGroupOwner.page.getByText(/共 1 条/)).toBeVisible();

      await actors.crossGroupOwner.page.goto('/#/projects');
      const article = actors.crossGroupOwner.page.locator('article').filter({ hasText: projectName });
      const projectMetric = article.getByRole('button', { name: /待审批\s*1/ });
      await projectMetric.focus();
      await expect(projectMetric).toBeFocused();
      await projectMetric.press('Enter');
      await expect(actors.crossGroupOwner.page.locator(`#task-row-${task.id}`)).toBeVisible();
      await expect(actors.crossGroupOwner.page.getByText(/共 1 条/)).toBeVisible();
    } finally {
      await closeHardeningSessions(sessions);
    }
  });
});

async function openActors<K extends AccountKey>(
  browser: Browser,
  baseURL: string,
  keys: K[],
  sessions: HardeningSession[],
) {
  const result = {} as Record<K, HardeningSession>;
  for (const key of keys) {
    const actor = await openHardeningSession(browser, baseURL, key);
    sessions.push(actor);
    result[key] = actor;
  }
  return result;
}

async function assertProjectUi(
  actor: HardeningSession,
  projectName: string,
  expected: { visible: boolean; edit: boolean; govern: boolean },
) {
  await actor.page.goto('/#/projects');
  const article = actor.page.locator('article').filter({ hasText: projectName });
  await expect(article).toHaveCount(expected.visible ? 1 : 0);
  if (!expected.visible) return;
  await expect(article.getByTitle('编辑')).toHaveCount(expected.edit ? 1 : 0);
  await expect(article.getByTitle('调整归属与负责人')).toHaveCount(expected.govern ? 1 : 0);
}

async function expectProjectDescription(admin: HardeningSession, projectId: string, description: string) {
  const result = await admin.rest.request<Array<{ description: string }>>(
    admin.page,
    `projects?select=description&id=eq.${projectId}`,
  );
  expect(result.data?.[0]?.description).toBe(description);
}

async function move(actor: HardeningSession, taskId: string, status: string) {
  const result = await patchTask(actor, taskId, { status });
  expect(result.status).toBe(200);
  expect(result.data?.[0]?.status).toBe(status);
}

async function assertTaskUi(
  actor: HardeningSession,
  taskId: string,
  expected: { visible: boolean; titles: string[]; absent: string[] },
) {
  await actor.page.goto(`/#/tasks?scope=all&focus=${taskId}`);
  const row = actor.page.locator(`#task-row-${taskId}`);
  await expect(row).toHaveCount(expected.visible ? 1 : 0);
  for (const title of expected.titles) await expect(row.getByTitle(title)).toBeVisible();
  for (const title of expected.absent) await expect(row.getByTitle(title)).toHaveCount(0);
}

type TaskRecord = {
  id: string;
  title: string;
  status: string;
  priority: string;
  developer_id: string | null;
  team_id: string | null;
  project_id: string | null;
  start_date: string | null;
  due_date: string | null;
};

async function taskRecord(admin: HardeningSession, taskId: string) {
  const result = await admin.rest.request<TaskRecord[]>(
    admin.page,
    `tasks?select=id,title,status,priority,developer_id,team_id,project_id,start_date,due_date&id=eq.${taskId}`,
  );
  expect(result.data).toHaveLength(1);
  return result.data![0];
}

async function expectNoTaskByTitle(admin: HardeningSession, title: string) {
  const result = await admin.rest.request<Array<{ id: string }>>(
    admin.page,
    `tasks?select=id&title=eq.${encodeURIComponent(title)}`,
  );
  expect(result.status).toBe(200);
  expect(result.data).toEqual([]);
}
