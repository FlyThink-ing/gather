// 领域类型与枚举 —— 与数据库表结构对应（需求 v2）

export type Role = 'admin' | 'manager' | 'user';

export type TaskStatus = 'todo' | 'in_progress' | 'paused' | 'testing' | 'review' | 'done' | 'delayed_done';

export type TaskType = 'dev' | 'test';

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  dev: '开发',
  test: '测试',
};
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectStatus = 'active' | 'completed' | 'paused';

export const POSITIONS = [
  '前端开发工程师',
  '后端开发工程师',
  '测试工程师',
  '自动化测试工程师',
  '移动端开发工程师',
] as const;
export type Position = (typeof POSITIONS)[number];

export interface Developer {
  id: string;
  user_id: string | null;
  name: string;
  position: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  leader_id: string | null;
  is_test_team: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  team_id: string;
  owner_id: string | null;
  requires_testing: boolean;
  test_state: ProjectTestState;
  no_test_status: NoTestStatus;
  no_test_reason: string | null;
  no_test_related_url: string | null;
  no_test_decision_note: string | null;
  /** 首个真实工时段开始时间；没有可靠工时数据时保持为空。 */
  actual_started_at: string | null;
  /** 最近一次项目完成时间；重新打开后为空，历史见 project_status_events。 */
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** v2.14：项目列表与项目全景共用的严格聚合口径。 */
export interface ProjectSummary extends Project {
  plan_days: number | null;
  actual_cycle_days: number | null;
  actual_effort_hours: number;
  actual_effort_person_days: number;
  dev_task_total: number;
  dev_task_completed: number;
  dev_completion_rate: number | null;
  test_task_total: number;
  test_round_total: number;
  review_count: number;
  overdue_count: number;
  testing_active_count: number;
  completed_task_count: number;
  delayed_done_count: number;
  unassigned_count: number;
  unfinished_dev_count: number;
  active_test_count: number;
  todo_count: number;
  in_progress_count: number;
  paused_count: number;
  testing_status_count: number;
  done_count: number;
  cumulative_bug_count: number;
  reopen_count: number;
  failed_round_count: number;
  blocked_round_count: number;
  test_pass_rate: number | null;
  summary_covered_count: number;
  summary_expected_count: number;
  summary_coverage_rate: number | null;
}

export interface ProjectQualityRound {
  id: string | null;
  test_task_id: string;
  round_no: number | null;
  test_method: 'case_based' | 'exploratory' | null;
  result: 'pass' | 'fail' | null;
  blocked: boolean | null;
  planned_case_count: number | null;
  executed_case_count: number | null;
  verification_scope: string | null;
  verification_reason: string | null;
  bug_count: number | null;
  reopen_count: number | null;
  note: string | null;
  zentao_url: string | null;
  started_at: string | null;
  concluded_by: string | null;
  concluded_at: string | null;
  summary_recorded: boolean;
  test_task_title: string;
  test_task_status: TaskStatus;
  test_result: 'pass' | 'fail' | null;
  tester_id: string | null;
  tester_name: string | null;
  linked_task_id: string | null;
  linked_task_title: string | null;
  created_at: string;
}

export interface ProjectPersonMetric {
  developer_id: string | null;
  person_name: string;
  position: string | null;
  task_count: number;
  dev_task_count: number;
  test_task_count: number;
  completed_task_count: number;
  review_task_count: number;
  overdue_task_count: number;
  actual_effort_hours: number;
  actual_effort_person_days: number;
}

export interface ProjectTimelineEvent {
  event_type: string;
  occurred_at: string;
  title: string;
  detail: string | null;
  task_id: string | null;
}

export interface ProjectCockpit extends ProjectSummary {
  quality_rounds: ProjectQualityRound[];
  people: ProjectPersonMetric[];
  timeline: ProjectTimelineEvent[];
}

export interface ProjectStatusEvent {
  id: string;
  project_id: string;
  event_type: 'created' | 'status_changed' | 'completed' | 'force_completed' | 'reopened';
  from_status: ProjectStatus | null;
  to_status: ProjectStatus;
  actor_id: string | null;
  actor_name: string;
  actor_role: Role;
  is_admin_force: boolean;
  reason: string | null;
  blocker_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  /** v2.5：开发任务 / 测试任务 */
  task_type: TaskType;
  work_source: 'development' | 'legacy_single_test' | 'test_activity' | 'construction';
  test_plan_id: string | null;
  test_cycle_id: string | null;
  test_activity_id: string | null;
  construction_work_id: string | null;
  construction_task_id: string | null;
  /** 测试任务关联的开发任务 id */
  linked_task_id: string | null;
  /** 测试结论（仅测试任务）：pass/fail */
  test_result: 'pass' | 'fail' | null;
  /** 测试结论备注 */
  test_note: string | null;
  project_id: string | null;
  developer_id: string | null;
  team_id: string | null;
  start_date: string | null;
  due_date: string | null;
  /** 最近一次提交审核的时间（工作实际完成时刻） */
  submitted_at: string | null;
  /** 完成时间 = 审批通过时生效的 submitted_at */
  completed_at: string | null;
  approved_by_role: Role | null;
  approved_by_user: string | null;
  delay_note: string | null;
  reject_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** /tasks 数据库分页行；附带本页展示所需的聚合工时，不加载全系统工时段。 */
export interface TaskListItem extends Task {
  actual_effort_hours: number;
  actual_day_count: number;
}

export interface TaskPage {
  items: TaskListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 实际工时段：进入 in_progress 开段、离开时闭段（触发器维护，客户端只读） */
export interface WorkSegment {
  id: string;
  task_id: string;
  developer_id: string | null;
  started_at: string;
  ended_at: string | null;
}

/** 每个测试任务对应一轮测试汇总；禅道保留用例与 Bug 明细。 */
export interface TestRound {
  id: string;
  test_task_id: string;
  round_no: number;
  test_method: 'case_based' | 'exploratory';
  result: 'pass' | 'fail' | null;
  blocked: boolean;
  planned_case_count: number | null;
  executed_case_count: number | null;
  verification_scope: string | null;
  verification_reason: string | null;
  bug_count: number;
  reopen_count: number;
  note: string | null;
  zentao_url: string | null;
  started_at: string | null;
  concluded_by: string | null;
  concluded_at: string | null;
}

/** v2.13：项目负责人审批与管理员异常代办的不可变审计记录。 */
export interface TaskApprovalAudit {
  id: string;
  task_id: string;
  project_id: string | null;
  project_owner_id: string | null;
  project_owner_name: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: Role;
  decision: 'approved' | 'rejected';
  from_status: 'review';
  to_status: 'in_progress' | 'done' | 'delayed_done';
  is_admin_proxy: boolean;
  admin_proxy_reason: string | null;
  decision_note: string | null;
  submitted_at_snapshot: string | null;
  completed_at_snapshot: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export type TestPlanSource = 'internal_project' | 'external_request';
export type TestCycleStatus =
  | 'requested' | 'returned' | 'accepted' | 'in_progress' | 'paused'
  | 'conclusion_pending' | 'passed' | 'failed' | 'cancelled';
export type ProjectTestState =
  | 'not_requested' | 'requested' | 'scheduled' | 'testing'
  | 'fixing' | 'passed' | 'no_test_approved';
export type NoTestStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type ConstructionStatus =
  | 'draft' | 'pending_schedule' | 'active' | 'paused'
  | 'pending_acceptance' | 'completed' | 'cancelled';

export interface TestPlanSummary {
  id: string;
  source: TestPlanSource;
  title: string;
  project_id: string | null;
  project_name: string | null;
  external_project_name: string | null;
  external_owner_name: string | null;
  version_name: string | null;
  test_scope: string;
  test_goal: string;
  priority: Priority;
  status: TestCycleStatus;
  test_team_id: string;
  test_team_name: string;
  recommended_owner_id: string | null;
  expected_start: string | null;
  expected_end: string | null;
  latest_cycle_id: string;
  cycle_no: number;
  stage_version: string;
  cycle_status: TestCycleStatus;
  main_tester_id: string | null;
  main_tester_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  planned_case_count: number;
  executed_case_count: number;
  passed_count: number;
  failed_count: number;
  blocked_count: number;
  bug_count: number;
  reopen_count: number;
  actual_hours: number;
  created_at: string;
  updated_at: string;
}

export interface TestExecutionBatch {
  id: string;
  cycle_id: string;
  activity_id: string | null;
  executed_on: string;
  executor_id: string;
  executor_name: string;
  environment_name: string;
  build_version: string;
  test_type: string;
  planned_count: number;
  executed_count: number;
  passed_count: number;
  failed_count: number;
  blocked_count: number;
  skipped_count: number;
  bug_count: number;
  reopen_count: number;
  smoke_passed: boolean | null;
  issue_summary: string | null;
  blocker_summary: string | null;
  risk_summary: string | null;
  zentao_url: string | null;
  created_at: string;
}

export interface TestReportStatus {
  id: string;
  cycle_id: string;
  report_type: string;
  report_name: string;
  is_required: boolean;
  status: 'pending' | 'issued' | 'not_issued';
  not_issued_reason: string | null;
}

export interface TestActivity {
  id: string;
  cycle_id: string;
  activity_type: string;
  title: string;
  owner_id: string;
  owner_name: string;
  planned_start: string;
  planned_end: string;
  planned_hours: number;
  actual_hours: number;
  status: string;
  task_id: string | null;
}

export interface TestCycle {
  id: string;
  plan_id: string;
  cycle_no: number;
  stage_version: string;
  scope_note: string | null;
  status: TestCycleStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_started_at: string | null;
  actual_completed_at: string | null;
  main_tester_id: string | null;
  main_tester_name: string | null;
  proposed_result: 'pass' | 'fail' | null;
  conclusion_scope: string | null;
  conclusion_completion: string | null;
  conclusion_new_issues: string | null;
  conclusion_legacy_issues: string | null;
  conclusion_blockers: string | null;
  conclusion_risks: string | null;
  release_recommendation: string | null;
  conclusion_return_reason: string | null;
  scope_tasks: Record<string, unknown>[];
  participants: Record<string, unknown>[];
  activities: TestActivity[];
  batches: TestExecutionBatch[];
  reports: TestReportStatus[];
  repair_tasks: Record<string, unknown>[];
}

export interface TestPlanDetail extends Omit<TestPlanSummary, 'latest_cycle_id' | 'cycle_no' | 'stage_version' | 'cycle_status'> {
  external_project_name: string | null;
  external_owner_name: string | null;
  deliverables: string | null;
  environment_note: string | null;
  related_url: string | null;
  zentao_url: string | null;
  created_by_name: string | null;
  cycles: TestCycle[];
  events: Record<string, unknown>[];
}

export interface ConstructionSummary {
  id: string;
  title: string;
  work_type: string;
  goal: string;
  priority: Priority;
  owner_id: string;
  owner_name: string;
  planned_start: string | null;
  planned_end: string | null;
  deliverables: string;
  acceptance_criteria: string;
  status: ConstructionStatus;
  task_count: number;
  done_count: number;
  planned_hours: number;
  actual_hours: number;
  created_at: string;
  updated_at: string;
}

export interface ConstructionDetail extends ConstructionSummary {
  resource_links: string | null;
  risk_note: string | null;
  blocker_note: string | null;
  adjustment_note: string | null;
  completion_note: string | null;
  participants: Record<string, unknown>[];
  tasks: Array<Record<string, unknown> & {
    id: string;
    task_id: string | null;
    title: string;
    owner_id: string;
    owner_name: string;
    planned_start: string;
    planned_end: string;
    planned_hours: number;
    actual_hours: number;
    progress: number;
    status: string;
  }>;
  events: Record<string, unknown>[];
}

export interface ProjectTestSummary {
  requires_testing: boolean;
  test_state: ProjectTestState;
  no_test_status: NoTestStatus;
  no_test_reason: string | null;
  no_test_related_url: string | null;
  no_test_decision_note: string | null;
  plan_id: string | null;
  plan_title: string | null;
  cycle_count: number;
  passed_cycle_count: number;
  failed_cycle_count: number;
  active_cycle_count: number;
  executed_count: number;
  bug_count: number;
  reopen_count: number;
  blocked_count: number;
  test_actual_hours: number;
  cycles: TestCycle[];
}

export const TEST_CYCLE_STATUS_LABEL: Record<TestCycleStatus, string> = {
  requested: '待确认排期',
  returned: '已退回',
  accepted: '待开始',
  in_progress: '测试中',
  paused: '已暂停',
  conclusion_pending: '结论待确认',
  passed: '测试通过',
  failed: '测试不通过',
  cancelled: '已取消',
};

export const TEST_TYPE_LABEL: Record<string, string> = {
  smoke: '冒烟测试',
  system: '系统测试',
  regression: '回归测试',
  performance: '性能测试',
  compatibility: '兼容性测试',
  security: '安全测试',
  other: '其他',
};

export const CONSTRUCTION_STATUS_LABEL: Record<ConstructionStatus, string> = {
  draft: '草稿',
  pending_schedule: '排期待确认',
  active: '进行中',
  paused: '已暂停',
  pending_acceptance: '成果待确认',
  completed: '已完成',
  cancelled: '已取消',
};

// ---------- 展示映射 ----------

export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  manager: '组长',
  user: '普通用户',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待处理',
  in_progress: '进行中',
  paused: '已挂起',
  testing: '测试中',
  review: '审核中',
  done: '已完成',
  delayed_done: '延期完成',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 3,
  high: 2,
  medium: 1,
  low: 0.5,
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '进行中',
  completed: '已完成',
  paused: '已暂停',
};

// 状态渐变色 / 标签色（附录 A）
export const STATUS_GRADIENT: Record<TaskStatus, string> = {
  todo: 'from-slate-400 to-slate-500',
  in_progress: 'from-blue-500 to-indigo-600',
  paused: 'from-violet-400 to-purple-500',
  testing: 'from-cyan-500 to-sky-600',
  review: 'from-amber-500 to-orange-500',
  done: 'from-emerald-500 to-teal-600',
  delayed_done: 'from-orange-500 to-amber-600',
};

/** 测试结论属于“质量结果”，不与时间风险共用颜色。 */
export const TEST_RESULT_LABEL: Record<'pass' | 'fail', string> = {
  pass: '测试通过',
  fail: '测试不通过',
};

export const TEST_RESULT_BADGE: Record<'pass' | 'fail', string> = {
  pass: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  fail: 'bg-red-500/10 text-red-700 ring-1 ring-inset ring-red-500/30 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30',
};

export const TEST_RESULT_GRADIENT: Record<'pass' | 'fail', string> = {
  pass: 'from-emerald-500 to-teal-600',
  fail: 'from-red-500 to-rose-600',
};

/** 时间风险统一使用橙色，避免与“测试不通过/错误/紧急”红色混淆。 */
export const TIMING_BADGE =
  'bg-orange-500/10 text-orange-700 ring-1 ring-inset ring-orange-500/35 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/30';

/** 图表等无法使用 Tailwind 类名的场景统一引用此色板。 */
export const SEMANTIC_COLOR = {
  neutral: '#94a3b8',
  active: '#3b82f6',
  testing: '#06b6d4',
  review: '#f59e0b',
  success: '#10b981',
  timing: '#f97316',
  failure: '#ef4444',
  paused: '#8b5cf6',
} as const;

export function taskGradient(task: Task): string {
  if (task.task_type === 'test' && task.test_result) return TEST_RESULT_GRADIENT[task.test_result];
  return STATUS_GRADIENT[task.status];
}

// 双主题徽章：浅色下深字浅底+描边，深色下亮字半透明底，保证两种主题对比度都清晰
export const STATUS_BADGE: Record<TaskStatus, string> = {
  todo: 'bg-slate-500/10 text-slate-700 ring-1 ring-inset ring-slate-500/30 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/30',
  in_progress: 'bg-blue-500/10 text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/30',
  paused: 'bg-violet-500/10 text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/30',
  testing: 'bg-cyan-500/10 text-cyan-700 ring-1 ring-inset ring-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-400/30',
  review: 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  done: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  delayed_done: 'bg-orange-500/10 text-orange-700 ring-1 ring-inset ring-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/30',
};

export const PRIORITY_BADGE: Record<Priority, string> = {
  urgent: 'bg-red-500/10 text-red-700 ring-1 ring-inset ring-red-500/40 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30',
  high: 'bg-orange-500/10 text-orange-700 ring-1 ring-inset ring-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/30',
  medium: 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  low: 'bg-slate-500/10 text-slate-700 ring-1 ring-inset ring-slate-500/30 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/30',
};
