/**
 * 演示模式：未配置真实 Supabase 时启用。
 * 模拟 supabase-js 的常用查询链（from/select/insert/update/delete/eq/order/limit/maybeSingle）
 * 与 auth 接口，数据存 localStorage，刷新不丢。
 * 控制台执行 window.__resetDemo() 可重置演示数据。
 *
 * ⚠⚠ 同步纪律（保证演示环境与正式环境行为一致）⚠⚠
 * 本文件逐条镜像 supabase/migrations/ 的行为性逻辑，迁移 SQL 有任何
 * 「默认值 / 触发器 / 约束 / 通知」修改，必须同步修改本文件对应位置。
 * 映射清单见 supabase/migrations/README.md。
 */

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

const STORE_KEY = 'gather-demo-store-v11';
const SESSION_KEY = 'gather-demo-session-v1';
export const DEMO_USER_ID = 'demo-user-0001';
const DEMO_DEV_ID = 'd0';

// 模拟各表的列默认值（对应 0001_init.sql 里的 DEFAULT 子句）
const TABLE_DEFAULTS: Record<string, Row> = {
  tasks: {
    description: null,
    status: 'todo',
    priority: 'medium',
    task_type: 'dev',
    linked_task_id: null,
    test_result: null,
    test_note: null,
    project_id: null,
    developer_id: null,
    team_id: null,
    start_date: null,
    due_date: null,
    submitted_at: null,
    completed_at: null,
    approved_by_role: null,
    approved_by_user: null,
    delay_note: null,
    reject_note: null,
    created_by: null,
    work_source: 'development',
    test_plan_id: null,
    test_cycle_id: null,
    test_activity_id: null,
    construction_work_id: null,
    construction_task_id: null,
  },
  projects: {
    description: null,
    status: 'active',
    start_date: null,
    end_date: null,
    actual_started_at: null,
    completed_at: null,
    created_by: null,
    requires_testing: true,
    test_state: 'not_requested',
    no_test_status: 'none',
    no_test_reason: null,
    no_test_related_url: null,
    no_test_decision_note: null,
  },
  notifications: { is_read: false },
  developers: { user_id: null, position: null, is_active: true },
  teams: { leader_id: null, is_test_team: false },
  task_comments: {},
  task_work_segments: { developer_id: null, ended_at: null, entry_source: 'automatic', note: null, created_by: null },
  test_rounds: {
    test_method: 'case_based',
    result: null,
    blocked: false,
    planned_case_count: null,
    executed_case_count: null,
    verification_scope: null,
    verification_reason: null,
    bug_count: 0,
    reopen_count: 0,
    note: null,
    zentao_url: null,
    started_at: null,
    concluded_by: null,
    concluded_at: null,
  },
  task_approval_audits: {},
  project_status_events: {},
  test_plans: {},
  test_cycles: {},
  test_cycle_scope_tasks: {},
  test_cycle_participants: {},
  test_activities: {},
  test_activity_participants: {},
  test_execution_batches: {},
  test_execution_batch_audits: {},
  test_reports: {},
  test_plan_events: {},
  project_no_test_events: {},
  test_cycle_repair_tasks: {},
  test_construction_works: {},
  test_construction_participants: {},
  test_construction_tasks: {},
  test_construction_events: {},
};

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;

const now = () => new Date().toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

function seed(): Store {
  const devs: Row[] = [
    { id: DEMO_DEV_ID, user_id: DEMO_USER_ID, name: '演示管理员', position: '后端开发工程师' },
    { id: 'd1', user_id: 'demo-user-d1', name: '赵振轩', position: '移动端开发工程师' },
    { id: 'd2', user_id: 'demo-user-d2', name: '徐镇', position: '后端开发工程师' },
    { id: 'd3', user_id: 'demo-user-d3', name: '李晓慧', position: '后端开发工程师' },
    { id: 'd4', user_id: null, name: '和令月', position: '后端开发工程师' },
    { id: 'd5', user_id: null, name: '李若愚', position: '后端开发工程师' },
    { id: 'd6', user_id: null, name: '杨帆', position: '后端开发工程师' },
    { id: 'd7', user_id: null, name: '胡占舟', position: '移动端开发工程师' },
    { id: 'd8', user_id: null, name: '李仕龙', position: '移动端开发工程师' },
    { id: 'd9', user_id: null, name: '杨振可', position: '移动端开发工程师' },
    { id: 'd10', user_id: null, name: '王倩', position: '测试工程师' },
    { id: 'd11', user_id: null, name: '刘洋', position: '测试工程师' },
    { id: 'd12', user_id: null, name: '周敏', position: '自动化测试工程师' },
  ].map((d) => ({ ...d, is_active: true, created_at: now(), updated_at: now() }));

  const teams: Row[] = [
    { id: 't1', name: '移动端组', leader_id: 'd1', is_test_team: false, created_at: now(), updated_at: now() },
    { id: 't2', name: 'EHC 组', leader_id: 'd2', is_test_team: false, created_at: now(), updated_at: now() },
    { id: 't3', name: '质量保障组', leader_id: 'd10', is_test_team: true, created_at: now(), updated_at: now() },
  ];

  const developer_teams: Row[] = [
    ['d1', 't1'], ['d7', 't1'], ['d8', 't1'], ['d9', 't1'],
    ['d2', 't2'], ['d3', 't2'], ['d4', 't2'], ['d5', 't2'], ['d6', 't2'],
    [DEMO_DEV_ID, 't2'],
    ['d10', 't1'], ['d10', 't2'], ['d11', 't2'],
    ['d10', 't3'], ['d11', 't3'], ['d12', 't3'],
  ].map(([developer_id, team_id]) => ({ id: uuid(), developer_id, team_id, created_at: now() }));

  const projects: Row[] = [
    // owner_id 是唯一审批来源；p2 由演示账号负责，便于验证正常审批路径。
    { id: 'p1', name: 'HMES-APP', description: '生产制造移动端', status: 'active', start_date: day(-30), end_date: day(40), team_id: 't1', owner_id: 'd1' },
    { id: 'p2', name: 'EHC5.0业务开发', description: 'EHC 5.0 核心业务（跨组）', status: 'active', start_date: day(-20), end_date: day(50), team_id: 't2', owner_id: DEMO_DEV_ID },
    { id: 'p3', name: 'EHC-APP', description: 'EHC 移动应用', status: 'active', start_date: day(-15), end_date: day(30), team_id: 't1', owner_id: 'd8' },
    { id: 'p4', name: '立库系统对接', description: '立体仓库接口对接', status: 'active', start_date: day(-25), end_date: day(20), team_id: 't2', owner_id: 'd2' },
  ].map((p) => ({
    ...p, requires_testing: true, test_state: p.id === 'p2' ? 'testing' : 'not_requested',
    no_test_status: 'none', no_test_reason: null, no_test_related_url: null, no_test_decision_note: null,
    created_by: DEMO_DEV_ID, created_at: now(), updated_at: now(),
  }));

  const T = (t: Partial<Row>): Row => ({
    id: uuid(),
    description: null,
    status: 'todo',
    priority: 'medium',
    task_type: 'dev',
    linked_task_id: null,
    test_result: null,
    test_note: null,
    project_id: null,
    developer_id: null,
    team_id: null,
    start_date: null,
    due_date: null,
    submitted_at: null,
    completed_at: null,
    approved_by_role: null,
    approved_by_user: null,
    delay_note: null,
    reject_note: null,
    created_by: DEMO_DEV_ID,
    work_source: 'development',
    test_plan_id: null,
    test_cycle_id: null,
    test_activity_id: null,
    construction_work_id: null,
    construction_task_id: null,
    created_at: now(),
    updated_at: now(),
    ...t,
  });

  const tasks: Row[] = [
    T({ title: '芜湖冠铭-生产入库单优化', status: 'in_progress', priority: 'medium', project_id: 'p1', developer_id: 'd1', team_id: 't1', start_date: day(-1), due_date: day(0) }),
    T({ title: '标准出货单插件开发', status: 'todo', priority: 'high', project_id: 'p4', developer_id: 'd4', team_id: 't2', start_date: day(1), due_date: day(4) }),
    // 测试场景①：开发完成提测，测试进行中
    T({ id: 'tk-anlight', title: '新架构梳理-安灯系统', status: 'testing', priority: 'high', project_id: 'p2', developer_id: 'd6', team_id: 't2', start_date: day(-3), due_date: day(1), submitted_at: `${day(-1)}T09:00:00.000Z` }),
    T({ id: 'tk-anlight-test', title: '【测试】新架构梳理-安灯系统', task_type: 'test', linked_task_id: 'tk-anlight', status: 'in_progress', priority: 'high', project_id: 'p2', developer_id: 'd10', team_id: 't2', start_date: day(-1), due_date: day(2), description: '重点验证安灯上报链路与异常恢复' }),
    T({ title: '天海统建-盘点功能优化', status: 'review', priority: 'medium', project_id: 'p1', developer_id: 'd1', team_id: 't1', start_date: day(-1), due_date: day(0), submitted_at: `${day(0)}T02:00:00.000Z` }),
    T({ title: '结合EHC5.0代码学习java项目基础开发', status: 'in_progress', priority: 'low', project_id: 'p2', developer_id: 'd5', team_id: 't2', start_date: day(-5), due_date: day(1) }),
    T({ title: '混合开发框架封装多功能表格组件', status: 'done', priority: 'high', project_id: 'p3', developer_id: 'd7', team_id: 't1', start_date: day(-4), due_date: day(-4), submitted_at: `${day(-4)}T10:00:00.000Z`, completed_at: `${day(-4)}T10:00:00.000Z`, approved_by_role: 'manager', approved_by_user: 'd1' }),
    // 测试场景②：上一轮测试不通过被打回，开发修复中（轮次留痕）
    T({ id: 'tk-ai', title: 'EHC-APP接入AI问答页面初版', status: 'in_progress', priority: 'urgent', project_id: 'p3', developer_id: 'd8', team_id: 't1', start_date: day(-5), due_date: day(-1), reject_note: 'AI 回答加载时偶发白屏，弱网下必现' }),
    T({ id: 'tk-ai-test1', title: '【测试】EHC-APP接入AI问答页面初版', task_type: 'test', linked_task_id: 'tk-ai', status: 'done', priority: 'urgent', project_id: 'p3', developer_id: 'd11', team_id: 't1', start_date: day(-3), due_date: day(-1), test_result: 'fail', test_note: 'AI 回答加载时偶发白屏，弱网下必现', submitted_at: `${day(-1)}T08:00:00.000Z`, completed_at: `${day(-1)}T08:00:00.000Z` }),
    T({ title: '鸿蒙遗留问题解决', status: 'in_progress', priority: 'medium', project_id: 'p1', developer_id: 'd1', team_id: 't1', start_date: day(-6), due_date: day(8) }),
    T({ title: '鸿蒙遗留问题修复-构建配置', status: 'in_progress', priority: 'medium', project_id: 'p1', developer_id: 'd9', team_id: 't1', start_date: day(-6), due_date: day(3) }),
    // 插队场景演示：立库任务干了几天 → 被客户紧急缺陷打断（挂起，计划顺延）→ 紧急任务进行中
    T({ id: 'tk-liku', title: '立库系统EHC对接', status: 'paused', priority: 'high', project_id: 'p4', developer_id: 'd2', team_id: 't2', start_date: day(-14), due_date: day(4) }),
    T({ id: 'tk-urgent', title: '客户现场紧急缺陷修复', status: 'in_progress', priority: 'urgent', project_id: 'p4', developer_id: 'd2', team_id: 't2', start_date: day(-2), due_date: day(1) }),
    T({ title: '报价管理功能梳理', status: 'review', priority: 'medium', project_id: 'p2', developer_id: 'd3', team_id: 't2', start_date: day(-16), due_date: day(1), submitted_at: `${day(0)}T01:00:00.000Z` }),
    T({ title: '生产领料单插件开发', status: 'done', priority: 'medium', project_id: 'p4', developer_id: 'd4', team_id: 't2', start_date: day(-2), due_date: day(2), submitted_at: `${day(-1)}T09:00:00.000Z`, completed_at: `${day(-1)}T09:00:00.000Z`, approved_by_role: 'manager', approved_by_user: 'd2' }),
    T({ title: '开发 OA-研发项目管理(5个)', status: 'in_progress', priority: 'high', project_id: 'p2', developer_id: DEMO_DEV_ID, team_id: 't2', start_date: day(-3), due_date: day(12) }),
    T({ title: '性能优化专项-列表卡顿排查', status: 'delayed_done', priority: 'high', project_id: 'p3', developer_id: 'd8', team_id: 't1', start_date: day(-12), due_date: day(-6), submitted_at: `${day(-3)}T15:00:00.000Z`, completed_at: `${day(-3)}T15:00:00.000Z`, approved_by_role: 'admin', approved_by_user: DEMO_DEV_ID, delay_note: '依赖的三方 SDK 升级延迟' }),
    T({ title: '旧版数据迁移脚本', status: 'todo', priority: 'low', project_id: 'p2', developer_id: null, team_id: 't2', start_date: day(2), due_date: day(9) }),
    T({ id: 'tk-approved-demo', title: 'R2 登录权限模块', status: 'done', priority: 'high', project_id: 'p2', developer_id: 'd3', team_id: 't2', start_date: day(-10), due_date: day(-4), submitted_at: `${day(-4)}T08:00:00.000Z`, completed_at: `${day(-4)}T08:00:00.000Z`, approved_by_role: 'admin', approved_by_user: DEMO_DEV_ID }),
    T({ id: 'tk-test-activity-demo', title: '[测试活动] EHC5.0 核心流程回归', task_type: 'test', work_source: 'test_activity', status: 'in_progress', priority: 'high', project_id: 'p2', developer_id: 'd11', team_id: 't3', start_date: day(-1), due_date: day(4), test_plan_id: 'tp-demo', test_cycle_id: 'tc-demo', test_activity_id: 'ta-demo' }),
    T({ id: 'tk-external-activity-demo', title: '[测试活动] 仓储 PDA 兼容性验证', task_type: 'test', work_source: 'test_activity', status: 'done', priority: 'medium', project_id: null, developer_id: 'd10', team_id: 't3', start_date: day(-8), due_date: day(-6), submitted_at: `${day(-6)}T10:00:00.000Z`, completed_at: `${day(-6)}T10:00:00.000Z`, test_plan_id: 'tp-ext-demo', test_cycle_id: 'tc-ext-demo', test_activity_id: 'ta-ext-demo' }),
    T({ id: 'tk-construction-demo', title: '[测试建设] 登录链路自动化脚本', task_type: 'test', work_source: 'construction', status: 'in_progress', priority: 'medium', project_id: null, developer_id: 'd12', team_id: null, start_date: day(-4), due_date: day(8), construction_work_id: 'cw-demo', construction_task_id: 'ct-demo' }),
  ];

  // 实际工时段：插队场景两段闭合（干-停-干-被打断）+ 紧急任务开段；
  // 其余进行中任务在下方统一补开段（正式环境由触发器保证 in_progress 必有开段）
  const task_work_segments: Row[] = [
    { id: uuid(), task_id: 'tk-liku', developer_id: 'd2', started_at: `${day(-14)}T01:00:00.000Z`, ended_at: `${day(-10)}T10:00:00.000Z` },
    { id: uuid(), task_id: 'tk-liku', developer_id: 'd2', started_at: `${day(-6)}T01:00:00.000Z`, ended_at: `${day(-2)}T01:00:00.000Z` },
    { id: uuid(), task_id: 'tk-urgent', developer_id: 'd2', started_at: `${day(-2)}T01:30:00.000Z`, ended_at: null },
    // 测试场景：提测方的开发段（已闭合）+ 上一轮 fail 测试的工时段
    { id: uuid(), task_id: 'tk-anlight', developer_id: 'd6', started_at: `${day(-3)}T01:00:00.000Z`, ended_at: `${day(-1)}T09:00:00.000Z` },
    { id: uuid(), task_id: 'tk-ai-test1', developer_id: 'd11', started_at: `${day(-3)}T02:00:00.000Z`, ended_at: `${day(-1)}T08:00:00.000Z` },
    { id: uuid(), task_id: 'tk-test-activity-demo', developer_id: 'd11', started_at: `${day(-1)}T01:00:00.000Z`, ended_at: `${day(-1)}T05:00:00.000Z`, entry_source: 'manual', note: '核心流程回归第一批次', created_by: 'd11' },
    { id: uuid(), task_id: 'tk-construction-demo', developer_id: 'd12', started_at: `${day(-2)}T01:00:00.000Z`, ended_at: `${day(-2)}T07:00:00.000Z`, entry_source: 'manual', note: '登录自动化脚本开发', created_by: 'd12' },
    { id: uuid(), task_id: 'tk-external-activity-demo', developer_id: 'd10', started_at: `${day(-7)}T01:00:00.000Z`, ended_at: `${day(-7)}T04:00:00.000Z`, entry_source: 'manual', note: '外部项目兼容性验证', created_by: 'd10' },
  ];
  for (const task of tasks) {
    if (task.task_type === 'test' && task.work_source === 'development') task.work_source = 'legacy_single_test';
  }
  for (const t of tasks) {
    if (t.status === 'in_progress' && t.work_source === 'development' && !task_work_segments.some((s) => s.task_id === t.id)) {
      task_work_segments.push({
        id: uuid(), task_id: t.id, developer_id: t.developer_id,
        started_at: `${t.start_date ?? day(0)}T01:00:00.000Z`, ended_at: null,
      });
    }
  }

  // 项目实际启动时间只取真实工时段，不使用计划日期或更新时间伪造。
  for (const project of projects) {
    const taskIds = new Set(tasks.filter((t) => t.project_id === project.id).map((t) => t.id));
    const starts = task_work_segments.filter((segment) => taskIds.has(segment.task_id)).map((segment) => segment.started_at).sort();
    project.actual_started_at = starts[0] ?? null;
    project.completed_at = null;
  }

  const test_rounds: Row[] = [
    {
      id: 'tr-anlight', test_task_id: 'tk-anlight-test', round_no: 1,
      test_method: 'case_based',
      result: null, blocked: false, planned_case_count: 28, executed_case_count: null,
      verification_scope: null, verification_reason: null,
      bug_count: 0, reopen_count: 0, note: null,
      zentao_url: 'https://zentao.example.com/testtask-anlight',
      started_at: `${day(-1)}T01:00:00.000Z`, concluded_by: null, concluded_at: null,
    },
    {
      id: 'tr-ai-1', test_task_id: 'tk-ai-test1', round_no: 1,
      test_method: 'exploratory',
      result: 'fail', blocked: true, planned_case_count: null, executed_case_count: null,
      verification_scope: 'AI 问答加载、弱网恢复、返回前台后的主流程', verification_reason: '线上紧急问题，先覆盖主流程和高风险场景，未编写正式用例',
      bug_count: 4, reopen_count: 1, note: 'AI 回答加载时偶发白屏，弱网下必现',
      zentao_url: 'https://zentao.example.com/testtask-ai-1',
      started_at: `${day(-3)}T02:00:00.000Z`, concluded_by: 'd11', concluded_at: `${day(-1)}T08:00:00.000Z`,
    },
  ];

  const notifications: Row[] = [
    { id: uuid(), recipient_id: DEMO_DEV_ID, type: 'task_submitted', payload: { title: '报价管理功能梳理' }, is_read: false, created_at: now() },
    { id: uuid(), recipient_id: DEMO_DEV_ID, type: 'task_assigned', payload: { title: '开发 OA-研发项目管理(5个)' }, is_read: true, created_at: now() },
  ];

  const test_plans: Row[] = [{
    id: 'tp-demo', source: 'internal_project', title: 'EHC5.0 业务开发 R2 测试',
    project_id: 'p2', external_project_name: null, external_owner_name: null,
    version_name: 'R2', test_scope: '登录、报价、领料和核心审批流程',
    test_goal: '确认 R2 核心业务具备发布条件', deliverables: '结构化测试结论、系统测试报告状态',
    expected_start: day(-2), expected_end: day(5), environment_note: '测试环境 / build-20260724',
    priority: 'high', related_url: null, zentao_url: 'https://zentao.example.com/testplan/ehc-r2',
    test_team_id: 't3', recommended_owner_id: 'd11', status: 'in_progress',
    created_by: DEMO_DEV_ID, created_at: `${day(-3)}T01:00:00.000Z`, updated_at: now(),
  }, {
    id: 'tp-ext-demo', source: 'external_request', title: '仓储 PDA V3.2 外部兼容性测试',
    project_id: null, external_project_name: '华东仓储 PDA 升级', external_owner_name: '陈经理',
    version_name: 'V3.2', test_scope: '三类 PDA 设备的登录、扫码、入库和断网恢复',
    test_goal: '确认 V3.2 在约定设备型号可稳定使用', deliverables: '兼容性测试结论',
    expected_start: day(-9), expected_end: day(-6), environment_note: '客户提供三类设备',
    priority: 'medium', related_url: 'https://example.com/external-pda', zentao_url: null,
    test_team_id: 't3', recommended_owner_id: 'd10', status: 'passed',
    created_by: 'd10', created_at: `${day(-10)}T01:00:00.000Z`, updated_at: `${day(-6)}T10:00:00.000Z`,
  }];
  const test_cycles: Row[] = [{
    id: 'tc-demo', plan_id: 'tp-demo', cycle_no: 1, stage_version: 'R2',
    scope_note: 'R2 已审批功能', status: 'in_progress',
    planned_start: day(-2), planned_end: day(5), actual_started_at: `${day(-1)}T01:00:00.000Z`,
    actual_completed_at: null, main_tester_id: 'd11', submitted_by: DEMO_DEV_ID,
    submitted_at: `${day(-3)}T01:00:00.000Z`, schedule_decided_by: 'd10',
    schedule_decided_at: `${day(-2)}T01:00:00.000Z`, schedule_note: '按 R2 发布窗口执行',
    proposed_result: null, conclusion_scope: null, conclusion_completion: null,
    conclusion_new_issues: null, conclusion_legacy_issues: null, conclusion_blockers: null,
    conclusion_risks: null, release_recommendation: null, conclusion_return_reason: null,
    created_at: `${day(-3)}T01:00:00.000Z`, updated_at: now(),
  }, {
    id: 'tc-ext-demo', plan_id: 'tp-ext-demo', cycle_no: 1, stage_version: 'V3.2',
    scope_note: '三类 PDA 设备兼容性', status: 'passed', planned_start: day(-9), planned_end: day(-6),
    actual_started_at: `${day(-8)}T01:00:00.000Z`, actual_completed_at: `${day(-6)}T10:00:00.000Z`,
    main_tester_id: 'd10', submitted_by: 'd10', submitted_at: `${day(-10)}T01:00:00.000Z`,
    schedule_decided_by: 'd10', schedule_decided_at: `${day(-9)}T01:00:00.000Z`, schedule_note: null,
    proposed_result: 'pass', conclusion_scope: '三类 PDA 的约定主流程',
    conclusion_completion: '计划 18，执行 18，全部完成', conclusion_new_issues: '新增 1 个低优先级显示问题',
    conclusion_legacy_issues: '无', conclusion_blockers: '无', conclusion_risks: '客户后续新增设备型号需补测',
    release_recommendation: '可在约定设备范围发布', conclusion_return_reason: null,
    conclusion_submitted_by: 'd10', conclusion_submitted_at: `${day(-6)}T09:00:00.000Z`,
    conclusion_confirmed_by: 'd10', conclusion_confirmed_at: `${day(-6)}T10:00:00.000Z`,
    created_at: `${day(-10)}T01:00:00.000Z`, updated_at: `${day(-6)}T10:00:00.000Z`,
  }];
  const test_cycle_scope_tasks = tasks
    .filter((task) => task.project_id === 'p2' && task.task_type === 'dev' && ['done', 'delayed_done'].includes(task.status))
    .map((task) => ({
      id: uuid(), cycle_id: 'tc-demo', task_id: task.id, task_title_snapshot: task.title,
      task_status_snapshot: task.status, task_owner_snapshot: devs.find((item) => item.id === task.developer_id)?.name ?? null,
      approved_by_snapshot: '演示管理员', approved_at_snapshot: task.completed_at, created_at: `${day(-3)}T01:00:00.000Z`,
    }));
  const test_cycle_participants: Row[] = [
    { id: uuid(), cycle_id: 'tc-demo', developer_id: 'd11', participant_role: 'main', planned_hours: 24, created_at: now() },
    { id: uuid(), cycle_id: 'tc-demo', developer_id: 'd10', participant_role: 'participant', planned_hours: 8, created_at: now() },
    { id: uuid(), cycle_id: 'tc-ext-demo', developer_id: 'd10', participant_role: 'main', planned_hours: 8, created_at: now() },
  ];
  const test_activities: Row[] = [{
    id: 'ta-demo', cycle_id: 'tc-demo', activity_type: 'regression', title: 'EHC5.0 核心流程回归',
    owner_id: 'd11', planned_start: day(-1), planned_end: day(4), planned_hours: 24,
    preconditions: 'R2 构建部署完成', expected_deliverable: '执行批次与问题摘要',
    status: 'in_progress', task_id: 'tk-test-activity-demo', created_by: 'd10', created_at: day(-2), updated_at: now(),
  }, {
    id: 'ta-ext-demo', cycle_id: 'tc-ext-demo', activity_type: 'compatibility', title: '仓储 PDA 兼容性验证',
    owner_id: 'd10', planned_start: day(-8), planned_end: day(-6), planned_hours: 8,
    preconditions: '设备和 V3.2 构建可用', expected_deliverable: '执行批次与兼容性结论',
    status: 'done', task_id: 'tk-external-activity-demo', created_by: 'd10', created_at: day(-9), updated_at: day(-6),
  }];
  const test_execution_batches: Row[] = [{
    id: 'tb-demo', cycle_id: 'tc-demo', activity_id: 'ta-demo', executed_on: day(-1),
    executor_id: 'd11', environment_name: 'EHC 测试环境', build_version: 'R2-build-07',
    test_type: 'regression', planned_count: 36, executed_count: 30, passed_count: 26,
    failed_count: 2, blocked_count: 1, skipped_count: 1, bug_count: 3, reopen_count: 1,
    smoke_passed: true, issue_summary: '发现 3 个新增问题', blocker_summary: '报价提交偶发阻塞',
    risk_summary: '剩余 6 条将在下一批次执行', zentao_url: 'https://zentao.example.com/testtask/ehc-r2',
    created_by: 'd11', created_at: now(), updated_at: now(),
  }, {
    id: 'tb-ext-demo', cycle_id: 'tc-ext-demo', activity_id: 'ta-ext-demo', executed_on: day(-7),
    executor_id: 'd10', environment_name: '客户 PDA 设备', build_version: 'V3.2',
    test_type: 'compatibility', planned_count: 18, executed_count: 18, passed_count: 17,
    failed_count: 1, blocked_count: 0, skipped_count: 0, bug_count: 1, reopen_count: 0,
    smoke_passed: true, issue_summary: '一处低分辨率显示问题', blocker_summary: '无',
    risk_summary: '新增设备型号需另行验证', zentao_url: null,
    created_by: 'd10', created_at: day(-7), updated_at: day(-7),
  }];
  const test_reports: Row[] = [{
    id: 'report-demo', cycle_id: 'tc-demo', report_type: 'system', report_name: '系统测试报告',
    is_required: true, status: 'pending', not_issued_reason: null, updated_by: null, updated_at: now(),
  }, {
    id: 'report-ext-demo', cycle_id: 'tc-ext-demo', report_type: 'compatibility', report_name: '兼容性测试报告',
    is_required: true, status: 'not_issued', not_issued_reason: '客户仅要求系统内结构化结论，不要求单独报告',
    updated_by: 'd10', updated_at: day(-6),
  }];
  const test_plan_events: Row[] = [
    { id: uuid(), plan_id: 'tp-demo', cycle_id: 'tc-demo', event_type: 'requested', actor_id: DEMO_DEV_ID, reason: null, payload: {}, created_at: day(-3) },
    { id: uuid(), plan_id: 'tp-demo', cycle_id: 'tc-demo', event_type: 'schedule_accepted', actor_id: 'd10', reason: null, payload: {}, created_at: day(-2) },
    { id: uuid(), plan_id: 'tp-demo', cycle_id: 'tc-demo', event_type: 'cycle_start', actor_id: 'd11', reason: null, payload: {}, created_at: day(-1) },
    { id: uuid(), plan_id: 'tp-ext-demo', cycle_id: 'tc-ext-demo', event_type: 'conclusion_confirmed', actor_id: 'd10', reason: null, payload: { result: 'pass' }, created_at: day(-6) },
  ];
  const test_construction_works: Row[] = [{
    id: 'cw-demo', title: '核心链路自动化回归建设', work_type: 'automation_script',
    goal: '覆盖登录、权限与订单主链路的稳定回归', priority: 'medium', owner_id: 'd12',
    planned_start: day(-7), planned_end: day(15), deliverables: '可复用脚本、流水线执行入口和维护说明',
    acceptance_criteria: '主链路脚本稳定执行 3 次且失败有明确诊断信息',
    resource_links: 'https://git.example.com/qa/ehc-automation', risk_note: null, blocker_note: null,
    adjustment_note: null, status: 'active', completion_note: null, created_by: 'd12',
    schedule_confirmed_by: 'd10', schedule_confirmed_at: day(-6), result_confirmed_by: null,
    result_confirmed_at: null, created_at: day(-7), updated_at: now(),
  }];
  const test_construction_participants: Row[] = [
    { id: uuid(), work_id: 'cw-demo', developer_id: 'd12', participant_role: 'owner', planned_hours: 32, created_at: now() },
    { id: uuid(), work_id: 'cw-demo', developer_id: 'd11', participant_role: 'participant', planned_hours: 8, created_at: now() },
  ];
  const test_construction_tasks: Row[] = [{
    id: 'ct-demo', work_id: 'cw-demo', title: '登录链路自动化脚本', owner_id: 'd12',
    planned_start: day(-4), planned_end: day(8), planned_hours: 16, progress: 45,
    status: 'in_progress', task_id: 'tk-construction-demo', created_by: 'd12', created_at: day(-4), updated_at: now(),
  }];
  const test_construction_events: Row[] = [
    { id: uuid(), work_id: 'cw-demo', event_type: 'created', actor_id: 'd12', reason: null, payload: {}, created_at: day(-7) },
    { id: uuid(), work_id: 'cw-demo', event_type: 'confirm_schedule', actor_id: 'd10', reason: null, payload: {}, created_at: day(-6) },
  ];

  return {
    profiles: [{ id: DEMO_USER_ID, created_at: now() }],
    user_roles: [
      { user_id: DEMO_USER_ID, role: 'admin', created_at: now(), updated_at: now() },
      { user_id: 'demo-user-d1', role: 'manager', created_at: now(), updated_at: now() },
      { user_id: 'demo-user-d2', role: 'manager', created_at: now(), updated_at: now() },
      { user_id: 'demo-user-d3', role: 'user', created_at: now(), updated_at: now() },
    ],
    developers: devs,
    teams,
    developer_teams,
    projects,
    tasks,
    task_comments: [],
    task_work_segments,
    test_rounds,
    test_plans,
    test_cycles,
    test_cycle_scope_tasks,
    test_cycle_participants,
    test_activities,
    test_activity_participants: [],
    test_execution_batches,
    test_execution_batch_audits: [],
    test_reports,
    test_plan_events,
    project_no_test_events: [],
    test_cycle_repair_tasks: [],
    test_construction_works,
    test_construction_participants,
    test_construction_tasks,
    test_construction_events,
    task_approval_audits: [],
    project_status_events: projects.map((project) => ({
      id: uuid(), project_id: project.id, event_type: 'created', from_status: null,
      to_status: project.status, actor_id: DEMO_DEV_ID, actor_name: '演示管理员', actor_role: 'admin',
      is_admin_force: false, reason: null, blocker_snapshot: {}, created_at: project.created_at,
    })),
    notifications,
  };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s: Store = JSON.parse(raw);
      // 原地修复历史坏数据：早期 insert 未套用列默认值，导致新建任务缺 status 等字段
      for (const [table, defaults] of Object.entries(TABLE_DEFAULTS)) {
        s[table] ??= [];
        for (const row of s[table] ?? []) {
          for (const [k, v] of Object.entries(defaults)) {
            if (row[k] === undefined) row[k] = v;
          }
        }
      }
      return s;
    }
  } catch { /* 损坏则重建 */ }
  const s = seed();
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
  return s;
}

export function createDemoClient() {
  const store = loadStore();
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(store));

  if (typeof window !== 'undefined') {
    (window as any).__resetDemo = () => {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    };
  }

  const notify = (recipient: string | null, type: string, payload: Row) => {
    if (!recipient) return;
    store.notifications.unshift({
      id: uuid(), recipient_id: recipient, type, payload, is_read: false, created_at: now(),
    });
  };

  let adminProxyReason: string | null = null;

  // 模拟数据库触发器（0003）：enforce_task_rules / track_work_segments / notify_task_update
  // ⚠ 同步纪律：0003_triggers_seed.sql 的任何行为性修改必须同步到这里（见 supabase/migrations/README.md）
  const applyTaskRules = (old: Row, patch: Row): { patch?: Row; error?: string } => {
    const p = { ...patch };
    const next = p.status ?? old.status;

    // 1) 离开 review：当前 projects.owner_id 是唯一普通审批来源。
    if (old.status === 'review' && next !== 'review') {
      const project = store.projects.find((x) => x.id === old.project_id);
      if (old.project_id && !project?.owner_id) return { error: '项目缺少负责人，请先在项目管理中补充负责人后再审批' };
      const owner = store.developers.find((x) => x.id === project?.owner_id);
      const isProjectOwner = project?.owner_id === DEMO_DEV_ID && owner?.is_active === true;
      const isAdminProxy = !!adminProxyReason;
      if (!isProjectOwner && !isAdminProxy) {
        return { error: '无审批权限：仅当前项目负责人可以审批；管理员请使用异常代办入口' };
      }
      if (next === 'done' || next === 'delayed_done') {
        // v2.3：完成时间 = 提交审核时间，延期判定也按提交时间
        const completedAt = old.submitted_at ?? now();
        const overdue = old.due_date && completedAt.slice(0, 10) > old.due_date;
        p.status = overdue ? 'delayed_done' : 'done';
        p.completed_at = completedAt;
        p.approved_by_role = 'admin';
        p.approved_by_user = DEMO_DEV_ID;
        p.reject_note = null;
        notify(old.developer_id, 'task_approved', { task_id: old.id, title: old.title, result: p.status });
      } else if (next === 'in_progress') {
        // 驳回：必须填写原因（镜像 enforce_task_rules）
        if (!p.reject_note || !String(p.reject_note).trim()) {
          return { error: '驳回任务必须填写驳回原因' };
        }
        p.completed_at = null;
        p.approved_by_role = null;
        p.approved_by_user = null;
        notify(old.developer_id, 'task_rejected', { task_id: old.id, title: old.title, reason: p.reject_note });
      } else {
        return { error: '审核中的任务只能审批完成或驳回到进行中' };
      }
      (store.task_approval_audits ??= []).push({
        id: uuid(), task_id: old.id, project_id: old.project_id,
        project_owner_id: project?.owner_id ?? null,
        project_owner_name: owner?.name ?? null,
        actor_id: DEMO_DEV_ID, actor_name: store.developers.find((x) => x.id === DEMO_DEV_ID)?.name ?? '演示管理员', actor_role: 'admin',
        decision: next === 'in_progress' ? 'rejected' : 'approved',
        from_status: 'review', to_status: p.status ?? next,
        is_admin_proxy: isAdminProxy,
        admin_proxy_reason: isAdminProxy ? adminProxyReason : null,
        decision_note: next === 'in_progress' ? p.reject_note : null,
        submitted_at_snapshot: old.submitted_at ?? null,
        completed_at_snapshot: p.completed_at ?? null,
        created_at: now(),
      });
    }

    // 2) 负责人完成：项目任务统一进入 review；无项目任务直接完成。
    if (old.task_type === 'dev' && old.status === 'in_progress' && ['review', 'done', 'delayed_done'].includes(next)) {
      const completedAt = now();
      const delayNote = p.delay_note ?? old.delay_note;
      const overdue = !!old.due_date && completedAt.slice(0, 10) > old.due_date;
      if (overdue && (!delayNote || !String(delayNote).trim())) return { error: '任务已超期，完成前需填写延期原因' };
      p.submitted_at = completedAt;
      if (old.project_id) {
        const project = store.projects.find((x) => x.id === old.project_id);
        if (!project?.owner_id) return { error: '项目缺少负责人，请先在项目管理中补充负责人后再提交审核' };
        p.status = 'review';
        p.completed_at = null;
        p.approved_by_role = null;
        p.approved_by_user = null;
        notify(project.owner_id, 'task_submitted', { task_id: old.id, title: old.title });
      } else {
        p.status = overdue ? 'delayed_done' : 'done';
        p.completed_at = completedAt;
        p.approved_by_role = null;
        p.approved_by_user = null;
        p.reject_note = null;
      }
    }

    // 3) 测试通过：项目开发任务进入 review；测试任务自身已直接完成。
    if (old.task_type === 'dev' && old.status === 'testing' && ['review', 'done', 'delayed_done'].includes(next)) {
      if (old.project_id) {
        const project = store.projects.find((x) => x.id === old.project_id);
        if (!project?.owner_id) return { error: '项目缺少负责人，请先补充负责人后再提交测试结论' };
        p.status = 'review';
        p.completed_at = null;
        p.approved_by_role = null;
        p.approved_by_user = null;
        notify(project.owner_id, 'task_submitted', { task_id: old.id, title: old.title });
      } else {
        const completedAt = old.submitted_at ?? now();
        const overdue = !!old.due_date && completedAt.slice(0, 10) > old.due_date;
        p.status = overdue ? 'delayed_done' : 'done';
        p.completed_at = completedAt;
        p.approved_by_role = null;
        p.approved_by_user = null;
        p.reject_note = null;
      }
    }

    if (old.status !== 'review' && next === 'review' && old.task_type === 'test') {
      return { error: '测试任务以"测试通过/不通过"结论结束，不走项目审批' };
    }

    // 2.5) 提测（v2.5，镜像）：submitted_at = 提测时刻；超期同样需延期备注
    if (old.status !== 'testing' && next === 'testing') {
      if (old.task_type === 'test') return { error: '测试任务不能再次提测' };
      if (old.status !== 'in_progress') return { error: '只有进行中的任务可以提测' };
      const delayNote = p.delay_note ?? old.delay_note;
      if (old.due_date && now().slice(0, 10) > old.due_date && (!delayNote || !String(delayNote).trim())) {
        return { error: '任务已超期，提测前需填写延期备注' };
      }
      p.submitted_at = now();
    }

    // testing 只能由测试结论流向 review/完成或打回。
    if (old.status === 'testing' && !['testing', 'review', 'done', 'delayed_done', 'in_progress'].includes(next)) {
      return { error: '测试中的任务需等待测试结论' };
    }

    // 3) review 期间锁定（镜像保留；演示账号恒为 admin，有审批权限，不会触发）

    // 4) 挂起流转约束（v2.4，镜像 enforce_task_rules）
    if (next === 'paused' && old.status !== 'paused' && old.status !== 'in_progress') {
      return { error: '只有进行中的任务可以挂起' };
    }
    if (old.status === 'paused' && next !== 'paused' && next !== 'in_progress') {
      return { error: '挂起的任务需先恢复为进行中' };
    }

    // 5) 实际工时段维护（v2.4，镜像 track_work_segments）
    const finalNext = p.status ?? old.status;
    if (old.work_source === 'development' && old.status !== 'in_progress' && finalNext === 'in_progress') {
      const startedAt = now();
      (store.task_work_segments ??= []).push({
        id: uuid(),
        task_id: old.id,
        developer_id: p.developer_id ?? old.developer_id ?? null,
        started_at: startedAt,
        ended_at: null,
      });
      const project = store.projects.find((item) => item.id === (p.project_id ?? old.project_id));
      if (project && (!project.actual_started_at || startedAt < project.actual_started_at)) {
        project.actual_started_at = startedAt;
      }
    }
    if (old.work_source === 'development' && old.status === 'in_progress' && finalNext !== 'in_progress') {
      for (const seg of store.task_work_segments ?? []) {
        if (seg.task_id === old.id && !seg.ended_at) seg.ended_at = now();
      }
    }

    return { patch: p };
  };

  class Query implements PromiseLike<{ data: any; error: any }> {
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: Row | null = null;
    private filters: { col: string; val: any }[] = [];
    private orderBy: { col: string; asc: boolean } | null = null;
    private limitN: number | null = null;
    private single = false;

    constructor(private table: string) {}

    select(_cols?: string) { return this; }
    insert(p: Row) { this.op = 'insert'; this.payload = p; return this; }
    update(p: Row) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col: string, val: any) { this.filters.push({ col, val }); return this; }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orderBy = { col, asc: opts?.ascending !== false };
      return this;
    }
    limit(n: number) { this.limitN = n; return this; }
    maybeSingle() { this.single = true; return this; }

    private exec(): { data: any; error: any } {
      const rows = store[this.table] ?? (store[this.table] = []);
      const matched = () => rows.filter((r) => this.filters.every((f) => r[f.col] === f.val));

      if (this.op === 'select') {
        let out = matched().slice();
        if (this.orderBy) {
          const { col, asc } = this.orderBy;
          out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
        }
        if (this.limitN != null) out = out.slice(0, this.limitN);
        return { data: this.single ? (out[0] ?? null) : out, error: null };
      }
      if (this.op === 'insert') {
        // 模拟数据库列默认值（真实库由 DEFAULT 子句处理）
        const defaults: Row = TABLE_DEFAULTS[this.table] ?? {};
        const row: Row = { id: uuid(), created_at: now(), updated_at: now(), ...defaults, ...this.payload };
        rows.push(row);
        if (this.table === 'tasks' && row.developer_id && row.developer_id !== row.created_by) {
          notify(row.developer_id, 'task_assigned', { task_id: row.id, title: row.title });
        }
        if (this.table === 'projects') {
          (store.project_status_events ??= []).push({
            id: uuid(), project_id: row.id, event_type: 'created', from_status: null,
            to_status: row.status, actor_id: DEMO_DEV_ID, actor_name: '演示管理员', actor_role: 'admin',
            is_admin_force: false, reason: null, blocker_snapshot: {}, created_at: now(),
          });
        }
        save();
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        for (const r of matched()) {
          let patch: Row = this.payload!;
          if (this.table === 'tasks') {
            if (r.work_source === 'legacy_single_test') {
              return { data: null, error: { message: '历史单任务测试记录只读保留' } };
            }
            if (['test_activity', 'construction'].includes(r.work_source)) {
              return { data: null, error: { message: '测试活动和建设任务只能在测试中心更新' } };
            }
            const res = applyTaskRules(r, this.payload!);
            // 规则校验失败：与真实触发器 raise exception 等效，整个更新中止且不写入
            if (res.error) return { data: null, error: { message: res.error } };
            patch = res.patch!;
          }
          if (this.table === 'projects' && patch.status && patch.status !== r.status) {
            if (patch.status === 'completed') {
              return { data: null, error: { message: '完成项目必须使用项目完成操作，系统需要先检查未完成任务并记录审计' } };
            }
            const oldStatus = r.status;
            if (oldStatus === 'completed') patch = { ...patch, completed_at: null };
            (store.project_status_events ??= []).push({
              id: uuid(), project_id: r.id,
              event_type: oldStatus === 'completed' ? 'reopened' : 'status_changed',
              from_status: oldStatus, to_status: patch.status,
              actor_id: DEMO_DEV_ID, actor_name: '演示管理员', actor_role: 'admin',
              is_admin_force: false, reason: null, blocker_snapshot: {}, created_at: now(),
            });
          }
          Object.assign(r, patch, { updated_at: now() });
        }
        save();
        return { data: null, error: null };
      }
      // delete
      store[this.table] = rows.filter((r) => !this.filters.every((f) => r[f.col] === f.val));
      save();
      return { data: null, error: null };
    }

    then<R1, R2>(
      onfulfilled?: ((v: { data: any; error: any }) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((e: any) => R2 | PromiseLike<R2>) | null
    ) {
      return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
    }
  }

  // ---------- Auth ----------
  type Listener = (event: string, session: any) => void;
  const listeners: Listener[] = [];
  const makeSession = (email: string) => ({
    user: { id: DEMO_USER_ID, email },
    access_token: 'demo',
  });
  let session: any = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw);
  } catch { /* ignore */ }

  const setSession = (s: any, event: string) => {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
    listeners.forEach((l) => l(event, s));
  };

  const auth = {
    async getSession() { return { data: { session }, error: null }; },
    onAuthStateChange(cb: Listener) {
      listeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe() {
              const i = listeners.indexOf(cb);
              if (i >= 0) listeners.splice(i, 1);
            },
          },
        },
      };
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      setSession(makeSession(email), 'SIGNED_IN');
      return { data: { session }, error: null };
    },
    async signUp({ email }: { email: string; password: string; options?: any }) {
      setSession(makeSession(email), 'SIGNED_IN');
      return { data: { session }, error: null };
    },
    async signOut() {
      setSession(null, 'SIGNED_OUT');
      return { error: null };
    },
  };

  const channelStub = { on() { return this; }, subscribe() { return this; } };

  const inclusiveDays = (from: string | null, to: string | null) => {
    if (!from || !to || to.slice(0, 10) < from.slice(0, 10)) return null;
    return Math.round((new Date(to.slice(0, 10)).getTime() - new Date(from.slice(0, 10)).getTime()) / 86400000) + 1;
  };
  const segmentHours = (segment: Row) => Math.max(0, (new Date(segment.ended_at ?? now()).getTime() - new Date(segment.started_at).getTime()) / 3600000);
  const taskHours = (taskId: string) => (store.task_work_segments ?? [])
    .filter((segment) => segment.task_id === taskId)
    .reduce((sum, segment) => sum + segmentHours(segment), 0);
  const taskDayCount = (taskId: string) => {
    const days = new Set<string>();
    for (const segment of (store.task_work_segments ?? []).filter((item) => item.task_id === taskId)) {
      const end = (segment.ended_at ?? now()).slice(0, 10);
      const cursor = new Date(segment.started_at.slice(0, 10));
      for (let i = 0; i < 3660 && cursor.toISOString().slice(0, 10) <= end; i += 1) {
        days.add(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return days.size;
  };
  const oneDecimal = (value: number) => Math.round(value * 10) / 10;

  const projectSummary = (project: Row) => {
    const tasks = store.tasks.filter((task) => task.project_id === project.id);
    const taskIds = new Set(tasks.map((task) => task.id));
    const rounds = (store.test_rounds ?? []).filter((round) => taskIds.has(round.test_task_id));
    const devTasks = tasks.filter((task) => task.task_type === 'dev');
    const testTasks = tasks.filter((task) => task.task_type === 'test');
    const completed = (task: Row) => ['done', 'delayed_done'].includes(task.status);
    const actualHours = tasks.reduce((sum, task) => sum + taskHours(task.id), 0);
    const concludedRounds = rounds.filter((round) => !!round.result);
    const concludedTestTasks = testTasks.filter((task) => !!task.test_result);
    const coveredTestIds = new Set(concludedRounds.map((round) => round.test_task_id));
    const projectPlans = (store.test_plans ?? []).filter((plan) => plan.project_id === project.id);
    const planIds = new Set(projectPlans.map((plan) => plan.id));
    const projectCycles = (store.test_cycles ?? []).filter((cycle) => planIds.has(cycle.plan_id));
    const cycleIds = new Set(projectCycles.map((cycle) => cycle.id));
    const projectBatches = (store.test_execution_batches ?? []).filter((batch) => cycleIds.has(batch.cycle_id));
    const concludedCycles = projectCycles.filter((cycle) => ['passed', 'failed'].includes(cycle.status));
    const usesProjectCycles = projectPlans.length > 0;
    const actualCycle = project.actual_started_at && !(project.status === 'completed' && !project.completed_at)
      ? inclusiveDays(project.actual_started_at, project.completed_at ?? now())
      : null;
    return {
      ...project,
      plan_days: inclusiveDays(project.start_date, project.end_date),
      actual_cycle_days: actualCycle,
      actual_effort_hours: oneDecimal(actualHours),
      actual_effort_person_days: oneDecimal(actualHours / 8),
      dev_task_total: devTasks.length,
      dev_task_completed: devTasks.filter(completed).length,
      dev_completion_rate: devTasks.length ? oneDecimal(devTasks.filter(completed).length * 100 / devTasks.length) : null,
      test_task_total: testTasks.length,
      test_round_total: usesProjectCycles ? projectCycles.length : rounds.length,
      review_count: tasks.filter((task) => task.status === 'review').length,
      overdue_count: tasks.filter((task) => !completed(task) && task.due_date && task.due_date < day(0)).length,
      testing_active_count: tasks.filter((task) =>
        (task.task_type === 'dev' && task.status === 'testing') ||
        (task.task_type === 'test' && !completed(task) && !task.test_result)
      ).length,
      completed_task_count: tasks.filter(completed).length,
      delayed_done_count: tasks.filter((task) => task.status === 'delayed_done').length,
      unassigned_count: tasks.filter((task) => !task.developer_id).length,
      unfinished_dev_count: devTasks.filter((task) => !completed(task)).length,
      active_test_count: testTasks.filter((task) => !completed(task)).length,
      todo_count: tasks.filter((task) => task.status === 'todo').length,
      in_progress_count: tasks.filter((task) => task.status === 'in_progress').length,
      paused_count: tasks.filter((task) => task.status === 'paused').length,
      testing_status_count: tasks.filter((task) => task.status === 'testing').length,
      done_count: tasks.filter((task) => task.status === 'done').length,
      cumulative_bug_count: usesProjectCycles ? projectBatches.reduce((sum, batch) => sum + Number(batch.bug_count ?? 0), 0) : rounds.reduce((sum, round) => sum + Number(round.bug_count ?? 0), 0),
      reopen_count: usesProjectCycles ? projectBatches.reduce((sum, batch) => sum + Number(batch.reopen_count ?? 0), 0) : rounds.reduce((sum, round) => sum + Number(round.reopen_count ?? 0), 0),
      failed_round_count: usesProjectCycles ? projectCycles.filter((cycle) => cycle.status === 'failed').length : rounds.filter((round) => round.result === 'fail').length,
      blocked_round_count: usesProjectCycles ? projectCycles.filter((cycle) => projectBatches.some((batch) => batch.cycle_id === cycle.id && Number(batch.blocked_count ?? 0) > 0)).length : rounds.filter((round) => !!round.blocked).length,
      test_pass_rate: usesProjectCycles
        ? (concludedCycles.length ? oneDecimal(projectCycles.filter((cycle) => cycle.status === 'passed').length * 100 / concludedCycles.length) : null)
        : (concludedRounds.length ? oneDecimal(concludedRounds.filter((round) => round.result === 'pass').length * 100 / concludedRounds.length) : null),
      summary_covered_count: usesProjectCycles ? concludedCycles.length : coveredTestIds.size,
      summary_expected_count: usesProjectCycles ? projectCycles.length : concludedTestTasks.length,
      summary_coverage_rate: usesProjectCycles
        ? (projectCycles.length ? oneDecimal(concludedCycles.length * 100 / projectCycles.length) : null)
        : (concludedTestTasks.length ? oneDecimal(coveredTestIds.size * 100 / concludedTestTasks.length) : null),
    };
  };

  const projectCockpit = (project: Row) => {
    const summary = projectSummary(project);
    const projectTasks = store.tasks.filter((task) => task.project_id === project.id);
    const taskById = new Map(projectTasks.map((task) => [task.id, task]));
    const quality_rounds: Row[] = projectTasks
      .filter((task) => task.work_source === 'legacy_single_test')
      .map((testTask): Row => {
        const round = (store.test_rounds ?? []).find((item) => item.test_task_id === testTask.id) ?? null;
        const linkedTask = testTask.linked_task_id ? taskById.get(testTask.linked_task_id) : null;
        const tester = store.developers.find((item) => item.id === testTask.developer_id);
        return {
          id: round?.id ?? null,
          test_task_id: testTask.id,
          round_no: round?.round_no ?? null,
          test_method: round?.test_method ?? null,
          result: round?.result ?? null,
          blocked: round?.blocked ?? null,
          planned_case_count: round?.planned_case_count ?? null,
          executed_case_count: round?.executed_case_count ?? null,
          verification_scope: round?.verification_scope ?? null,
          verification_reason: round?.verification_reason ?? null,
          bug_count: round?.bug_count ?? null,
          reopen_count: round?.reopen_count ?? null,
          note: round?.note ?? null,
          zentao_url: round?.zentao_url ?? null,
          started_at: round?.started_at ?? null,
          concluded_by: round?.concluded_by ?? null,
          concluded_at: round?.concluded_at ?? null,
          summary_recorded: !!round,
          test_task_title: testTask.title,
          test_task_status: testTask.status,
          test_result: testTask.test_result,
          tester_id: testTask.developer_id,
          tester_name: tester?.name ?? null,
          linked_task_id: linkedTask?.id ?? null,
          linked_task_title: linkedTask?.title ?? null,
          created_at: testTask.created_at,
        };
      })
      .sort((a, b) => Number(b.summary_recorded) - Number(a.summary_recorded) || (Number(b.round_no) - Number(a.round_no)) || b.created_at.localeCompare(a.created_at));

    const peopleMap = new Map<string, Row>();
    for (const task of projectTasks) {
      const key = task.developer_id ?? 'unassigned';
      const person = store.developers.find((item) => item.id === task.developer_id);
      const current = peopleMap.get(key) ?? {
        developer_id: task.developer_id ?? null,
        person_name: person?.name ?? '未分配',
        position: person?.position ?? null,
        task_count: 0, dev_task_count: 0, test_task_count: 0, completed_task_count: 0,
        review_task_count: 0, overdue_task_count: 0,
        actual_effort_hours: 0, actual_effort_person_days: 0,
      };
      current.task_count += 1;
      current[task.task_type === 'test' ? 'test_task_count' : 'dev_task_count'] += 1;
      if (['done', 'delayed_done'].includes(task.status)) current.completed_task_count += 1;
      if (task.status === 'review') current.review_task_count += 1;
      if (!['done', 'delayed_done'].includes(task.status) && task.due_date && task.due_date < day(0)) current.overdue_task_count += 1;
      current.actual_effort_hours += taskHours(task.id);
      peopleMap.set(key, current);
    }
    const people: Row[] = [...peopleMap.values()].map((person): Row => ({
      ...person,
      actual_effort_hours: oneDecimal(person.actual_effort_hours),
      actual_effort_person_days: oneDecimal(person.actual_effort_hours / 8),
    })).sort((a, b) => b.actual_effort_hours - a.actual_effort_hours || a.person_name.localeCompare(b.person_name));

    const timeline: Row[] = [
      { event_type: 'project_created', occurred_at: project.created_at, title: '项目创建', detail: null, task_id: null },
    ];
    if (project.actual_started_at) timeline.push({ event_type: 'project_actual_started', occurred_at: project.actual_started_at, title: '项目实际启动', detail: '来源：首个真实工时段', task_id: null });
    for (const task of projectTasks) {
      const occurred = task.submitted_at ?? task.completed_at;
      if (occurred) timeline.push({
        event_type: task.task_type === 'test' ? 'test_concluded' : 'task_submitted',
        occurred_at: occurred,
        title: task.task_type === 'test' ? `测试结论：${task.title}` : `任务提交：${task.title}`,
        detail: task.task_type === 'test' ? task.test_result : task.status,
        task_id: task.id,
      });
    }
    for (const audit of (store.task_approval_audits ?? []).filter((item) => item.project_id === project.id)) {
      timeline.push({ event_type: 'task_approval', occurred_at: audit.created_at, title: audit.decision === 'approved' ? '审批通过' : '审批驳回', detail: `${audit.actor_name}${audit.is_admin_proxy ? '（管理员代办）' : ''}`, task_id: audit.task_id });
    }
    for (const event of (store.project_status_events ?? []).filter((item) => item.project_id === project.id && item.event_type !== 'created')) {
      timeline.push({ event_type: `project_${event.event_type}`, occurred_at: event.created_at, title: event.event_type === 'force_completed' ? '管理员强制完成' : event.event_type === 'completed' ? '项目完成' : event.event_type === 'reopened' ? '项目重新打开' : '项目状态变更', detail: event.reason ?? (event.from_status ? `${event.from_status} → ${event.to_status}` : null), task_id: null });
    }
    timeline.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return { ...summary, quality_rounds, people, timeline: timeline.slice(0, 100) };
  };

  // ---------- RPC 镜像（0003/0004 的测试流程）----------
  // 状态更新通过 Query 走 applyTaskRules，与真实端"RPC 内 update 触发触发器"一致
  const rpc = async (name: string, params: Record<string, any> = {}) => {
    const err = (message: string) => ({ data: null, error: { message } });

    const cycleDetail = (cycle: Row): Row => ({
      ...cycle,
      main_tester_name: store.developers.find((d) => d.id === cycle.main_tester_id)?.name ?? null,
      scope_tasks: (store.test_cycle_scope_tasks ?? []).filter((x) => x.cycle_id === cycle.id),
      participants: (store.test_cycle_participants ?? []).filter((x) => x.cycle_id === cycle.id).map((x) => ({
        ...x, name: store.developers.find((d) => d.id === x.developer_id)?.name ?? '未知人员',
      })),
      activities: (store.test_activities ?? []).filter((x) => x.cycle_id === cycle.id).map((x) => ({
        ...x,
        owner_name: store.developers.find((d) => d.id === x.owner_id)?.name ?? '未知人员',
        actual_hours: x.task_id ? oneDecimal(taskHours(x.task_id)) : 0,
      })),
      batches: (store.test_execution_batches ?? []).filter((x) => x.cycle_id === cycle.id).map((x): Row => ({
        ...x, executor_name: store.developers.find((d) => d.id === x.executor_id)?.name ?? '未知人员',
      })).sort((a, b) => b.executed_on.localeCompare(a.executed_on)),
      reports: (store.test_reports ?? []).filter((x) => x.cycle_id === cycle.id),
      repair_tasks: (store.test_cycle_repair_tasks ?? []).filter((x) => x.cycle_id === cycle.id).map((x) => {
        const repair = store.tasks.find((task) => task.id === x.repair_task_id);
        return { ...x, repair_task_title: repair?.title ?? '任务已删除', repair_task_status: repair?.status ?? null };
      }),
    });

    const testPlanSummary = (plan: Row): Row => {
      const project = store.projects.find((p) => p.id === plan.project_id);
      const team = store.teams.find((t) => t.id === plan.test_team_id);
      const cycles = (store.test_cycles ?? []).filter((c) => c.plan_id === plan.id).sort((a, b) => b.cycle_no - a.cycle_no);
      const cycle = cycles[0] ?? {};
      const batches = (store.test_execution_batches ?? []).filter((b) => b.cycle_id === cycle.id);
      const activities = (store.test_activities ?? []).filter((a) => a.cycle_id === cycle.id);
      const sum = (key: string) => batches.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      return {
        ...plan, project_name: project?.name ?? null, test_team_name: team?.name ?? null,
        recommended_owner_name: store.developers.find((d) => d.id === plan.recommended_owner_id)?.name ?? null,
        latest_cycle_id: cycle.id ?? null, cycle_no: cycle.cycle_no ?? 0,
        stage_version: cycle.stage_version ?? '', cycle_status: cycle.status ?? plan.status,
        main_tester_id: cycle.main_tester_id ?? null,
        main_tester_name: store.developers.find((d) => d.id === cycle.main_tester_id)?.name ?? null,
        planned_start: cycle.planned_start ?? null, planned_end: cycle.planned_end ?? null,
        planned_case_count: sum('planned_count'), executed_case_count: sum('executed_count'),
        passed_count: sum('passed_count'), failed_count: sum('failed_count'),
        blocked_count: sum('blocked_count'), bug_count: sum('bug_count'), reopen_count: sum('reopen_count'),
        actual_hours: oneDecimal(activities.reduce((total, item) => total + (item.task_id ? taskHours(item.task_id) : 0), 0)),
      };
    };

    const constructionSummary = (work: Row): Row => {
      const tasks = (store.test_construction_tasks ?? []).filter((item) => item.work_id === work.id);
      return {
        ...work,
        owner_name: store.developers.find((d) => d.id === work.owner_id)?.name ?? '未知人员',
        task_count: tasks.length, done_count: tasks.filter((item) => item.status === 'done').length,
        planned_hours: oneDecimal(tasks.reduce((sum, item) => sum + Number(item.planned_hours ?? 0), 0)),
        actual_hours: oneDecimal(tasks.reduce((sum, item) => sum + (item.task_id ? taskHours(item.task_id) : 0), 0)),
      };
    };

    if (name === 'get_eligible_internal_test_projects') {
      const search = String(params.p_search ?? '').trim().toLocaleLowerCase();
      const owned = store.projects.filter((project) => project.owner_id === DEMO_DEV_ID);
      const assessed = owned.map((project) => {
        const activeCycle = store.test_cycles.some((cycle) => {
          const plan = store.test_plans.find((item) => item.id === cycle.plan_id);
          return plan?.project_id === project.id && !['passed', 'failed', 'cancelled', 'returned'].includes(cycle.status);
        });
        const covered = new Set(store.test_cycle_scope_tasks.filter((scope) => {
          const coveredCycle = store.test_cycles.find((cycle) => cycle.id === scope.cycle_id);
          return coveredCycle?.status === 'passed';
        }).map((scope) => scope.task_id));
        const eligibleTaskCount = store.tasks.filter((task) =>
          task.project_id === project.id
          && task.task_type === 'dev'
          && ['done', 'delayed_done'].includes(task.status)
          && task.completed_at
          && task.approved_by_user
          && !covered.has(task.id)).length;
        return {
          project,
          activeCycle,
          eligibleTaskCount,
          eligible: project.status === 'active'
            && project.no_test_status !== 'approved'
            && !activeCycle
            && eligibleTaskCount > 0,
        };
      });
      const items = assessed
        .filter((item) => item.eligible && (!search || String(item.project.name).toLocaleLowerCase().includes(search)))
        .map(({ project, eligibleTaskCount }) => ({
          id: project.id,
          name: project.name,
          team_id: project.team_id,
          team_name: store.teams.find((team) => team.id === project.team_id)?.name ?? '未知小组',
          test_state: project.test_state,
          eligible_task_count: eligibleTaskCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      return {
        data: {
          items,
          owned_project_count: owned.length,
          inactive_count: assessed.filter((item) => item.project.status !== 'active').length,
          no_test_approved_count: assessed.filter((item) => item.project.no_test_status === 'approved').length,
          active_cycle_count: assessed.filter((item) => item.activeCycle).length,
          no_eligible_task_count: assessed.filter((item) => item.eligibleTaskCount === 0).length,
        },
        error: null,
      };
    }

    if (name === 'get_testing_center') {
      let items = (store.test_plans ?? []).map(testPlanSummary);
      if (params.p_source) items = items.filter((item) => item.source === params.p_source);
      if (params.p_status) items = items.filter((item) => item.cycle_status === params.p_status);
      items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const page = Math.max(1, Number(params.p_page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params.p_page_size) || 20));
      return { data: { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize }, error: null };
    }

    if (name === 'get_test_plan_detail') {
      const plan = (store.test_plans ?? []).find((item) => item.id === params.p_plan_id);
      if (!plan) return err('测试计划不存在');
      const detail = testPlanSummary(plan);
      return {
        data: {
          ...detail,
          created_by_name: store.developers.find((d) => d.id === plan.created_by)?.name ?? null,
          cycles: (store.test_cycles ?? []).filter((item) => item.plan_id === plan.id)
            .sort((a, b) => b.cycle_no - a.cycle_no).map(cycleDetail),
          events: (store.test_plan_events ?? []).filter((item) => item.plan_id === plan.id)
            .map((item): Row => ({ ...item, actor_name: store.developers.find((d) => d.id === item.actor_id)?.name ?? '系统' }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        },
        error: null,
      };
    }

    if (name === 'get_construction_works') {
      let items = (store.test_construction_works ?? []).map(constructionSummary);
      if (params.p_status) items = items.filter((item) => item.status === params.p_status);
      items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const page = Math.max(1, Number(params.p_page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params.p_page_size) || 20));
      return { data: { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize }, error: null };
    }

    if (name === 'get_construction_detail') {
      const work = (store.test_construction_works ?? []).find((item) => item.id === params.p_work_id);
      if (!work) return err('测试建设工作不存在');
      return {
        data: {
          ...constructionSummary(work),
          participants: (store.test_construction_participants ?? []).filter((x) => x.work_id === work.id).map((x) => ({
            ...x, name: store.developers.find((d) => d.id === x.developer_id)?.name ?? '未知人员',
          })),
          tasks: (store.test_construction_tasks ?? []).filter((x) => x.work_id === work.id).map((x) => ({
            ...x, owner_name: store.developers.find((d) => d.id === x.owner_id)?.name ?? '未知人员',
            actual_hours: x.task_id ? oneDecimal(taskHours(x.task_id)) : 0,
          })),
          events: (store.test_construction_events ?? []).filter((x) => x.work_id === work.id).map((x): Row => ({
            ...x, actor_name: store.developers.find((d) => d.id === x.actor_id)?.name ?? '系统',
          })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
        },
        error: null,
      };
    }

    if (name === 'get_test_resource_summary') {
      const rows = new Map<string, Row>();
      const assignments: Row[] = [];
      const add = (developerId: string, source: string, planned: number, actual: number) => {
        const key = `${developerId}:${source}`;
        const developerRow = store.developers.find((d) => d.id === developerId);
        const row = rows.get(key) ?? { developer_id: developerId, name: developerRow?.name ?? '未知人员', position: developerRow?.position ?? null, source, planned_hours: 0, actual_hours: 0 };
        row.planned_hours += planned;
        row.actual_hours += actual;
        rows.set(key, row);
      };
      for (const participant of store.test_cycle_participants ?? []) {
        const cycle = store.test_cycles.find((x) => x.id === participant.cycle_id);
        const plan = store.test_plans.find((x) => x.id === cycle?.plan_id);
        if (plan) {
          add(participant.developer_id, plan.source, Number(participant.planned_hours ?? 0), 0);
          if (cycle?.planned_start && cycle?.planned_end) assignments.push({ developer_id: participant.developer_id, id: `cycle:${cycle.id}`, start: cycle.planned_start, end: cycle.planned_end });
        }
      }
      for (const participant of store.test_construction_participants ?? []) {
        add(participant.developer_id, 'construction', Number(participant.planned_hours ?? 0), 0);
        const work = store.test_construction_works.find((x) => x.id === participant.work_id);
        if (work?.planned_start && work?.planned_end) assignments.push({ developer_id: participant.developer_id, id: `construction:${work.id}`, start: work.planned_start, end: work.planned_end });
      }
      for (const segment of store.task_work_segments ?? []) {
        if (!segment.ended_at) continue;
        const task = store.tasks.find((x) => x.id === segment.task_id);
        if (!task || !['test_activity', 'construction'].includes(task.work_source)) continue;
        const plan = store.test_plans.find((x) => x.id === task.test_plan_id);
        const source = task.work_source === 'construction' ? 'construction' : (plan?.source ?? 'internal_project');
        add(segment.developer_id, source, 0, segmentHours(segment));
      }
      const conflictCount = (developerId: string) => {
        const own = assignments.filter((item) => item.developer_id === developerId);
        let count = 0;
        for (let i = 0; i < own.length; i += 1) for (let j = i + 1; j < own.length; j += 1) {
          if (own[i].start <= own[j].end && own[j].start <= own[i].end) count += 1;
        }
        return count;
      };
      const resultRows: Row[] = [...rows.values()].map((row): Row => ({
        ...row, planned_hours: oneDecimal(row.planned_hours), actual_hours: oneDecimal(row.actual_hours),
        conflict_count: conflictCount(row.developer_id),
      }));
      const actualTotal = (source: string) => oneDecimal(resultRows.filter((row) => row.source === source).reduce((sum, row) => sum + row.actual_hours, 0));
      return { data: { rows: resultRows, totals: { internal_project: actualTotal('internal_project'), external_request: actualTotal('external_request'), construction: actualTotal('construction'), project_test_cost: actualTotal('internal_project') } }, error: null };
    }

    if (name === 'get_project_test_summary') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      if (!project) return err('项目不存在');
      const plan = (store.test_plans ?? []).filter((item) => item.project_id === project.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const cycles = plan ? (store.test_cycles ?? []).filter((item) => item.plan_id === plan.id) : [];
      const cycleIds = new Set(cycles.map((item) => item.id));
      const batches = (store.test_execution_batches ?? []).filter((item) => cycleIds.has(item.cycle_id));
      const activityTaskIds = new Set(store.tasks.filter((item) => item.test_plan_id === plan?.id && item.work_source === 'test_activity').map((item) => item.id));
      const sum = (key: string) => batches.reduce((total, item) => total + Number(item[key] ?? 0), 0);
      return {
        data: {
          requires_testing: project.requires_testing, test_state: project.test_state, no_test_status: project.no_test_status,
          no_test_reason: project.no_test_reason, no_test_related_url: project.no_test_related_url, no_test_decision_note: project.no_test_decision_note,
          plan_id: plan?.id ?? null, plan_title: plan?.title ?? null, cycle_count: cycles.length,
          passed_cycle_count: cycles.filter((item) => item.status === 'passed').length,
          failed_cycle_count: cycles.filter((item) => item.status === 'failed').length,
          active_cycle_count: cycles.filter((item) => !['passed', 'failed', 'cancelled', 'returned'].includes(item.status)).length,
          executed_count: sum('executed_count'), bug_count: sum('bug_count'), reopen_count: sum('reopen_count'), blocked_count: sum('blocked_count'),
          test_actual_hours: oneDecimal((store.task_work_segments ?? []).filter((item) => activityTaskIds.has(item.task_id)).reduce((total, item) => total + segmentHours(item), 0)),
          cycles: cycles.map(cycleDetail),
        },
        error: null,
      };
    }

    if (name === 'create_test_plan') {
      if (!String(params.p_title ?? '').trim() || !String(params.p_test_scope ?? '').trim() || !String(params.p_test_goal ?? '').trim()) return err('计划名称、测试范围和测试目标必填');
      const source = params.p_source;
      if (source === 'internal_project' && !params.p_project_id) return err('内部项目必填');
      if (source === 'external_request' && (!String(params.p_external_project_name ?? '').trim() || !String(params.p_external_owner_name ?? '').trim())) return err('外部项目名称和项目负责人必填');
      let eligibleScopeTasks: Row[] = [];
      if (source === 'internal_project') {
        const project = store.projects.find((item) => item.id === params.p_project_id);
        if (!project) return err('内部项目不存在');
        if (project.owner_id !== DEMO_DEV_ID) return err('仅项目负责人可以发起内部项目测试，管理员暂不支持代办');
        if (project.status !== 'active') return err('已完成或已暂停项目不能发起测试');
        if (project.no_test_status === 'approved') return err('项目已批准无需测试，请先按流程撤销原决定');
        const hasActiveCycle = store.test_cycles.some((cycle) => {
          const plan = store.test_plans.find((item) => item.id === cycle.plan_id);
          return plan?.project_id === project.id && !['passed', 'failed', 'cancelled', 'returned'].includes(cycle.status);
        });
        if (hasActiveCycle) return err('该项目已有未结束的测试轮次');
        const covered = new Set(store.test_cycle_scope_tasks.filter((scope) => {
          const coveredCycle = store.test_cycles.find((cycle) => cycle.id === scope.cycle_id);
          return coveredCycle?.status === 'passed';
        }).map((scope) => scope.task_id));
        eligibleScopeTasks = store.tasks.filter((task) =>
          task.project_id === project.id
          && task.task_type === 'dev'
          && ['done', 'delayed_done'].includes(task.status)
          && task.completed_at
          && task.approved_by_user
          && !covered.has(task.id));
        if (!eligibleScopeTasks.length) return err('没有已审批完成且未被通过轮次覆盖的开发任务');
      }
      const planId = uuid(); const cycleId = uuid(); const ts = now();
      store.test_plans.push({
        id: planId, source, title: String(params.p_title).trim(),
        project_id: source === 'internal_project' ? params.p_project_id : null,
        external_project_name: source === 'external_request' ? String(params.p_external_project_name).trim() : null,
        external_owner_name: source === 'external_request' ? String(params.p_external_owner_name).trim() : null,
        version_name: params.p_version_name ?? null, test_scope: String(params.p_test_scope).trim(),
        test_goal: String(params.p_test_goal).trim(), deliverables: params.p_deliverables ?? null,
        expected_start: params.p_expected_start ?? null, expected_end: params.p_expected_end ?? null,
        environment_note: params.p_environment_note ?? null, priority: params.p_priority ?? 'medium',
        related_url: params.p_related_url ?? null, zentao_url: params.p_zentao_url ?? null,
        test_team_id: params.p_test_team_id, recommended_owner_id: params.p_recommended_owner_id ?? null,
        status: 'requested', created_by: DEMO_DEV_ID, created_at: ts, updated_at: ts,
      });
      store.test_cycles.push({
        id: cycleId, plan_id: planId, cycle_no: 1, stage_version: params.p_version_name || '首轮测试',
        scope_note: params.p_test_scope, status: 'requested', planned_start: null, planned_end: null,
        actual_started_at: null, actual_completed_at: null, main_tester_id: null,
        submitted_by: DEMO_DEV_ID, submitted_at: ts, proposed_result: null, created_at: ts, updated_at: ts,
      });
      if (source === 'internal_project') {
        const project = store.projects.find((item) => item.id === params.p_project_id);
        if (project) Object.assign(project, {
          requires_testing: true, test_state: 'requested', no_test_status: 'none',
          no_test_reason: null, no_test_related_url: null, no_test_decision_note: null,
        });
        for (const task of eligibleScopeTasks) store.test_cycle_scope_tasks.push({
          id: uuid(), cycle_id: cycleId, task_id: task.id, task_title_snapshot: task.title,
          task_status_snapshot: task.status, task_owner_snapshot: store.developers.find((item) => item.id === task.developer_id)?.name ?? null,
          approved_by_snapshot: store.developers.find((item) => item.id === task.approved_by_user)?.name ?? null,
          approved_at_snapshot: task.completed_at, created_at: ts,
        });
      }
      for (const reportType of params.p_report_types ?? []) store.test_reports.push({
        id: uuid(), cycle_id: cycleId, report_type: reportType,
        report_name: ({ system: '系统测试报告', performance: '性能测试报告', security: '安全测试报告', compatibility: '兼容性测试报告' } as Row)[reportType] ?? '其他测试报告',
        is_required: true, status: 'pending', not_issued_reason: null, updated_by: null, updated_at: ts,
      });
      store.test_plan_events.push({ id: uuid(), plan_id: planId, cycle_id: cycleId, event_type: 'requested', actor_id: DEMO_DEV_ID, reason: null, payload: { source }, created_at: ts });
      save();
      return { data: planId, error: null };
    }

    if (name === 'create_test_cycle') {
      const plan = store.test_plans.find((item) => item.id === params.p_plan_id);
      if (!plan) return err('测试计划不存在');
      if (store.test_cycles.some((item) => item.plan_id === plan.id && !['passed', 'failed', 'cancelled', 'returned'].includes(item.status))) return err('当前仍有未结束轮次');
      const cycleId = uuid();
      const cycleNo = Math.max(0, ...store.test_cycles.filter((item) => item.plan_id === plan.id).map((item) => Number(item.cycle_no))) + 1;
      store.test_cycles.push({
        id: cycleId, plan_id: plan.id, cycle_no: cycleNo, stage_version: String(params.p_stage_version ?? '').trim(),
        scope_note: params.p_scope_note ?? null, status: 'requested', planned_start: null, planned_end: null,
        actual_started_at: null, actual_completed_at: null, main_tester_id: null,
        submitted_by: DEMO_DEV_ID, submitted_at: now(), proposed_result: null, created_at: now(), updated_at: now(),
      });
      if (plan.source === 'internal_project') {
        const eligible = store.tasks.filter((task) => task.project_id === plan.project_id && task.task_type === 'dev' && ['done', 'delayed_done'].includes(task.status));
        const covered = new Set(store.test_cycle_scope_tasks.filter((scope) => {
          const oldCycle = store.test_cycles.find((item) => item.id === scope.cycle_id);
          return oldCycle?.status === 'passed';
        }).map((scope) => scope.task_id));
        const scopeTasks = eligible.filter((task) => !covered.has(task.id));
        if (!scopeTasks.length) {
          store.test_cycles = store.test_cycles.filter((item) => item.id !== cycleId);
          return err('没有新增的已审批开发任务可纳入本轮测试');
        }
        for (const task of scopeTasks) store.test_cycle_scope_tasks.push({
          id: uuid(), cycle_id: cycleId, task_id: task.id, task_title_snapshot: task.title,
          task_status_snapshot: task.status, task_owner_snapshot: store.developers.find((item) => item.id === task.developer_id)?.name ?? null,
          approved_by_snapshot: store.developers.find((item) => item.id === task.approved_by_user)?.name ?? null,
          approved_at_snapshot: task.completed_at, created_at: now(),
        });
        const project = store.projects.find((item) => item.id === plan.project_id);
        if (project) project.test_state = 'requested';
      }
      for (const reportType of params.p_report_types ?? []) store.test_reports.push({
        id: uuid(), cycle_id: cycleId, report_type: reportType, report_name: reportType,
        is_required: true, status: 'pending', not_issued_reason: null, updated_by: null, updated_at: now(),
      });
      plan.status = 'requested'; plan.updated_at = now();
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycleId, event_type: 'requested', actor_id: DEMO_DEV_ID, reason: null, payload: {}, created_at: now() });
      save(); return { data: cycleId, error: null };
    }

    if (name === 'review_test_schedule') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      if (!cycle || !plan) return err('测试轮次不存在');
      if (!params.p_accept) {
        if (!String(params.p_reason ?? '').trim()) return err('退回排期必须填写原因');
        Object.assign(cycle, { status: 'returned', schedule_note: String(params.p_reason).trim(), schedule_decided_by: DEMO_DEV_ID, schedule_decided_at: now(), updated_at: now() });
        plan.status = 'returned';
      } else {
        if (!params.p_main_tester_id || !params.p_planned_start || !params.p_planned_end) return err('请指定主测试负责人和有效计划日期');
        Object.assign(cycle, { status: 'accepted', main_tester_id: params.p_main_tester_id, planned_start: params.p_planned_start, planned_end: params.p_planned_end, schedule_note: params.p_reason ?? null, schedule_decided_by: DEMO_DEV_ID, schedule_decided_at: now(), updated_at: now() });
        plan.status = 'accepted'; plan.recommended_owner_id = params.p_main_tester_id;
        store.test_cycle_participants = store.test_cycle_participants.filter((item) => item.cycle_id !== cycle.id);
        store.test_cycle_participants.push({ id: uuid(), cycle_id: cycle.id, developer_id: params.p_main_tester_id, participant_role: 'main', planned_hours: 0, created_at: now() });
        const project = store.projects.find((item) => item.id === plan.project_id);
        if (project) project.test_state = 'scheduled';
      }
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycle.id, event_type: params.p_accept ? 'schedule_accepted' : 'schedule_returned', actor_id: DEMO_DEV_ID, reason: params.p_reason ?? null, payload: {}, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'transition_test_cycle') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      if (!cycle || !plan) return err('测试轮次不存在');
      const action = params.p_action; const reason = String(params.p_reason ?? '').trim();
      const mapping: Row = { start: ['accepted', 'in_progress'], pause: ['in_progress', 'paused'], resume: ['paused', 'in_progress'] };
      if (action === 'cancel') {
        if (!reason) return err('取消必须填写原因');
        cycle.status = 'cancelled'; cycle.cancel_reason = reason; cycle.actual_completed_at = now();
      } else {
        const [from, to] = mapping[action] ?? [];
        if (!from || cycle.status !== from) return err('当前状态不能执行该操作');
        if (action === 'pause' && !reason) return err('暂停必须填写原因');
        cycle.status = to;
        if (action === 'start') cycle.actual_started_at ??= now();
        if (action === 'pause') cycle.pause_reason = reason;
      }
      plan.status = cycle.status; cycle.updated_at = now(); plan.updated_at = now();
      const project = store.projects.find((item) => item.id === plan.project_id);
      if (project && cycle.status === 'in_progress') project.test_state = 'testing';
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycle.id, event_type: `cycle_${action}`, actor_id: DEMO_DEV_ID, reason: reason || null, payload: {}, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'add_test_activity') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      if (!cycle || !plan) return err('测试轮次不存在');
      const activityId = uuid(); const taskId = uuid(); const ts = now();
      store.test_activities.push({
        id: activityId, cycle_id: cycle.id, activity_type: params.p_activity_type, title: String(params.p_title).trim(),
        owner_id: params.p_owner_id, planned_start: params.p_planned_start, planned_end: params.p_planned_end,
        planned_hours: Number(params.p_planned_hours ?? 0), preconditions: params.p_preconditions ?? null,
        expected_deliverable: params.p_expected_deliverable ?? null, status: cycle.status === 'in_progress' ? 'in_progress' : 'todo', task_id: taskId,
        created_by: DEMO_DEV_ID, created_at: ts, updated_at: ts,
      });
      store.tasks.push({
        ...TABLE_DEFAULTS.tasks, id: taskId, title: `[测试活动] ${String(params.p_title).trim()}`,
        description: params.p_expected_deliverable ?? null, status: cycle.status === 'in_progress' ? 'in_progress' : 'todo', priority: plan.priority,
        task_type: 'test', project_id: plan.project_id, developer_id: params.p_owner_id,
        team_id: plan.test_team_id, start_date: params.p_planned_start, due_date: params.p_planned_end,
        created_by: DEMO_DEV_ID, work_source: 'test_activity', test_plan_id: plan.id,
        test_cycle_id: cycle.id, test_activity_id: activityId, created_at: ts, updated_at: ts,
      });
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycle.id, event_type: 'activity_created', actor_id: DEMO_DEV_ID, reason: null, payload: { activity_id: activityId, task_id: taskId }, created_at: ts });
      save(); return { data: activityId, error: null };
    }

    if (name === 'add_test_execution_batch') {
      const counts = ['p_planned_count', 'p_executed_count', 'p_passed_count', 'p_failed_count', 'p_blocked_count', 'p_skipped_count', 'p_bug_count', 'p_reopen_count'];
      if (counts.some((key) => !Number.isInteger(Number(params[key])) || Number(params[key]) < 0)) return err('数量必须是非负整数');
      if (Number(params.p_passed_count) + Number(params.p_failed_count) + Number(params.p_blocked_count) + Number(params.p_skipped_count) !== Number(params.p_executed_count)) return err('通过、失败、阻塞、跳过数量之和必须等于实际执行数');
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      if (!cycle || cycle.status !== 'in_progress') return err('只能在测试进行中登记执行批次');
      const batchId = uuid();
      store.test_execution_batches.push({
        id: batchId, cycle_id: cycle.id, activity_id: params.p_activity_id ?? null,
        executed_on: params.p_executed_on, executor_id: DEMO_DEV_ID,
        environment_name: String(params.p_environment_name).trim(), build_version: String(params.p_build_version).trim(),
        test_type: params.p_test_type, planned_count: Number(params.p_planned_count), executed_count: Number(params.p_executed_count),
        passed_count: Number(params.p_passed_count), failed_count: Number(params.p_failed_count),
        blocked_count: Number(params.p_blocked_count), skipped_count: Number(params.p_skipped_count),
        bug_count: Number(params.p_bug_count), reopen_count: Number(params.p_reopen_count),
        smoke_passed: params.p_smoke_passed ?? null, issue_summary: params.p_issue_summary ?? null,
        blocker_summary: params.p_blocker_summary ?? null, risk_summary: params.p_risk_summary ?? null,
        zentao_url: params.p_zentao_url ?? null, created_by: DEMO_DEV_ID, created_at: now(), updated_at: now(),
      });
      save(); return { data: batchId, error: null };
    }

    if (name === 'set_test_report_status') {
      const report = store.test_reports.find((item) => item.id === params.p_report_id);
      if (!report) return err('报告项不存在');
      if (params.p_status === 'not_issued' && !String(params.p_not_issued_reason ?? '').trim()) return err('未出具报告必须说明原因');
      Object.assign(report, { status: params.p_status, not_issued_reason: params.p_status === 'not_issued' ? String(params.p_not_issued_reason).trim() : null, updated_by: DEMO_DEV_ID, updated_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'submit_test_conclusion') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      if (!cycle || !plan) return err('测试轮次不存在');
      if (cycle.status !== 'in_progress') return err('只能在测试进行中提交结论');
      const required = ['p_scope', 'p_completion', 'p_new_issues', 'p_legacy_issues', 'p_blockers', 'p_risks', 'p_release_recommendation'];
      if (required.some((key) => !String(params[key] ?? '').trim())) return err('结构化测试结论各项均为必填');
      if (store.test_reports.some((item) => item.cycle_id === cycle.id && item.is_required && item.status === 'pending')) return err('请先完成所有必需报告的已出具/未出具状态');
      if (params.p_result === 'fail' && plan.source === 'internal_project' && !store.test_cycle_repair_tasks.some((item) => item.cycle_id === cycle.id)) return err('内部项目测试不通过时必须关联具体整改任务');
      Object.assign(cycle, {
        status: 'conclusion_pending', proposed_result: params.p_result,
        conclusion_scope: String(params.p_scope).trim(), conclusion_completion: String(params.p_completion).trim(),
        conclusion_new_issues: String(params.p_new_issues).trim(), conclusion_legacy_issues: String(params.p_legacy_issues).trim(),
        conclusion_blockers: String(params.p_blockers).trim(), conclusion_risks: String(params.p_risks).trim(),
        release_recommendation: String(params.p_release_recommendation).trim(),
        conclusion_submitted_by: DEMO_DEV_ID, conclusion_submitted_at: now(), updated_at: now(),
      });
      plan.status = 'conclusion_pending'; plan.updated_at = now();
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycle.id, event_type: 'conclusion_submitted', actor_id: DEMO_DEV_ID, reason: null, payload: { result: params.p_result }, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'link_test_repair_task') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      const repair = store.tasks.find((item) => item.id === params.p_repair_task_id);
      if (!cycle || !plan || !repair || repair.project_id !== plan.project_id) return err('整改任务必须属于同一项目');
      if (!store.test_cycle_repair_tasks.some((item) => item.cycle_id === cycle.id && item.repair_task_id === repair.id)) {
        store.test_cycle_repair_tasks.push({ id: uuid(), cycle_id: cycle.id, scope_task_id: params.p_scope_task_id ?? null, repair_task_id: repair.id, created_by: DEMO_DEV_ID, created_at: now() });
      }
      save(); return { data: null, error: null };
    }

    if (name === 'review_test_conclusion') {
      const cycle = store.test_cycles.find((item) => item.id === params.p_cycle_id);
      const plan = store.test_plans.find((item) => item.id === cycle?.plan_id);
      if (!cycle || !plan || cycle.status !== 'conclusion_pending') return err('当前没有待确认的测试结论');
      if (!params.p_confirm) {
        if (!String(params.p_reason ?? '').trim()) return err('退回结论必须填写原因');
        cycle.status = 'in_progress'; cycle.conclusion_return_reason = String(params.p_reason).trim(); plan.status = 'in_progress';
      } else {
        const terminalStatus = cycle.proposed_result === 'pass' ? 'passed' : cycle.proposed_result === 'fail' ? 'failed' : null;
        if (!terminalStatus) return err('待确认测试结论无效');
        cycle.status = terminalStatus; cycle.actual_completed_at = now(); cycle.conclusion_confirmed_by = DEMO_DEV_ID; cycle.conclusion_confirmed_at = now();
        plan.status = terminalStatus;
        const project = store.projects.find((item) => item.id === plan.project_id);
        if (project) project.test_state = cycle.proposed_result === 'pass' ? 'passed' : 'fixing';
        for (const activity of store.test_activities.filter((item) => item.cycle_id === cycle.id)) {
          activity.status = 'done';
          const task = store.tasks.find((item) => item.id === activity.task_id);
          if (task) Object.assign(task, { status: 'done', submitted_at: now(), completed_at: now(), updated_at: now() });
        }
      }
      cycle.updated_at = now(); plan.updated_at = now();
      store.test_plan_events.push({ id: uuid(), plan_id: plan.id, cycle_id: cycle.id, event_type: params.p_confirm ? 'conclusion_confirmed' : 'conclusion_returned', actor_id: DEMO_DEV_ID, reason: params.p_reason ?? null, payload: {}, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'submit_no_test_request') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      const reason = String(params.p_reason ?? '').trim();
      if (!project) return err('项目不存在');
      if (reason.length < 10 || reason.length > 1000) return err('无需测试原因需为 10～1000 个字符');
      Object.assign(project, { no_test_status: 'pending', no_test_reason: reason, no_test_related_url: params.p_related_url ?? null, no_test_decision_note: null, updated_at: now() });
      store.project_no_test_events.push({ id: uuid(), project_id: project.id, event_type: 'submitted', actor_id: DEMO_DEV_ID, reason, related_url: params.p_related_url ?? null, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'review_no_test_request') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      if (!project || project.no_test_status !== 'pending') return err('没有待确认的无需测试申请');
      if (!params.p_approve && !String(params.p_reason ?? '').trim()) return err('退回无需测试申请必须填写原因');
      Object.assign(project, { no_test_status: params.p_approve ? 'approved' : 'rejected', requires_testing: !params.p_approve, test_state: params.p_approve ? 'no_test_approved' : 'not_requested', no_test_decision_note: params.p_reason ?? null, updated_at: now() });
      store.project_no_test_events.push({ id: uuid(), project_id: project.id, event_type: params.p_approve ? 'approved' : 'rejected', actor_id: DEMO_DEV_ID, reason: params.p_reason ?? null, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'withdraw_no_test_request') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      if (!project || project.no_test_status !== 'pending') return err('没有可撤回的无需测试申请');
      Object.assign(project, { no_test_status: 'none', no_test_reason: null, no_test_related_url: null, updated_at: now() });
      store.project_no_test_events.push({ id: uuid(), project_id: project.id, event_type: 'withdrawn', actor_id: DEMO_DEV_ID, reason: null, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'create_test_construction') {
      if (!String(params.p_title ?? '').trim() || !String(params.p_goal ?? '').trim() || !String(params.p_deliverables ?? '').trim() || !String(params.p_acceptance_criteria ?? '').trim()) return err('标题、目标、预期成果和验收标准必填');
      const workId = uuid(); const ts = now();
      store.test_construction_works.push({
        id: workId, title: String(params.p_title).trim(), work_type: params.p_work_type,
        goal: String(params.p_goal).trim(), priority: params.p_priority ?? 'medium', owner_id: params.p_owner_id,
        planned_start: params.p_planned_start ?? null, planned_end: params.p_planned_end ?? null,
        deliverables: String(params.p_deliverables).trim(), acceptance_criteria: String(params.p_acceptance_criteria).trim(),
        resource_links: params.p_resource_links ?? null, risk_note: null, blocker_note: null, adjustment_note: null,
        status: 'draft', completion_note: null, created_by: DEMO_DEV_ID, created_at: ts, updated_at: ts,
      });
      store.test_construction_participants.push({ id: uuid(), work_id: workId, developer_id: params.p_owner_id, participant_role: 'owner', planned_hours: 0, created_at: ts });
      store.test_construction_events.push({ id: uuid(), work_id: workId, event_type: 'created', actor_id: DEMO_DEV_ID, reason: null, payload: {}, created_at: ts });
      save(); return { data: workId, error: null };
    }

    if (name === 'add_construction_task') {
      const work = store.test_construction_works.find((item) => item.id === params.p_work_id);
      if (!work) return err('测试建设工作不存在');
      const subId = uuid(); const taskId = uuid(); const ts = now();
      store.test_construction_tasks.push({
        id: subId, work_id: work.id, title: String(params.p_title).trim(), owner_id: params.p_owner_id,
        planned_start: params.p_planned_start, planned_end: params.p_planned_end,
        planned_hours: Number(params.p_planned_hours ?? 0), progress: 0, status: 'todo',
        task_id: taskId, created_by: DEMO_DEV_ID, created_at: ts, updated_at: ts,
      });
      store.tasks.push({
        ...TABLE_DEFAULTS.tasks, id: taskId, title: `[测试建设] ${String(params.p_title).trim()}`,
        status: 'todo', priority: work.priority, task_type: 'test', project_id: null,
        developer_id: params.p_owner_id, team_id: null, start_date: params.p_planned_start,
        due_date: params.p_planned_end, created_by: DEMO_DEV_ID, work_source: 'construction',
        construction_work_id: work.id, construction_task_id: subId, created_at: ts, updated_at: ts,
      });
      store.test_construction_events.push({ id: uuid(), work_id: work.id, event_type: 'task_created', actor_id: DEMO_DEV_ID, reason: null, payload: { construction_task_id: subId, task_id: taskId }, created_at: ts });
      save(); return { data: subId, error: null };
    }

    if (name === 'transition_construction') {
      const work = store.test_construction_works.find((item) => item.id === params.p_work_id);
      if (!work) return err('测试建设工作不存在');
      const action = params.p_action; const reason = String(params.p_reason ?? '').trim();
      const map: Row = { submit_schedule: ['draft', 'pending_schedule'], confirm_schedule: ['pending_schedule', 'active'], resume: ['paused', 'active'], confirm_result: ['pending_acceptance', 'completed'] };
      if (['pause', 'submit_result', 'return_result', 'cancel'].includes(action) && !reason) return err('该操作必须填写原因或成果说明');
      if (action === 'pause' && work.status === 'active') work.status = 'paused';
      else if (action === 'submit_result' && work.status === 'active') { work.status = 'pending_acceptance'; work.completion_note = reason; }
      else if (action === 'return_result' && work.status === 'pending_acceptance') { work.status = 'active'; work.completion_note = reason; }
      else if (action === 'cancel' && !['completed', 'cancelled'].includes(work.status)) { work.status = 'cancelled'; work.blocker_note = reason; }
      else {
        const [from, to] = map[action] ?? [];
        if (!from || work.status !== from) return err('当前状态不能执行该操作');
        work.status = to;
      }
      if (action === 'confirm_schedule') { work.schedule_confirmed_by = DEMO_DEV_ID; work.schedule_confirmed_at = now(); }
      if (action === 'confirm_result') {
        work.result_confirmed_by = DEMO_DEV_ID; work.result_confirmed_at = now();
        for (const item of store.test_construction_tasks.filter((x) => x.work_id === work.id)) {
          item.status = 'done'; item.progress = 100;
          const task = store.tasks.find((x) => x.id === item.task_id);
          if (task) Object.assign(task, { status: 'done', submitted_at: now(), completed_at: now(), updated_at: now() });
        }
      }
      work.updated_at = now();
      store.test_construction_events.push({ id: uuid(), work_id: work.id, event_type: action, actor_id: DEMO_DEV_ID, reason: reason || null, payload: {}, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'update_construction_task') {
      const item = store.test_construction_tasks.find((row) => row.id === params.p_construction_task_id);
      const work = store.test_construction_works.find((row) => row.id === item?.work_id);
      if (!item || !work) return err('建设任务不存在');
      if (!['active', 'paused'].includes(work.status)) return err('建设工作尚未进入执行阶段');
      if (!['todo', 'in_progress', 'paused', 'done', 'cancelled'].includes(params.p_status)) return err('建设任务状态无效');
      item.status = params.p_status;
      item.progress = params.p_status === 'done' ? 100 : Math.max(0, Math.min(100, Number(params.p_progress ?? 0)));
      item.updated_at = now();
      const task = store.tasks.find((row) => row.id === item.task_id);
      if (task) Object.assign(task, {
        status: params.p_status === 'cancelled' ? 'paused' : params.p_status,
        submitted_at: params.p_status === 'done' ? (task.submitted_at ?? now()) : task.submitted_at,
        completed_at: params.p_status === 'done' ? (task.completed_at ?? now()) : null,
        updated_at: now(),
      });
      store.test_construction_events.push({ id: uuid(), work_id: work.id, event_type: 'task_updated', actor_id: DEMO_DEV_ID, reason: null, payload: { construction_task_id: item.id, status: item.status, progress: item.progress }, created_at: now() });
      save(); return { data: null, error: null };
    }

    if (name === 'record_test_work_hours') {
      const task = store.tasks.find((item) => item.id === params.p_task_id);
      const hours = Number(params.p_hours);
      if (!task || !['test_activity', 'construction'].includes(task.work_source)) return err('只能为测试活动或测试建设任务登记工时');
      if (!(hours > 0 && hours <= 24)) return err('单日工时必须大于 0 且不超过 24 小时');
      const start = `${params.p_work_date}T09:00:00.000Z`;
      const end = new Date(new Date(start).getTime() + hours * 3600000).toISOString();
      const segmentId = uuid();
      store.task_work_segments.push({ id: segmentId, task_id: task.id, developer_id: DEMO_DEV_ID, started_at: start, ended_at: end, entry_source: 'manual', note: params.p_note ?? null, created_by: DEMO_DEV_ID });
      save(); return { data: segmentId, error: null };
    }

    if (['submit_for_testing', 'start_test_task', 'conclude_test'].includes(name)) {
      return err('单任务提测已停用，请从统一测试中心发起项目 / 阶段 / 版本测试轮次');
    }

    if (name === 'get_project_summaries') {
      return {
        data: store.projects
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(projectSummary),
        error: null,
      };
    }

    if (name === 'get_project_cockpit') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      return project ? { data: projectCockpit(project), error: null } : err('项目不存在');
    }

    if (name === 'list_tasks') {
      const completed = (task: Row) => ['done', 'delayed_done'].includes(task.status);
      const scope = params.p_scope ?? 'all';
      const teamIds = new Set([
        ...(store.developer_teams ?? []).filter((item) => item.developer_id === DEMO_DEV_ID).map((item) => item.team_id),
        ...store.teams.filter((team) => team.leader_id === DEMO_DEV_ID).map((team) => team.id),
      ]);
      let rows = store.tasks.filter((task) => {
        if (params.p_focus_id && task.id !== params.p_focus_id) return false;
        if (params.p_project_id && task.project_id !== params.p_project_id) return false;
        if (params.p_task_type && task.task_type !== params.p_task_type) return false;
        if (Array.isArray(params.p_statuses) && params.p_statuses.length && !params.p_statuses.includes(task.status)) return false;
        if (params.p_priority && task.priority !== params.p_priority) return false;
        if (params.p_team_id && task.team_id !== params.p_team_id) return false;
        if (params.p_assignee === 'unassigned' && task.developer_id) return false;
        if (params.p_assignee && params.p_assignee !== 'unassigned' && task.developer_id !== params.p_assignee) return false;
        if (params.p_timing === 'overdue' && (completed(task) || !task.due_date || task.due_date >= day(0))) return false;
        if (params.p_timing === 'delayed' && task.status !== 'delayed_done') return false;
        if (params.p_preset === 'testing_active' && !(
          (task.task_type === 'dev' && task.status === 'testing') ||
          (task.task_type === 'test' && !completed(task) && !task.test_result)
        )) return false;
        if (params.p_result && (task.task_type !== 'test' || task.test_result !== params.p_result)) return false;
        if (params.p_blocked != null) {
          const matchesBlocked = (store.test_rounds ?? []).some((round) => round.test_task_id === task.id && !!round.blocked === !!params.p_blocked);
          if (!matchesBlocked) return false;
        }
        if (params.p_summary === 'missing') {
          const hasSummary = (store.test_rounds ?? []).some((round) => round.test_task_id === task.id && !!round.result);
          if (task.task_type !== 'test' || !task.test_result || hasSummary) return false;
        }
        const query = String(params.p_query ?? '').trim().toLowerCase();
        if (query) {
          const project = store.projects.find((item) => item.id === task.project_id);
          const haystack = `${task.title} ${task.description ?? ''} ${project?.name ?? ''}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (scope === 'mine' && task.developer_id !== DEMO_DEV_ID) return false;
        if (scope === 'team' && task.developer_id !== DEMO_DEV_ID && !teamIds.has(task.team_id)) return false;
        return true;
      });
      rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      const total = rows.length;
      const page = Math.max(1, Number(params.p_page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(params.p_page_size) || 10));
      const items = rows.slice((page - 1) * pageSize, page * pageSize).map((task) => ({
        ...task,
        actual_effort_hours: oneDecimal(taskHours(task.id)),
        actual_day_count: taskDayCount(task.id),
      }));
      return { data: { items, total, page, page_size: pageSize }, error: null };
    }

    if (name === 'complete_project') {
      const project = store.projects.find((item) => item.id === params.p_project_id);
      if (!project) return err('项目不存在');
      if (project.status === 'completed') return err('项目已经完成');
      const reason = String(params.p_reason ?? '').trim();
      if (params.p_force && !reason) return err('管理员强制完成必须填写原因');
      if (reason.length > 2000) return err('强制完成原因不能超过 2000 个字符');
      const tasks = store.tasks.filter((task) => task.project_id === project.id);
      const blockers = {
        unfinished_dev: tasks.filter((task) => task.task_type === 'dev' && !['done', 'delayed_done'].includes(task.status)).length,
        active_test: tasks.filter((task) => ['legacy_single_test', 'test_activity'].includes(task.work_source) && !['done', 'delayed_done'].includes(task.status)).length,
        review: tasks.filter((task) => task.status === 'review').length,
        active_test_cycles: (store.test_cycles ?? []).filter((cycle) => {
          const plan = store.test_plans.find((item) => item.id === cycle.plan_id);
          return plan?.project_id === project.id && !['passed', 'failed', 'cancelled', 'returned'].includes(cycle.status);
        }).length,
        testing_gate: !!project.requires_testing && project.test_state !== 'passed',
      };
      const blockerTitles = tasks.filter((task) => !['done', 'delayed_done'].includes(task.status)).slice(0, 10).map((task) => `${task.title}（${task.status}）`).join('、');
      if ((blockers.unfinished_dev || blockers.active_test || blockers.review || blockers.active_test_cycles || blockers.testing_gate) && !params.p_force) {
        return err(`项目仍有阻断项：未完成开发任务 ${blockers.unfinished_dev} 个、在办测试工作 ${blockers.active_test} 个、待审批 ${blockers.review} 个、活动测试轮次 ${blockers.active_test_cycles} 个；测试门禁=${blockers.testing_gate ? '未通过' : '已满足'}。`);
      }
      const completedAt = now();
      const fromStatus = project.status;
      Object.assign(project, { status: 'completed', completed_at: completedAt, updated_at: completedAt });
      (store.project_status_events ??= []).push({
        id: uuid(), project_id: project.id,
        event_type: params.p_force ? 'force_completed' : 'completed',
        from_status: fromStatus, to_status: 'completed',
        actor_id: DEMO_DEV_ID, actor_name: '演示管理员', actor_role: 'admin',
        is_admin_force: !!params.p_force, reason: params.p_force ? reason : null,
        blocker_snapshot: { ...blockers, sample_tasks: blockerTitles }, created_at: completedAt,
      });
      save();
      return { data: blockers, error: null };
    }

    if (name === 'admin_proxy_task_review') {
      const task = store.tasks.find((t) => t.id === params.p_task_id);
      const reason = String(params.p_reason ?? '').trim();
      const rejectNote = String(params.p_reject_note ?? '').trim();
      if (!task) return err('任务不存在');
      if (task.status !== 'review') return err('仅审核中的任务可执行异常代办');
      if (!reason) return err('管理员异常代办必须填写代办原因');
      if (reason.length > 2000) return err('代办原因不能超过 2000 个字符');
      const project = store.projects.find((p) => p.id === task.project_id);
      if (task.project_id && !project?.owner_id) return err('项目缺少负责人，请先在项目管理中补充负责人，不能回退给组长或管理员日常审批');
      if (!params.p_approve && !rejectNote) return err('驳回任务必须填写驳回原因');
      adminProxyReason = reason;
      const result = await new Query('tasks')
        .update(params.p_approve ? { status: 'done' } : { status: 'in_progress', reject_note: rejectNote })
        .eq('id', task.id);
      adminProxyReason = null;
      return result;
    }

    return err(`未知 RPC: ${name}`);
  };

  return {
    from: (table: string) => new Query(table),
    auth,
    rpc,
    channel: (_name: string) => channelStub,
    removeChannel: (_ch: any) => {},
  };
}
