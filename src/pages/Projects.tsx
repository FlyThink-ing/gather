import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bug,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Eye,
  FlaskConical,
  Gauge,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { inputCls, labelCls, btnPrimary, btnGhost } from '../components/Modal';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import {
  type Developer,
  type Project,
  type ProjectStatus,
  type ProjectSummary,
  type Team,
  PROJECT_STATUS_LABEL,
} from '../lib/types';
import { formatEffort } from '../lib/workload';

const STATUS_CLS: Record<ProjectStatus, string> = {
  active: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  paused: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

interface ProjectForm {
  name: string;
  description: string;
  status: ProjectStatus;
  team_id: string;
  owner_id: string;
  start_date: string;
  end_date: string;
}

const emptyForm: ProjectForm = {
  name: '', description: '', status: 'active', team_id: '', owner_id: '', start_date: '', end_date: '',
};

const pct = (value: number | null) => value == null ? '—' : `${value}%`;

export default function Projects() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role, developer } = useAuth();
  const canCreate = role === 'admin' || role === 'manager';

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [forceFor, setForceFor] = useState<ProjectSummary | null>(null);
  const [forceReason, setForceReason] = useState('');
  const [forceErr, setForceErr] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    const [summary, t, d] = await Promise.all([
      supabase.rpc('get_project_summaries'),
      supabase.from('teams').select('*').order('name'),
      supabase.from('developers').select('*').order('name'),
    ]);
    if (summary.error) setLoadErr(summary.error.message);
    setProjects((summary.data as ProjectSummary[]) ?? []);
    setTeams((t.data as Team[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (loading) return;
    const restore = Number(searchParams.get('restoreScroll'));
    if (!Number.isFinite(restore) || restore <= 0) return;
    const timer = window.setTimeout(() => window.scrollTo({ top: restore }), 60);
    return () => window.clearTimeout(timer);
  }, [loading, searchParams]);

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? '-';
  const devName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? '待指定';
  const canEditProject = (p: Project) =>
    role === 'admin' || role === 'manager' || (!!developer && p.owner_id === developer.id);
  const canCompleteProject = (p: Project) =>
    p.status !== 'completed' && (role === 'admin' || (!!developer && p.owner_id === developer.id));

  const myLeaderTeams = useMemo(
    () => teams.filter((t) => developer && t.leader_id === developer.id),
    [teams, developer]
  );
  const selectableTeams = role === 'admin' ? teams : myLeaderTeams;

  const openCreate = () => {
    const auto = role === 'manager' && myLeaderTeams.length === 1 ? myLeaderTeams[0].id : '';
    setForm({ ...emptyForm, team_id: auto, owner_id: developer?.id ?? '' });
    setFormErr('');
    setEditing('new');
  };

  const openEdit = (p: Project) => {
    setForm({
      name: p.name,
      description: p.description ?? '',
      status: p.status,
      team_id: p.team_id,
      owner_id: p.owner_id ?? '',
      start_date: p.start_date ?? '',
      end_date: p.end_date ?? '',
    });
    setFormErr('');
    setEditing(p);
  };

  const save = async () => {
    if (!form.name.trim()) return setFormErr('请填写项目名称');
    if (!form.team_id) return setFormErr('请选择所属小组（项目必须归属一个小组）');
    if (!form.owner_id) return setFormErr('请指定项目负责人');
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return setFormErr('结束日期不能早于开始日期');
    }
    setSaving(true);
    setFormErr('');
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      team_id: form.team_id,
      owner_id: form.owner_id,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    const res = editing === 'new'
      ? await supabase.from('projects').insert({ ...payload, status: 'active', created_by: developer?.id ?? null })
      : await supabase.from('projects').update(payload).eq('id', (editing as Project).id);
    setSaving(false);
    if (res.error) return setFormErr(res.error.message);
    setEditing(null);
    load();
  };

  const completeProject = async (p: ProjectSummary, force = false, reason = '') => {
    setCompletingId(p.id);
    const { error } = await supabase.rpc('complete_project', {
      p_project_id: p.id,
      p_force: force,
      p_reason: reason.trim() || null,
    });
    setCompletingId(null);
    if (error) {
      if (force) return setForceErr(error.message);
      if (role === 'admin') {
        setForceFor(p);
        setForceReason('');
        setForceErr(error.message);
      } else {
        window.alert(error.message);
      }
      return;
    }
    setForceFor(null);
    setForceReason('');
    setForceErr('');
    load();
  };

  const remove = async (p: ProjectSummary) => {
    const blockers = p.unfinished_dev_count + p.active_test_count;
    const warn = blockers > 0 ? `\n注意：项目仍有 ${blockers} 个未完成开发/测试任务。` : '';
    if (!window.confirm(`确认删除项目「${p.name}」？${warn}`)) return;
    const { error } = await supabase.from('projects').delete().eq('id', p.id);
    if (error) window.alert(error.message);
    load();
  };

  const editTeamOptions = useMemo(() => {
    if (editing === 'new' || !editing) return selectableTeams;
    const cur = teams.find((t) => t.id === (editing as Project).team_id);
    if (cur && !selectableTeams.some((t) => t.id === cur.id)) return [cur, ...selectableTeams];
    return selectableTeams;
  }, [editing, selectableTeams, teams]);

  const openTasks = (project: ProjectSummary, filters: Record<string, string>) => {
    const params = new URLSearchParams({
      source: 'project',
      project: project.id,
      returnTo: '/projects',
      returnScroll: String(Math.round(window.scrollY)),
      ...filters,
    });
    navigate(`/tasks?${params.toString()}`);
  };

  return (
    <div>
      <PageHeader
        title="项目管理"
        actions={canCreate ? (
          <button onClick={openCreate} className={`${btnPrimary} flex items-center gap-1.5`}>
            <Plus size={16} /> 添加项目
          </button>
        ) : undefined}
      />

      {role === 'manager' && myLeaderTeams.length === 0 && (
        <div className="mb-4 rounded-lg bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          你当前未担任任何小组的组长，暂时无法创建项目。
        </div>
      )}
      {loadErr && (
        <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          项目驾驶舱加载失败：{loadErr}
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center text-slate-500">加载项目指标中…</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/50">
          暂无项目
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((p) => (
            <article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="max-w-full truncate text-left text-lg font-semibold text-slate-950 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                    >
                      {p.name}
                    </button>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${STATUS_CLS[p.status]}`}>
                      {PROJECT_STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 max-w-4xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {p.description || '暂无描述'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => navigate(`/projects/${p.id}`)} className={btnGhost} title="查看项目全景">
                    <Eye size={15} />
                  </button>
                  {canCompleteProject(p) && (
                    <button
                      onClick={() => completeProject(p)}
                      disabled={completingId === p.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <CheckCircle2 size={14} /> {completingId === p.id ? '检查中…' : '完成项目'}
                    </button>
                  )}
                  {canEditProject(p) && (
                    <button onClick={() => openEdit(p)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="编辑">
                      <Pencil size={15} />
                    </button>
                  )}
                  {(role === 'admin' || role === 'manager') && (
                    <button onClick={() => remove(p)} className="rounded-lg p-2 text-red-600 hover:bg-red-500/10" title="删除">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryBox
                  icon={<CalendarRange size={16} />}
                  label="计划 / 实际周期"
                  value={`${p.plan_days ?? '—'} 天 / ${p.actual_cycle_days ?? '—'} 天`}
                  hint={p.actual_started_at ? (p.completed_at ? '已完成周期' : '当前已运行') : '尚无真实启动记录'}
                />
                <SummaryBox icon={<Clock3 size={16} />} label="实际投入" value={formatEffort(p.actual_effort_hours)} hint="工时段累计，不按人员并发去重" />
                <SummaryBox
                  icon={<Gauge size={16} />}
                  label="开发任务进度"
                  value={`${p.dev_task_completed} / ${p.dev_task_total} · ${pct(p.dev_completion_rate)}`}
                  hint="仅统计开发任务"
                  onClick={() => openTasks(p, { type: 'dev' })}
                />
                <SummaryBox
                  icon={<FlaskConical size={16} />}
                  label="测试任务 / 轮次"
                  value={`${p.test_task_total} / ${p.test_round_total}`}
                  hint="任务与测试轮次分开统计"
                  onClick={() => openTasks(p, { type: 'test' })}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                <RiskMetric label="待审批" value={p.review_count} tone="amber" onClick={() => openTasks(p, { status: 'review' })} />
                <RiskMetric label="测试中" value={p.testing_active_count} tone="cyan" onClick={() => openTasks(p, { preset: 'testing_active' })} />
                <RiskMetric label="已逾期" value={p.overdue_count} tone="orange" onClick={() => openTasks(p, { timing: 'overdue' })} />
                <RiskMetric label="已完成" value={p.completed_task_count} tone="emerald" onClick={() => openTasks(p, { status: 'done,delayed_done' })} />
                <RiskMetric label="延期完成" value={p.delayed_done_count} tone="orange" onClick={() => openTasks(p, { status: 'delayed_done' })} />
                <RiskMetric label="累计 Bug" value={p.cumulative_bug_count} tone="red" onClick={() => navigate(`/projects/${p.id}?section=quality`)} />
                <RiskMetric label="测试不通过" value={p.failed_round_count} tone="red" onClick={() => openTasks(p, { type: 'test', result: 'fail' })} />
                <RiskMetric label="阻断轮次" value={p.blocked_round_count} tone="red" onClick={() => openTasks(p, { type: 'test', blocked: '1' })} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
                <span className="inline-flex items-center gap-1.5"><Users size={13} /> {teamName(p.team_id)}</span>
                <span className="inline-flex items-center gap-1.5"><UserCheck size={13} /> 负责人：{devName(p.owner_id)}</span>
                <span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> {p.start_date ?? '?'} ~ {p.end_date ?? '?'}</span>
                {p.unassigned_count > 0 && (
                  <button onClick={() => openTasks(p, { assignee: 'unassigned' })} className="inline-flex items-center gap-1 text-amber-700 hover:underline dark:text-amber-300">
                    <AlertTriangle size={13} /> 无负责人 {p.unassigned_count}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal title={editing === 'new' ? '添加项目' : '编辑项目'} open={editing !== null} onClose={() => setEditing(null)}>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>项目名称 <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>所属小组 <span className="text-red-500">*</span></label>
              <Select value={form.team_id} onChange={(v) => setForm({ ...form, team_id: v })} options={editTeamOptions.map((t) => ({ value: t.id, label: t.name }))} placeholder="请选择小组" />
            </div>
            <div>
              <label className={labelCls}>状态</label>
              <Select
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v as ProjectStatus })}
                options={(editing !== 'new' && (editing as Project)?.status === 'completed'
                  ? ['completed', 'active', 'paused'] as ProjectStatus[]
                  : ['active', 'paused'] as ProjectStatus[]
                ).map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s] }))}
              />
              {form.status !== 'completed' && <p className="mt-1 text-xs text-slate-500">完成项目请使用独立操作，系统会先检查阻断项。</p>}
            </div>
          </div>
          <div>
            <label className={labelCls}>项目负责人 <span className="text-red-500">*</span></label>
            <Select
              value={form.owner_id}
              onChange={(v) => setForm({ ...form, owner_id: v })}
              options={developers.filter((d) => d.is_active || d.id === form.owner_id).map((d) => ({ value: d.id, label: `${d.name}（${d.position ?? '未设置职位'}${d.is_active ? '' : '，已停用'}）` }))}
              placeholder="请指定负责人"
            />
            <p className="mt-1 text-xs text-slate-500">当前负责人是本项目全部开发任务的唯一普通审批人。</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>计划开始</label><DatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></div>
            <div><label className={labelCls}>计划结束</label><DatePicker value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} /></div>
          </div>
          <div><label className={labelCls}>描述</label><textarea className={`${inputCls} h-24 resize-none`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          {formErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{formErr}</div>}
          <div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setEditing(null)}>取消</button><button className={btnPrimary} disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button></div>
        </div>
      </Modal>

      <Modal title="管理员强制完成项目" open={forceFor !== null} onClose={() => setForceFor(null)}>
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            <div className="flex items-center gap-2 font-medium"><ShieldAlert size={16} /> 当前项目存在阻断项</div>
            <p className="mt-1 leading-6">{forceErr}</p>
          </div>
          <div>
            <label className={labelCls}>强制完成原因 <span className="text-red-500">*</span></label>
            <textarea className={`${inputCls} h-28 resize-none`} maxLength={2000} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="说明负责人离职、系统异常或其他必须代办的原因；该内容会写入项目审计。" />
          </div>
          <div className="flex justify-end gap-3">
            <button className={btnGhost} onClick={() => setForceFor(null)}>取消</button>
            <button className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50" disabled={!forceReason.trim() || completingId === forceFor?.id} onClick={() => forceFor && completeProject(forceFor, true, forceReason)}>
              <ShieldAlert size={15} /> {completingId === forceFor?.id ? '提交中…' : '确认强制完成'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SummaryBox({ icon, label, value, hint, onClick }: { icon: React.ReactNode; label: string; value: string; hint: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`rounded-xl border border-slate-200 p-3 text-left dark:border-slate-800 ${onClick ? 'transition hover:border-brand-400 hover:bg-brand-500/5' : ''}`}>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
      <div className="mt-1.5 truncate text-base font-semibold text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div>
    </Tag>
  );
}

const RISK_TONE = {
  amber: 'bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300',
  cyan: 'bg-cyan-500/10 text-cyan-800 hover:bg-cyan-500/15 dark:text-cyan-300',
  orange: 'bg-orange-500/10 text-orange-800 hover:bg-orange-500/15 dark:text-orange-300',
  emerald: 'bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-500/10 text-red-800 hover:bg-red-500/15 dark:text-red-300',
} as const;

function RiskMetric({ label, value, tone, onClick }: { label: string; value: number; tone: keyof typeof RISK_TONE; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`min-w-0 rounded-xl px-3 py-2 text-left transition ${RISK_TONE[tone]}`}>
      <span className="block truncate text-[11px] opacity-80">{label}</span>
      <span className="mt-0.5 block text-lg font-semibold">{value}</span>
    </button>
  );
}
