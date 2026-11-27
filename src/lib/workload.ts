// 工作量综合评分（需求 v2 §6.3）与工期计算
import { PRIORITY_WEIGHT, type Task, type WorkSegment } from './types';

const DAY_MS = 86_400_000;
const taskDateFormat = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Asia/Shanghai' });

export const taskCalendarDate = (time: string | Date = new Date()): string => taskDateFormat.format(new Date(time));

const isoDay = (day: number) => new Date(day).toISOString().slice(0, 10);

export function taskWeekends(start: string, due: string) {
  const weekends: { date: string; label: string }[][] = [];
  if (!start || !due || due < start) return weekends;

  const first = Date.parse(start);
  const last = Date.parse(due);
  const weekday = new Date(first).getUTCDay();
  const firstSaturday = first + (weekday === 0 ? -1 : 6 - weekday) * DAY_MS;
  for (let saturday = firstSaturday; saturday <= last; saturday += 7 * DAY_MS) {
    const weekend = [];
    if (saturday >= first) weekend.push({ date: isoDay(saturday), label: '周六' });
    const sunday = saturday + DAY_MS;
    if (sunday <= last) weekend.push({ date: isoDay(sunday), label: '周日' });
    weekends.push(weekend);
  }
  return weekends;
}

/** 计划工期含首尾。没有值班记录的旧任务沿用自然日。 */
export function planDays(start: string | null, due: string | null, weekendWorkDates: readonly string[] | null = null): number | null {
  if (!start || !due || due < start) return null;
  const calendarDays = (Date.parse(due) - Date.parse(start)) / DAY_MS + 1;
  if (weekendWorkDates === null) return calendarDays;

  const selected = new Set(weekendWorkDates);
  const daysOff = taskWeekends(start, due).flat().filter(({ date }) => !selected.has(date)).length;
  return calendarDays - daysOff;
}

export const taskPlanDays = (task: Pick<Task, 'start_date' | 'due_date' | 'planned_work_days' | 'weekend_work_dates'>) =>
  task.planned_work_days ?? planDays(task.start_date, task.due_date, task.weekend_work_dates);

export function taskScheduleExtension(task: Pick<Task, 'start_date' | 'due_date' | 'planned_work_days' | 'weekend_work_dates' | 'original_due_date'>) {
  const { start_date, due_date, planned_work_days, weekend_work_dates, original_due_date } = task;
  if (!start_date || !due_date || planned_work_days == null) return null;
  const originalDueDate = original_due_date ?? (weekend_work_dates == null
    ? isoDay(Date.parse(start_date) + (planned_work_days - 1) * DAY_MS)
    : null);
  if (!originalDueDate) return null;
  const extensionDays = (Date.parse(due_date) - Date.parse(originalDueDate)) / DAY_MS;
  return extensionDays > 0 ? { originalDueDate, dueDate: due_date, extensionDays } : null;
}

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

/** 实际投入天数：合并工时段覆盖的自然日区间，首尾均计入。 */
export function actualDays(segments: WorkDaySegment[], includeOpen = true): number {
  const openEnd = includeOpen ? taskCalendarDate() : null;
  const ranges: { start: number; end: number }[] = [];
  for (const segment of segments) {
    if (segment.voided_at) continue;
    const started = new Date(segment.started_at);
    const ended = segment.ended_at ? new Date(segment.ended_at) : null;
    if (!Number.isFinite(started.getTime())) continue;
    if (ended && (!Number.isFinite(ended.getTime()) || ended < started)) continue;
    const endDate = ended ? taskCalendarDate(ended) : openEnd;
    if (!endDate) continue;
    const start = Date.parse(taskCalendarDate(started));
    const end = Date.parse(endDate);
    if (start <= end) ranges.push({ start, end });
  }

  ranges.sort((first, second) => first.start - second.start);
  let days = 0;
  let countedThrough = -Infinity;
  for (const { start, end } of ranges) {
    if (end <= countedThrough) continue;
    const firstUncounted = Math.max(start, countedThrough + DAY_MS);
    days += (end - firstUncounted) / DAY_MS + 1;
    countedThrough = end;
  }
  return days;
}

export function taskResumeExtension(dueDate: string, plannedDays: number, segments: WorkDaySegment[], resumeDate: string) {
  const pausedAt = segments.reduce((latest, segment) =>
    !segment.voided_at && segment.ended_at ? Math.max(latest, Date.parse(segment.ended_at)) : latest, -Infinity);
  if (!Number.isFinite(pausedAt)) return null;
  const pauseDate = taskCalendarDate(new Date(pausedAt));
  if (pauseDate >= resumeDate || pauseDate > dueDate) return null;

  const remainingDays = plannedDays - actualDays(segments, false);
  const daysAfterResume = Math.max(0, remainingDays - 1);
  const newDueDate = new Date(Date.parse(resumeDate) + daysAfterResume * DAY_MS).toISOString().slice(0, 10);
  return newDueDate > dueDate ? { dueDate: newDueDate, pauseDate } : null;
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
