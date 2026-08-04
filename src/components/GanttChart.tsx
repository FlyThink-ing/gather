import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, EyeOff, Eye, ArrowLeftRight } from 'lucide-react';
import Select from './Select';
import DatePicker from './DatePicker';
import {
  type Task,
  type Developer,
  type Project,
  type TaskStatus,
  type Priority,
  type WorkSegment,
  STATUS_LABEL,
  PRIORITY_LABEL,
  STATUS_GRADIENT,
  STATUS_BADGE,
  PRIORITY_BADGE,
  TEST_RESULT_LABEL,
  TEST_RESULT_BADGE,
  TEST_RESULT_GRADIENT,
  TIMING_BADGE,
  taskGradient,
} from '../lib/types';
import { calcWorkload, taskTimingState, isUnfinished, planDays, actualDays } from '../lib/workload';

const DAY_W = 34; // 每天列宽 px
const BAR_H = 30; // 任务条行高 px
const LEFT_W = 200; // 左侧人员栏宽

const dstr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

interface Props {
  tasks: Task[];
  developers: Developer[];
  projects: Project[];
  /** 实际工时段（v2.4）：为空数组时不绘制实际投入层 */
  segments?: WorkSegment[];
}

const PLAN_H = 18; // 计划条高度
const ACTUAL_H = 5; // 实际投入条高度

export default function GanttChart({ tasks, developers, projects, segments = [] }: Props) {
  const navigate = useNavigate();
  const today = dstr(new Date());
  const [rangeStart, setRangeStart] = useState(dstr(addDays(new Date(), -14)));
  const [rangeEnd, setRangeEnd] = useState(dstr(addDays(new Date(), 16)));
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fProject, setFProject] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [qDev, setQDev] = useState('');
  const [hover, setHover] = useState<{ task: Task; x: number; y: number } | null>(null);

  // 日期列
  const days = useMemo(() => {
    const out: Date[] = [];
    const start = new Date(rangeStart);
    const end = new Date(rangeEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
    return out.slice(0, 120); // 上限防呆
  }, [rangeStart, rangeEnd]);

  // 月份分组（表头第一行）
  const months = useMemo(() => {
    const groups: { label: string; count: number }[] = [];
    for (const d of days) {
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.count += 1;
      else groups.push({ label, count: 1 });
    }
    return groups;
  }, [days]);

  // 筛选后的任务（用于画条）
  const visibleTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (!showCompleted && !isUnfinished(t)) return false;
        if (fProject && t.project_id !== fProject) return false;
        if (fPriority && t.priority !== fPriority) return false;
        if (fStatus && t.status !== fStatus) return false;
        return !!t.start_date && !!t.due_date;
      }),
    [tasks, showCompleted, fProject, fPriority, fStatus]
  );

  // 行：有当前可见任务的开发人员 + 「未分配」（显示已完成时包含仅有已完成任务的人员）
  // 支持按人员搜索；默认按负载分数降序（重点人员在最上面，人多时先看到最忙的）
  const rows = useMemo(() => {
    const list: { dev: Developer | null; tasks: Task[]; all: Task[]; score: number }[] = [];
    for (const dev of developers) {
      if (qDev && !dev.name.toLowerCase().includes(qDev.toLowerCase())) continue;
      const mine = tasks.filter((t) => t.developer_id === dev.id);
      const bars = visibleTasks.filter((t) => t.developer_id === dev.id);
      if (bars.length === 0) continue;
      list.push({ dev, tasks: bars, all: mine, score: calcWorkload(mine).score });
    }
    list.sort((a, b) => b.score - a.score);
    const orphanAll = tasks.filter((t) => !t.developer_id);
    const orphanBars = visibleTasks.filter((t) => !t.developer_id);
    if (!qDev && orphanBars.length > 0) {
      list.push({ dev: null, tasks: orphanBars, all: orphanAll, score: 0 });
    }
    return list;
  }, [developers, tasks, visibleTasks, qDev]);

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '-';

  // 每个任务的实际工时段（按开始时间排序）
  const segsByTask = useMemo(() => {
    const map = new Map<string, WorkSegment[]>();
    for (const s of segments) {
      const list = map.get(s.task_id) ?? [];
      list.push(s);
      map.set(s.task_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
    return map;
  }, [segments]);

  const dayIndex = (date: string) => {
    if (days.length === 0) return -1;
    const first = dstr(days[0]);
    const last = dstr(days[days.length - 1]);
    const clamped = date < first ? first : date > last ? last : date;
    return Math.round((new Date(clamped).getTime() - new Date(first).getTime()) / 86400000);
  };

  const totalW = days.length * DAY_W;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">任务甘特图</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={qDev}
            onChange={(e) => setQDev(e.target.value)}
            placeholder="搜索人员…"
            className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
          />
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs ${showFilters ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'}`}
          >
            <Filter size={13} /> 筛选
          </button>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            {showCompleted ? <Eye size={13} /> : <EyeOff size={13} />}
            {showCompleted ? '隐藏已完成' : '显示已完成'}
          </button>
          <DatePicker size="sm" className="w-32" value={rangeStart} onChange={setRangeStart} />
          <span className="text-slate-400 dark:text-slate-600">—</span>
          <DatePicker size="sm" className="w-32" value={rangeEnd} onChange={setRangeEnd} />
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5">
          <Select
            size="sm"
            className="w-32"
            value={fProject}
            onChange={setFProject}
            options={[{ value: '', label: '全部项目' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            size="sm"
            className="w-28"
            value={fPriority}
            onChange={setFPriority}
            options={[
              { value: '', label: '全部优先级' },
              ...(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
            ]}
          />
          <Select
            size="sm"
            className="w-28"
            value={fStatus}
            onChange={setFStatus}
            options={[
              { value: '', label: '全部状态' },
              ...(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 border-b border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <ArrowLeftRight size={13} />
        横向滚动查看日期；人员列表随页面统一滚动。
      </div>

      {/* 图区只在水平方向滚动，避免与页面纵向滚动嵌套。 */}
      <div className="overflow-x-auto overflow-y-visible">
        <div style={{ minWidth: LEFT_W + totalW }}>
          {/* 冻结表头（月 + 日） */}
          <div className="sticky top-0 z-20 bg-white dark:bg-slate-900">
          {/* 表头：月 */}
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400"
              style={{ width: LEFT_W }}
            >
              开发人员
            </div>
            {months.map((m) => (
              <div
                key={m.label}
                className="border-r border-slate-200 dark:border-slate-800 py-2 text-center text-xs font-medium text-slate-700 dark:text-slate-300"
                style={{ width: m.count * DAY_W }}
              >
                {m.label}
              </div>
            ))}
          </div>
          {/* 表头：日 */}
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <div className="sticky left-0 z-30 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" style={{ width: LEFT_W }} />
            {days.map((d) => {
              const wd = d.getDay();
              const isWeekend = wd === 0 || wd === 6;
              const isToday = dstr(d) === today;
              return (
                <div
                  key={dstr(d)}
                  className={`py-1 text-center text-[10px] leading-tight ${
                    isToday ? 'bg-brand-500/15 text-brand-500' : isWeekend ? 'bg-slate-100/80 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500' : 'text-slate-500'
                  }`}
                  style={{ width: DAY_W }}
                >
                  <div>{d.getDate()}</div>
                  <div>{'日一二三四五六'[wd]}</div>
                </div>
              );
            })}
          </div>
          </div>

          {/* 数据行 */}
          {rows.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-slate-500">当前范围内没有任务</div>
          )}
          {/* 用一个相对容器包住全部数据行，背景日列画成整块连续层（避免逐行渲染造成周末阴影断层） */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0" style={{ left: LEFT_W, width: totalW }}>
              {days.map((d, i) => {
                const wd = d.getDay();
                const isWeekend = wd === 0 || wd === 6;
                const isToday = dstr(d) === today;
                return (
                  <div
                    key={i}
                    className={`absolute inset-y-0 border-r border-slate-200/70 dark:border-slate-800/40 ${
                      isToday ? 'bg-brand-500/10' : isWeekend ? 'bg-slate-200/50 dark:bg-slate-800/30' : ''
                    }`}
                    style={{ left: i * DAY_W, width: DAY_W }}
                  />
                );
              })}
            </div>
          {rows.map(({ dev, tasks: bars, all }) => {
            const wl = calcWorkload(all);
            const rowH = Math.max(bars.length, 1) * (BAR_H + 6) + 12;
            return (
              <div key={dev?.id ?? 'unassigned'} className="flex border-b border-slate-200 dark:border-slate-800/60">
                {/* 左侧人员信息（按行高垂直居中） */}
                <div
                  className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5"
                  style={{ width: LEFT_W }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-xs font-medium text-brand-500">
                      {dev ? dev.name.slice(0, 1) : '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900 dark:text-slate-100">{dev?.name ?? '未分配'}</div>
                      <div className="truncate text-xs text-slate-500">{dev?.position ?? '待指派负责人'}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{wl.taskCount} 任务</span>
                    {wl.overdueCount > 0 && <span className="text-orange-600 dark:text-orange-400">⚠ {wl.overdueCount} 逾期</span>}
                    <span className={wl.colorCls}>{wl.label}</span>
                  </div>
                </div>

                {/* 时间轴 */}
                <div className="relative" style={{ width: totalW, height: rowH }}>
                  {/* 任务条：上层计划条 + 下层实际投入分段条 */}
                  {bars.map((t, idx) => {
                    const s = dayIndex(t.start_date!);
                    const e = dayIndex(t.due_date!);
                    if (s < 0 || e < 0) return null;
                    // 完全在范围外则跳过
                    if (t.due_date! < dstr(days[0]) || t.start_date! > dstr(days[days.length - 1])) return null;
                    const timing = taskTimingState(t);
                    const lineTop = 8 + idx * (BAR_H + 6);
                    const rangeFirst = dstr(days[0]);
                    const rangeLast = dstr(days[days.length - 1]);
                    const segs = segsByTask.get(t.id) ?? [];
                    return (
                      <React.Fragment key={t.id}>
                        <div
                          className={`absolute flex cursor-pointer items-center truncate rounded-md bg-gradient-to-r px-2 text-xs text-white shadow transition-shadow hover:shadow-lg hover:brightness-110 ${taskGradient(t)} ${timing ? 'ring-2 ring-orange-500' : ''}`}
                          style={{
                            left: s * DAY_W + 2,
                            width: Math.max((e - s + 1) * DAY_W - 4, DAY_W - 4),
                            top: lineTop,
                            height: PLAN_H,
                          }}
                          onMouseEnter={(ev) => setHover({ task: t, x: ev.clientX, y: ev.clientY })}
                          onMouseMove={(ev) => setHover({ task: t, x: ev.clientX, y: ev.clientY })}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => navigate(`/tasks?focus=${t.id}`)}
                        >
                          {t.title}
                        </div>
                        {segs.map((seg) => {
                          const sd = seg.started_at.slice(0, 10);
                          const ed = seg.ended_at ? seg.ended_at.slice(0, 10) : today;
                          if (ed < rangeFirst || sd > rangeLast) return null;
                          const ss = dayIndex(sd);
                          const se = dayIndex(ed);
                          return (
                            <div
                              key={seg.id}
                              title={`实际投入 ${sd} ~ ${seg.ended_at ? ed : '至今'}`}
                              className="absolute rounded-full bg-emerald-500 dark:bg-emerald-400"
                              style={{
                                left: ss * DAY_W + 2,
                                width: Math.max((se - ss + 1) * DAY_W - 4, 8),
                                top: lineTop + PLAN_H + 3,
                                height: ACTUAL_H,
                              }}
                            />
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-3 w-5 rounded bg-gradient-to-r ${STATUS_GRADIENT[s]}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded bg-slate-300 ring-2 ring-orange-500 dark:bg-slate-700" /> 逾期/延期
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-3 w-5 rounded bg-gradient-to-r ${TEST_RESULT_GRADIENT.fail}`} /> 测试不通过
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-emerald-500 dark:bg-emerald-400" /> 实际投入
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded bg-brand-500/20" /> 今天
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded bg-slate-100 dark:bg-slate-800" /> 周末
        </span>
      </div>

      {/* 悬停卡片 */}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 w-64 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-3 text-xs shadow-2xl"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 280),
            top: Math.min(hover.y + 14, window.innerHeight - 180),
          }}
        >
          <div className="mb-1.5 [overflow-wrap:anywhere] text-sm font-medium text-slate-900 dark:text-slate-100">{hover.task.title}</div>
          <div className="space-y-1.5 text-slate-500 dark:text-slate-400">
            <div>项目：{projectName(hover.task.project_id)}</div>
            {hover.task.task_type === 'test' && hover.task.linked_task_id && (
              <div className="text-cyan-700 dark:text-cyan-300">
                关联：{tasks.find((x) => x.id === hover.task.linked_task_id)?.title ?? '（开发任务）'}
              </div>
            )}
            <div>
              计划：{hover.task.start_date} ~ {hover.task.due_date}
              {planDays(hover.task.start_date, hover.task.due_date) != null && (
                <span className="ml-1 text-slate-400 dark:text-slate-500">
                  （{planDays(hover.task.start_date, hover.task.due_date)} 天）
                </span>
              )}
            </div>
            {(segsByTask.get(hover.task.id) ?? []).length > 0 && (
              <div className="flex gap-1">
                <span className="shrink-0">实际：</span>
                <span>
                  {(segsByTask.get(hover.task.id) ?? [])
                    .map((s) => `${s.started_at.slice(5, 10)} ~ ${s.ended_at ? s.ended_at.slice(5, 10) : '至今'}`)
                    .join('、')}
                  <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                    （已投入 {actualDays(segsByTask.get(hover.task.id) ?? [])} 天）
                  </span>
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[hover.task.status]}`}>
                {STATUS_LABEL[hover.task.status]}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_BADGE[hover.task.priority]}`}>
                {PRIORITY_LABEL[hover.task.priority]}
              </span>
              {hover.task.task_type === 'test' && hover.task.test_result && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TEST_RESULT_BADGE[hover.task.test_result]}`}>
                  {TEST_RESULT_LABEL[hover.task.test_result]}
                </span>
              )}
              {taskTimingState(hover.task) && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TIMING_BADGE}`}>
                  {taskTimingState(hover.task) === 'overdue'
                    ? `已逾期 ${Math.ceil((Date.now() - new Date(hover.task.due_date!).getTime()) / 86400000)} 天`
                    : '逾期完成'}
                </span>
              )}
            </div>
            <div className="border-t border-slate-200/70 dark:border-slate-700/50 pt-1.5 text-[11px] text-brand-500">
              点击任务条 → 跳转任务管理进行编辑 / 流转
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
