import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ListTodo, LoaderCircle, Clock, CheckCircle2, CalendarClock, AlertTriangle, FlaskConical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import GanttChart from '../components/GanttChart';
import { isTaskOverdue } from '../lib/workload';
import { scopeTasks, defaultScope, type DevTeamLink } from '../lib/scope';
import { type Task, type Developer, type Project, type Team, type WorkSegment, type DashboardTaskCounts } from '../lib/types';

export default function Dashboard() {
  const { role, developer } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devTeams, setDevTeams] = useState<DevTeamLink[]>([]);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [counts, setCounts] = useState<DashboardTaskCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, d, p, tm, dt, ws, countResult] = await Promise.all([
      supabase.from('tasks').select('*'),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('developer_teams').select('*'),
      supabase.from('task_work_segments').select('*'),
      supabase.rpc('get_dashboard_task_counts'),
    ]);
    setTasks((t.data as Task[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setTeams((tm.data as Team[]) ?? []);
    setDevTeams((dt.data as DevTeamLink[]) ?? []);
    setSegments((ws.data as WorkSegment[]) ?? []);
    setCounts((countResult.data as DashboardTaskCounts | null) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 数据范围（v2.5.1 分层）：admin 全部；manager 我的小组并集；user 仅本人任务
  const scopedTasks = useMemo(
    () => scopeTasks(tasks, defaultScope(role), developer, teams, devTeams),
    [tasks, role, developer, devTeams, teams]
  );

  const cards = [
    { label: '总任务', value: counts?.total ?? 0, icon: <ListTodo size={18} />, cls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', preset: '' },
    { label: '进行中', value: counts?.in_progress ?? 0, icon: <LoaderCircle size={18} />, cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400', preset: 'in_progress' },
    { label: '测试中', value: counts?.testing_active ?? 0, icon: <FlaskConical size={18} />, cls: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400', preset: 'testing_active' },
    { label: '待我审批', value: counts?.pending_my_approval ?? 0, icon: <Clock size={18} />, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', preset: 'pending_my_approval' },
    { label: '已完成', value: counts?.completed ?? 0, icon: <CheckCircle2 size={18} />, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', preset: 'completed' },
    { label: '延期完成', value: counts?.delayed_done ?? 0, icon: <CalendarClock size={18} />, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', preset: 'delayed_done' },
    { label: '逾期', value: counts?.overdue ?? 0, icon: <AlertTriangle size={18} />, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', preset: 'overdue' },
  ];

  // 甘特图组件根据“显示已完成”和筛选项决定人员行；这里提供所有有范围内任务的人员
  const ganttDevs = useMemo(
    () => developers.filter((d) => scopedTasks.some((t) => t.developer_id === d.id)),
    [developers, scopedTasks]
  );

  if (loading) {
    return <div className="py-24 text-center text-slate-500">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="项目概览" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={() => navigate(`/tasks?scope=all${c.preset ? `&preset=${c.preset}` : ''}`)} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:bg-brand-500/5 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">{c.label}</span>
              <span className={`rounded-lg p-1.5 ${c.cls}`}>{c.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{c.value}</div>
          </button>
        ))}
      </div>

      {/* 甘特图 */}
      <GanttChart tasks={scopedTasks} developers={ganttDevs} projects={projects} segments={segments} />
    </div>
  );
}
