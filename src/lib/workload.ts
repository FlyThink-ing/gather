// 工作量综合评分（需求 v2 §6.3）与工期计算
import { PRIORITY_WEIGHT, type Task, type WorkSegment } from './types';

const DAY_MS = 86_400_000;
const taskDateFormat = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Asia/Shanghai' });

export const taskCalendarDate = (time: string | Date = new Date()): string => taskDateFormat.format(new Date(time));

/** 计划工期（天，含首尾）；日期缺失返回 null */
export function planDays(start: string | null, due: string | null): number | null {
  if (!start || !due || due < start) return null;
  return (Date.parse(due) - Date.parse(start)) / DAY_MS + 1;
}

export const taskPlanDays = (task: Pick<Task, 'start_date' | 'due_date' | 'planned_work_days'>) =>
  task.planned_work_days ?? planDays(task.start_date, task.due_date);

/** 项目实际/已运行周期（含首尾）；已完成项目缺失可靠完成时间时不猜测。 */
export function projectActualCycleDays(
  actualStartedAt: string | null,
  completedAt: string | null,
  isCompleted = false
): number | null {
  if (!actualStartedAt || (isCompleted && !completedAt)) return null;
  const from = actualStartedAt.slice(0, 10);
  const to = (completedAt ?? new Date().toISOString()).slice(0, 10);
  if (to < from) return null;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
}

export function formatEffort(hours: number): string {
  const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  return `${safe.toFixed(1)} 小时 / ${(safe / 8).toFixed(1)} 人天`;
}

type WorkDaySegment = Pick<WorkSegment, 'started_at' | 'ended_at' | 'voided_at'>;

function workDays(segments: WorkDaySegment[], openEnd: string | null) {
  const days = new Set<number>();
  for (const segment of segments) {
    if (segment.voided_at) continue;
    const endDate = segment.ended_at ? taskCalendarDate(segment.ended_at) : openEnd;
    if (!endDate) continue;
    const start = Date.parse(taskCalendarDate(segment.started_at));
    const end = Date.parse(endDate);
    for (let day = start; day <= end; day += DAY_MS) days.add(day);
  }
  return days;
}

/** 实际投入天数：工时段覆盖的自然日去重计数（可包含尚未结束的工时段）。 */
export function actualDays(segments: WorkDaySegment[], includeOpen = true): number {
  return workDays(segments, includeOpen ? taskCalendarDate() : null).size;
}

export function resumeTaskDueDate(dueDate: string, plannedDays: number, segments: WorkDaySegment[], resumeDate: string): string {
  const days = workDays(segments, null);
  const resumeTime = Date.parse(resumeDate);
  const remainingDays = plannedDays - days.size;
  const daysAfterResume = Math.max(0, remainingDays - (days.has(resumeTime) ? 0 : 1));
  const newDueDate = new Date(resumeTime + daysAfterResume * DAY_MS).toISOString().slice(0, 10);
  return newDueDate > dueDate ? newDueDate : dueDate;
}

export const isUnfinished = (t: Pick<Task, 'status'>) => t.status !== 'done' && t.status !== 'delayed_done';

export type TaskTimingState = 'overdue' | 'delayed' | null;
type TaskTimingFields = Pick<Task, 'status' | 'due_date' | 'completed_at'>;

/**
 * 已挂起和待审核任务不计入逾期。
 * overdue = 执行阶段超过截止日期；delayed = 完成时间超过截止日期。
 */
export const taskTimingState = (t: TaskTimingFields): TaskTimingState => {
  if (t.status === 'paused' || t.status === 'review' || !t.due_date) return null;
  const completedDate = t.completed_at ? taskCalendarDate(t.completed_at) : null;
  if (t.status === 'delayed_done' || (completedDate && completedDate > t.due_date)) return 'delayed';
  const today = taskCalendarDate();
  if (t.due_date < today && isUnfinished(t)) return 'overdue';
  return null;
};

export const isTaskOverdue = (t: TaskTimingFields) => taskTimingState(t) === 'overdue';

export interface Workload {
  score: number;
  taskCount: number;
  overdueCount: number;
  level: 'low' | 'medium' | 'high' | 'overload';
  label: string;
  colorCls: string;
}

export function calcWorkload(tasks: Task[]): Workload {
  const unfinished = tasks.filter(isUnfinished);
  const n = unfinished.length;

  // 任务数量分（满分40）
  const countScore = n >= 7 ? 40 : n >= 5 ? 30 : n >= 3 ? 20 : 10;
  // 优先级权重分
  const priorityScore = unfinished.reduce((s, t) => s + PRIORITY_WEIGHT[t.priority], 0);
  // 延期任务分
  const overdueCount = unfinished.filter(isTaskOverdue).length;
  const overdueScore = overdueCount * 10;

  const score = n === 0 ? 0 : countScore + priorityScore + overdueScore;

  let level: Workload['level'];
  let label: string;
  let colorCls: string;
  if (score > 100) {
    level = 'overload'; label = '超负荷'; colorCls = 'text-red-600 dark:text-red-400';
  } else if (score > 60) {
    level = 'high'; label = '高负载'; colorCls = 'text-orange-600 dark:text-orange-400';
  } else if (score > 30) {
    level = 'medium'; label = '中负载'; colorCls = 'text-yellow-600 dark:text-yellow-400';
  } else {
    level = 'low'; label = '低负载'; colorCls = 'text-emerald-600 dark:text-emerald-400';
  }

  return { score, taskCount: n, overdueCount, level, label, colorCls };
}
