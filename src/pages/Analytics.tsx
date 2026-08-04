import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CheckCircle2, AlertTriangle, Clock, Timer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Select from '../components/Select';
import { planDays, actualDays, isTaskOverdue } from '../lib/workload';
import { scopeTasks, defaultScope } from '../lib/scope';
import {
  type Task, type Developer, type Project, type Team, type TaskStatus, type Priority, type WorkSegment, type TestRound,
  STATUS_LABEL, PRIORITY_LABEL, SEMANTIC_COLOR,
} from '../lib/types';

interface DevTeam { developer_id: string; team_id: string }

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: SEMANTIC_COLOR.neutral,
  in_progress: SEMANTIC_COLOR.active,
  paused: SEMANTIC_COLOR.paused,
  testing: SEMANTIC_COLOR.testing,
  review: SEMANTIC_COLOR.review,
  done: SEMANTIC_COLOR.success,
  delayed_done: SEMANTIC_COLOR.timing,
};

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: SEMANTIC_COLOR.failure,
  high: SEMANTIC_COLOR.timing,
  medium: SEMANTIC_COLOR.review,
  low: SEMANTIC_COLOR.neutral,
};

const card = 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5';
const cardTitle = 'mb-4 text-base font-semibold text-slate-900 dark:text-white';

type RangeKey = 'all' | '7d' | '30d';

export default function Analytics() {
  const { role, developer } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devTeams, setDevTeams] = useState<DevTeam[]>([]);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [testRounds, setTestRounds] = useState<TestRound[]>([]);
  const [loading, setLoading] = useState(true);
  // 筛选
  const [range, setRange] = useState<RangeKey>('all');
  const [fTeam, setFTeam] = useState('');
  const [fType, setFType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [t, d, p, tm, dt, ws, tr] = await Promise.all([
      supabase.from('tasks').select('*'),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('developer_teams').select('*'),
      supabase.from('task_work_segments').select('*'),
      supabase.from('test_rounds').select('*'),
    ]);
    setTasks((t.data as Task[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setTeams((tm.data as Team[]) ?? []);
    setDevTeams((dt.data as DevTeam[]) ?? []);
    setSegments((ws.data as WorkSegment[]) ?? []);
    setTestRounds((tr.data as TestRound[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 权限范围（共享工具，v2.5.1）：admin 全部；manager 我的小组并集（本页仅这两种角色可进）
  const roleScoped = useMemo(
    () => scopeTasks(tasks, defaultScope(role), developer, teams, devTeams),
    [tasks, role, developer, devTeams, teams]
  );

  // 筛选：时间范围（计划窗口有交集，或完成时间落在窗口内）+ 小组
  const scoped = useMemo(() => {
    let list = roleScoped;
    if (fType) list = list.filter((t) => t.task_type === fType);
    if (fTeam) list = list.filter((t) => t.team_id === fTeam);
    if (range !== 'all') {
      const days = range === '7d' ? 7 : 30;
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => {
        const planOverlap = !!t.start_date && !!t.due_date && t.start_date <= toStr && t.due_date >= fromStr;
        const doneInRange = !!t.completed_at && t.completed_at.slice(0, 10) >= fromStr;
        return planOverlap || doneInRange;
      });
    }
    return list;
  }, [roleScoped, fType, fTeam, range]);

  // 测试质量（在角色/时间/小组范围内看全部测试任务，不受类型筛选影响）
  const testStats = useMemo(() => {
    let list = roleScoped.filter((t) => t.task_type === 'test');
    if (fTeam) list = list.filter((t) => t.team_id === fTeam);
    let fromStr: string | null = null;
    const toStr = new Date().toISOString().slice(0, 10);
    if (range !== 'all') {
      const days = range === '7d' ? 7 : 30;
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      fromStr = from.toISOString().slice(0, 10);
      list = list.filter((t) => {
        const planOverlap = !!t.start_date && !!t.due_date && t.start_date <= toStr && t.due_date >= fromStr!;
        const doneInRange = !!t.completed_at && t.completed_at.slice(0, 10) >= fromStr!;
        return t.test_result ? doneInRange : planOverlap;
      });
    }
    const concluded = list.filter((t) => t.test_result);
    const failed = concluded.filter((t) => t.test_result === 'fail').length;
    const taskById = new Map(list.map((t) => [t.id, t]));
    const rounds = testRounds.filter((r) => {
      const task = taskById.get(r.test_task_id);
      if (!task) return false;
      if (!fromStr) return true;
      if (r.result) return !!r.concluded_at && r.concluded_at.slice(0, 10) >= fromStr && r.concluded_at.slice(0, 10) <= toStr;
      return !!task.start_date && !!task.due_date && task.start_date <= toStr && task.due_date >= fromStr;
    });
    const concludedRounds = rounds.filter((r) => r.result);
    const caseBasedRounds = concludedRounds.filter((r) => (r.test_method ?? 'case_based') === 'case_based' && r.executed_case_count != null);
    const exploratoryRounds = concludedRounds.filter((r) => r.test_method === 'exploratory');
    const plannedCases = caseBasedRounds.reduce((sum, r) => sum + (r.planned_case_count ?? 0), 0);
    const executedCases = caseBasedRounds.reduce((sum, r) => sum + (r.executed_case_count ?? 0), 0);
    const bugs = concludedRounds.reduce((sum, r) => sum + r.bug_count, 0);
    const caseBasedBugs = caseBasedRounds.reduce((sum, r) => sum + r.bug_count, 0);
    const reopen = concludedRounds.reduce((sum, r) => sum + r.reopen_count, 0);
    const coveredConclusions = concluded.filter((t) => testRounds.some((r) => r.test_task_id === t.id && r.result)).length;
    return {
      total: list.length,
      active: list.filter((t) => ['todo', 'in_progress', 'paused'].includes(t.status)).length,
      passed: concluded.length - failed,
      failed,
      failRate: concluded.length > 0 ? Math.round((failed / concluded.length) * 100) : null,
      plannedCases,
      executedCases,
      executionRate: plannedCases > 0 ? Math.round((executedCases / plannedCases) * 100) : null,
      bugs,
      bugPer100: executedCases > 0 ? Math.round((caseBasedBugs / executedCases) * 1000) / 10 : null,
      reopen,
      blocked: concludedRounds.filter((r) => r.blocked).length,
      caseBasedRounds: caseBasedRounds.length,
      exploratoryRounds: exploratoryRounds.length,
      coverage: concluded.length > 0 ? Math.round((coveredConclusions / concluded.length) * 100) : null,
      coveredConclusions,
      concludedCount: concluded.length,
    };
  }, [roleScoped, fTeam, range, testRounds]);

  const segsByTask = useMemo(() => {
    const map = new Map<string, WorkSegment[]>();
    for (const s of segments) {
      const list = map.get(s.task_id) ?? [];
      list.push(s);
      map.set(s.task_id, list);
    }
    return map;
  }, [segments]);

  const total = scoped.length;
  const completedTasks = scoped.filter((t) => t.status === 'done' || t.status === 'delayed_done');
  const completed = completedTasks.length;
  const onTime = scoped.filter((t) => t.status === 'done').length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const onTimeRate = completed > 0 ? Math.round((onTime / completed) * 100) : null;
  const overdueNow = scoped.filter(isTaskOverdue).length;
  const reviewBacklog = scoped.filter((t) => t.status === 'review').length;

  // 工期偏差：已完成任务的平均计划 vs 平均实际投入
  const durations = completedTasks
    .map((t) => ({ plan: planDays(t.start_date, t.due_date), actual: actualDays(segsByTask.get(t.id) ?? []) }))
    .filter((x) => x.plan != null && x.actual > 0);
  const avgPlan = durations.length ? durations.reduce((s, x) => s + x.plan!, 0) / durations.length : null;
  const avgActual = durations.length ? durations.reduce((s, x) => s + x.actual, 0) / durations.length : null;

  // 状态 / 优先级分布
  const statusDist = (Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => ({
    status: s,
    label: STATUS_LABEL[s],
    count: scoped.filter((t) => t.status === s).length,
  }));
  const priorityDist = (Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({
    name: PRIORITY_LABEL[p],
    priority: p,
    数量: scoped.filter((t) => t.priority === p).length,
  }));

  // 项目进度（按完成率排序，分段：完成/进行中/审核中/其他）
  const projectProgress = projects
    .map((p) => {
      const mine = scoped.filter((t) => t.project_id === p.id);
      const done = mine.filter((t) => t.status === 'done' || t.status === 'delayed_done').length;
      const doing = mine.filter((t) => t.status === 'in_progress').length;
      const reviewing = mine.filter((t) => t.status === 'review').length;
      const rest = mine.length - done - doing - reviewing;
      return {
        project: p,
        total: mine.length,
        done, doing, reviewing, rest,
        rate: mine.length > 0 ? Math.round((done / mine.length) * 100) : 0,
      };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.rate - a.rate || b.total - a.total);

  // 成员效率：完成率 + 按时率 + 实际投入天数
  const efficiency = developers
    .map((d) => {
      const mine = scoped.filter((t) => t.developer_id === d.id);
      const doneAll = mine.filter((t) => t.status === 'done' || t.status === 'delayed_done');
      const doneOnTime = mine.filter((t) => t.status === 'done').length;
      const invested = actualDays(mine.flatMap((t) => segsByTask.get(t.id) ?? []));
      return {
        dev: d,
        total: mine.length,
        done: doneAll.length,
        rate: mine.length > 0 ? Math.round((doneAll.length / mine.length) * 100) : 0,
        onTimeRate: doneAll.length > 0 ? Math.round((doneOnTime / doneAll.length) * 100) : null,
        invested,
      };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.rate - a.rate || b.done - a.done);

  if (loading) return <div className="py-24 text-center text-slate-500">加载中…</div>;

  const tooltipStyle = {
    contentStyle: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: '#e2e8f0' },
  };

  const insight = [
    {
      label: '按时完成率',
      value: onTimeRate != null ? `${onTimeRate}%` : '—',
      note: completed > 0 ? `已完成 ${completed} 个，其中按时 ${onTime} 个` : '暂无已完成任务',
      icon: <CheckCircle2 size={18} />,
      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: '逾期风险',
      value: `${overdueNow}`,
      note: overdueNow > 0 ? '未完成且已超期，需立即跟进' : '当前没有逾期任务',
      icon: <AlertTriangle size={18} />,
      cls: overdueNow > 0 ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    },
    {
      label: '待审核积压',
      value: `${reviewBacklog}`,
      note: reviewBacklog > 0 ? '等待审批放行，积压会拖慢完成率' : '审批队列已清空',
      icon: <Clock size={18} />,
      cls: reviewBacklog > 0 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    },
    {
      label: '工期偏差（已完成）',
      value:
        avgPlan != null && avgActual != null
          ? `${avgActual < avgPlan ? '提前' : avgActual > avgPlan ? '超出' : '持平'} ${Math.abs(avgActual - avgPlan).toFixed(1)} 天`
          : '—',
      note:
        avgPlan != null
          ? `平均计划 ${avgPlan.toFixed(1)} 天 · 平均实际投入 ${avgActual!.toFixed(1)} 天`
          : '完成任务累积后可见',
      icon: <Timer size={18} />,
      cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    },
  ];

  const segLegend = [
    { label: '已完成', color: STATUS_COLOR.done },
    { label: '进行中', color: STATUS_COLOR.in_progress },
    { label: '审核中', color: STATUS_COLOR.review },
    { label: '待处理/挂起', color: STATUS_COLOR.todo },
  ];

  return (
    <div>
      <PageHeader
        title="数据分析"
        actions={
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              className="w-24"
              value={fType}
              onChange={setFType}
              options={[
                { value: '', label: '全部类型' },
                { value: 'dev', label: '开发' },
                { value: 'test', label: '测试' },
              ]}
            />
            <Select
              size="sm"
              className="w-28"
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
              options={[
                { value: 'all', label: '全部时间' },
                { value: '7d', label: '近 7 天' },
                { value: '30d', label: '近 30 天' },
              ]}
            />
            <Select
              size="sm"
              className="w-32"
              value={fTeam}
              onChange={setFTeam}
              options={[{ value: '', label: '全部小组' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </div>
        }
      />

      {/* 洞察卡 */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {insight.map((c) => (
          <div key={c.label} className={card}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">{c.label}</span>
              <span className={`rounded-lg p-1.5 ${c.cls}`}>{c.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{c.value}</div>
            <div className="mt-1 text-xs text-slate-500">{c.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 任务状态分布 */}
        <div className={card}>
          <h2 className={cardTitle}>任务状态分布</h2>
          <div className="space-y-3">
            {statusDist.map((s) => {
              const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={s.status}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{s.label}</span>
                    <span className="text-slate-500">{s.count} 个 · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: STATUS_COLOR[s.status] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 整体完成率 */}
        <div className={card}>
          <h2 className={cardTitle}>整体完成率</h2>
          <div className="relative mx-auto" style={{ width: 220, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: '已完成', value: completed },
                    { name: '未完成', value: Math.max(total - completed, total === 0 ? 1 : 0) },
                  ]}
                  innerRadius={72}
                  outerRadius={95}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                >
                  <Cell fill="#10b981" />
                  <Cell fill="rgba(148,163,184,0.18)" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-slate-900 dark:text-white">{completionRate}%</span>
              <span className="mt-1 text-xs text-slate-500">{completed} / {total} 已完成</span>
              {onTimeRate != null && (
                <span className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">按时率 {onTimeRate}%</span>
              )}
            </div>
          </div>
        </div>

        {/* 优先级分布 */}
        <div className={card}>
          <h2 className={cardTitle}>优先级分布</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={priorityDist} layout="vertical" barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={44} tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="数量" radius={[0, 4, 4, 0]}>
                {priorityDist.map((x) => (
                  <Cell key={x.priority} fill={PRIORITY_COLOR[x.priority]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 项目进度 */}
        <div className={card}>
          <h2 className={cardTitle}>项目进度</h2>
          {projectProgress.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">暂无数据</div>
          ) : (
            <>
              <div className="space-y-4">
                {projectProgress.map((x) => (
                  <div key={x.project.id}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate text-slate-700 dark:text-slate-300">{x.project.name}</span>
                      <span className="shrink-0 text-slate-500">
                        {x.done}/{x.total} 完成 · <span className="font-medium text-slate-800 dark:text-slate-200">{x.rate}%</span>
                      </span>
                    </div>
                    <div
                      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
                      title={`已完成 ${x.done} · 进行中 ${x.doing} · 审核中 ${x.reviewing} · 待处理/挂起 ${x.rest}`}
                    >
                      {x.done > 0 && <div className="rounded-full" style={{ flex: x.done, background: STATUS_COLOR.done }} />}
                      {x.doing > 0 && <div className="rounded-full" style={{ flex: x.doing, background: STATUS_COLOR.in_progress }} />}
                      {x.reviewing > 0 && <div className="rounded-full" style={{ flex: x.reviewing, background: STATUS_COLOR.review }} />}
                      {x.rest > 0 && <div className="rounded-full" style={{ flex: x.rest, background: 'rgba(148,163,184,0.35)' }} />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-200/70 dark:border-slate-800 pt-3 text-xs text-slate-500">
                {segLegend.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: l.color }} /> {l.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 测试质量（v2.5） */}
      <div className={`${card} mt-4`}>
        <h2 className={cardTitle}>测试质量</h2>
        {testStats.total === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">暂无测试任务（开发任务提测后自动生成）</div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <QualityValue label="测试任务" value={testStats.total} />
              <QualityValue label="进行中" value={testStats.active} tone="cyan" />
              <QualityValue label="通过" value={testStats.passed} tone="success" />
              <QualityValue label="打回（不通过）" value={testStats.failed} tone="danger" />
              <div className="min-w-56 flex-1">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-500">打回率（不通过 / 已出结论）</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {testStats.failRate != null ? `${testStats.failRate}%` : '—'}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${testStats.failRate ?? 0}%` }} />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">禅道测试汇总</h3>
                <span className="text-xs text-slate-500">
                  覆盖 {testStats.coveredConclusions} / {testStats.concludedCount} 个已结论任务
                  {testStats.coverage != null ? `（${testStats.coverage}%）` : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-9">
                <QualityMetric label="标准轮次" value={testStats.caseBasedRounds} />
                <QualityMetric label="快速验证轮次" value={testStats.exploratoryRounds} />
                <QualityMetric label="计划用例" value={testStats.plannedCases} />
                <QualityMetric label="实际执行" value={testStats.executedCases} note={testStats.executionRate != null ? `执行率 ${testStats.executionRate}%` : '执行率 —'} />
                <QualityMetric label="新增 Bug" value={testStats.bugs} />
                <QualityMetric label="Bug / 百用例" value={testStats.bugPer100 ?? '—'} />
                <QualityMetric label="Reopen" value={testStats.reopen} />
                <QualityMetric label="阻断轮次" value={testStats.blocked} danger={testStats.blocked > 0} />
                <QualityMetric label="汇总覆盖率" value={testStats.coverage != null ? `${testStats.coverage}%` : '—'} />
              </div>
              {testStats.coveredConclusions < testStats.concludedCount && (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                  历史未录入汇总的测试任务不按 0 参与用例和 Bug 统计。
                </p>
              )}
              {testStats.exploratoryRounds > 0 && (
                <p className="mt-2 text-xs text-violet-600 dark:text-violet-400">
                  快速 / 探索性验证计入结论、Bug、Reopen 和阻断统计，但不计入用例执行率与每百用例 Bug 数。
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 团队成员效率 */}
      <div className={`${card} mt-4`}>
        <h2 className={cardTitle}>团队成员效率</h2>
        {efficiency.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">暂无数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">成员</th>
                  <th className="py-2 pr-3 font-medium">完成率</th>
                  <th className="py-2 pr-3 font-medium">按时率</th>
                  <th className="py-2 pr-3 font-medium">实际投入</th>
                  <th className="py-2 font-medium">任务</th>
                </tr>
              </thead>
              <tbody>
                {efficiency.map((x, i) => (
                  <tr key={x.dev.id} className="border-b border-slate-200/70 dark:border-slate-800/60">
                    <td className={`py-2.5 pr-3 text-sm font-semibold ${i < 3 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                      {i + 1}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-xs font-medium text-brand-500">
                          {x.dev.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-slate-800 dark:text-slate-200">{x.dev.name}</div>
                          <div className="truncate text-xs text-slate-500">{x.dev.position ?? ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                            style={{ width: `${x.rate}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-200">{x.rate}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      {x.onTimeRate == null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <span className={x.onTimeRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : x.onTimeRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
                          {x.onTimeRate}%
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500 dark:text-slate-400">
                      {x.invested > 0 ? `${x.invested} 天` : '—'}
                    </td>
                    <td className="py-2.5 text-xs text-slate-500 dark:text-slate-400">
                      {x.done}/{x.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function QualityValue({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'cyan' | 'success' | 'danger' }) {
  const cls = tone === 'cyan'
    ? 'text-cyan-600 dark:text-cyan-400'
    : tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'danger'
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-900 dark:text-white';
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function QualityMetric({ label, value, note, danger = false }: { label: string; value: number | string; note?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 px-3 py-2.5 dark:bg-slate-800/70">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${danger ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}
