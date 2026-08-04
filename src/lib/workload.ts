// 工作量综合评分（需求 v2 §6.3）与工期计算
import { PRIORITY_WEIGHT, type Task, type WorkSegment } from './types';

/** 计划工期（天，含首尾）；日期缺失返回 null */
export function planDays(start: string | null, due: string | null): number | null {
  if (!start || !due || due < start) return null;
  return Math.round((new Date(due).getTime() - new Date(start).getTime()) / 86400000) + 1;
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

/** 实际投入天数：工时段覆盖的自然日去重计数（开段算到今天） */
export function actualDays(segs: WorkSegment[]): number {
  const today = new Date().toISOString().slice(0, 10);
  const days = new Set<string>();
  for (const seg of segs) {
    const from = seg.started_at.slice(0, 10);
    const to = seg.ended_at ? seg.ended_at.slice(0, 10) : today;
    const d = new Date(from);
    for (let i = 0; i < 366 && d.toISOString().slice(0, 10) <= to; i++) {
      days.add(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }
  return days.size;
}

export const isUnfinished = (t: Task) => t.status !== 'done' && t.status !== 'delayed_done';

export type TaskTimingState = 'overdue' | 'delayed' | null;

/**
 * 时间状态与任务/测试结果分离：
 * overdue = 尚未完成且已超过截止日期；delayed = 完成时间超过截止日期。
 */
export const taskTimingState = (t: Task): TaskTimingState => {
  if (!t.due_date) return null;
  const completedDate = t.completed_at?.slice(0, 10);
  if (t.status === 'delayed_done' || (completedDate && completedDate > t.due_date)) return 'delayed';
  const today = new Date().toISOString().slice(0, 10);
  if (t.due_date < today && isUnfinished(t)) return 'overdue';
  return null;
};

export const isTaskOverdue = (t: Task) => taskTimingState(t) === 'overdue';

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
