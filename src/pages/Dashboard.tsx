import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListTodo, LoaderCircle, Clock, CheckCircle2, CalendarClock, AlertTriangle, FlaskConical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import GanttChart from '../components/GanttChart';
import { isTaskOverdue } from '../lib/workload';
import { scopeTasks, defaultScope, type DevTeamLink } from '../lib/scope';
import { type Task, type Developer, type Project, type Team, type WorkSegment } from '../lib/types';

export default function Dashboard() {
  const { role, developer } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devTeams, setDevTeams] = useState<DevTeamLink[]>([]);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, d, p, tm, dt, ws] = await Promise.all([
      supabase.from('tasks').select('*'),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('projects').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('developer_teams').select('*'),
      supabase.from('task_work_segments').select('*'),
    ]);
    setTasks((t.data as Task[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setTeams((tm.data as Team[]) ?? []);
    setDevTeams((dt.data as DevTeamLink[]) ?? []);
    setSegments((ws.data as WorkSegment[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 数据范围（v2.5.1 分层）：admin 全部；manager 我的小组并集；user 仅本人任务
  const scopedTasks = useMemo(
    () => scopeTasks(tasks, defaultScope(role), developer, teams, devTeams),
    [tasks, role, developer, devTeams, teams]
  );

  const stats = useMemo(() => {
    const s = {
      total: scopedTasks.length,
      inProgress: 0, testing: 0, review: 0, done: 0, delayedDone: 0, overdue: 0,
    };
    for (const t of scopedTasks) {
      if (t.status === 'in_progress') s.inProgress++;
      if (t.status === 'testing' || (t.task_type === 'test' && ['todo', 'in_progress', 'paused'].includes(t.status))) s.testing++;
      if (t.status === 'review') s.review++;
      if (t.status === 'done') s.done++;
      if (t.status === 'delayed_done') s.delayedDone++;
      if (isTaskOverdue(t)) s.overdue++;
    }
    return s;
  }, [scopedTasks]);

  const cards = [
    { label: '总任务', value: stats.total, icon: <ListTodo size={18} />, cls: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
    { label: '进行中', value: stats.inProgress, icon: <LoaderCircle size={18} />, cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
    { label: '测试中', value: stats.testing, icon: <FlaskConical size={18} />, cls: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' },
    { label: '待审核', value: stats.review, icon: <Clock size={18} />, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    { label: '已完成', value: stats.done, icon: <CheckCircle2 size={18} />, cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    { label: '延期完成', value: stats.delayedDone, icon: <CalendarClock size={18} />, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
    { label: '逾期', value: stats.overdue, icon: <AlertTriangle size={18} />, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
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
          <div key={c.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">{c.label}</span>
              <span className={`rounded-lg p-1.5 ${c.cls}`}>{c.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{c.value}</div>
          </div>
        ))}
      </div>

      {/* 甘特图 */}
      <GanttChart tasks={scopedTasks} developers={ganttDevs} projects={projects} segments={segments} />
    </div>
  );
}
