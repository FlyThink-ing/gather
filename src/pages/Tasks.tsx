import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Lock, Search, Play, Pause, Send, Check, Undo2, ChevronLeft, ChevronRight, Link2, Eye, ExternalLink, ShieldAlert, ArrowLeft, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { inputCls, labelCls, btnPrimary, btnGhost } from '../components/Modal';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import {
  type Task,
  type TaskListItem,
  type TaskPage,
  type Project,
  type Developer,
  type Team,
  type TaskStatus,
  type Priority,
  type TaskType,
  type TestRound,
  type TaskApprovalAudit,
  STATUS_LABEL,
  PRIORITY_LABEL,
  STATUS_BADGE,
  PRIORITY_BADGE,
  TASK_TYPE_LABEL,
  TEST_RESULT_LABEL,
  TEST_RESULT_BADGE,
  TIMING_BADGE,
} from '../lib/types';
import { planDays, isTaskOverdue, taskTimingState } from '../lib/workload';
import { defaultScope, SCOPE_LABEL, type ScopeKey } from '../lib/scope';

const todayStr = () => new Date().toISOString().slice(0, 10);
const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '将在确认时使用当前审批时间';
const effectiveCompletionDate = (task: Task) => task.submitted_at?.slice(0, 10) ?? todayStr();
const PAGE_SIZE = 10;
const TASK_TITLE_MAX = 120;
const TASK_DESCRIPTION_MAX = 5000;
const TASK_NOTE_MAX = 2000;

interface TaskForm {
  title: string;
  description: string;
  project_id: string;
  developer_id: string;
  priority: Priority;
  start_date: string;
  due_date: string;
}

const emptyForm: TaskForm = {
  title: '',
  description: '',
  project_id: '',
  developer_id: '',
  priority: 'medium',
  start_date: '',
  due_date: '',
};

export default function Tasks() {
  const { role, developer } = useAuth();
  const isAdminOrManager = role === 'admin' || role === 'manager';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [testRounds, setTestRounds] = useState<TestRound[]>([]);
  const [approvalAudits, setApprovalAudits] = useState<TaskApprovalAudit[]>([]);
  const [contextTasks, setContextTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // v2.15：URL 是筛选条件唯一真源。刷新、复制链接、浏览器前进/后退都会恢复。
  const sourceProject = searchParams.get('source') === 'project' && !!searchParams.get('project');
  const scope = (searchParams.get('scope') as ScopeKey | null) ?? (sourceProject ? 'all' : defaultScope(role));
  const q = searchParams.get('q') ?? '';
  const fType = searchParams.get('type') ?? '';
  const fProject = searchParams.get('project') ?? '';
  const fStatus = searchParams.get('status') ?? '';
  const fPriority = searchParams.get('priority') ?? '';
  const fDeveloper = searchParams.get('assignee') ?? '';
  const fTeam = searchParams.get('team') ?? '';
  const fTiming = searchParams.get('timing') ?? '';
  const fPreset = searchParams.get('preset') ?? '';
  const fResult = searchParams.get('result') ?? '';
  const fBlocked = searchParams.get('blocked') ?? '';
  const fSummary = searchParams.get('summary') ?? '';
  const focusId = searchParams.get('focus');
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const setUrlValue = useCallback((key: string, value: string | number, replace = false) => {
    const next = new URLSearchParams(searchParams);
    const textValue = String(value);
    if (!textValue || textValue === '0') next.delete(key);
    else next.set(key, textValue);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  const setScope = (value: ScopeKey) => setUrlValue('scope', value);
  const setQ = (value: string) => setUrlValue('q', value, true);
  const setFType = (value: string) => setUrlValue('type', value);
  const setFProject = (value: string) => setUrlValue('project', value);
  const setFStatus = (value: string) => setUrlValue('status', value);
  const setFPriority = (value: string) => setUrlValue('priority', value);
  const setFDeveloper = (value: string) => setUrlValue('assignee', value);
  const setFTeam = (value: string) => setUrlValue('team', value);
  const setPage = (value: number) => setUrlValue('page', value);
  const setFocusId = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('focus', value);
    for (const key of ['q', 'type', 'status', 'priority', 'assignee', 'team', 'timing', 'preset', 'result', 'blocked', 'summary', 'page']) {
      next.delete(key);
    }
    setSearchParams(next);
  };
  const returnTo = searchParams.get('returnTo') || (fProject ? `/projects/${fProject}` : '/projects');
  const returnScroll = searchParams.get('returnScroll');
  const returnToCockpit = () => {
    const suffix = returnScroll ? `${returnTo.includes('?') ? '&' : '?'}restoreScroll=${encodeURIComponent(returnScroll)}` : '';
    navigate(`${returnTo}${suffix}`);
  };

  // 弹窗
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [viewing, setViewing] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  // 延期备注 / 驳回原因输入
  const [noteFor, setNoteFor] = useState<{ mode: 'delay' | 'reject' | 'admin_reject'; task: Task } | null>(null);
  const [noteText, setNoteText] = useState('');
  // 提交审核确认
  const [confirmSubmit, setConfirmSubmit] = useState<Task | null>(null);
  // 审批通过确认：必须先核对任务详情，避免误触
  const [confirmApprove, setConfirmApprove] = useState<Task | null>(null);
  const [approving, setApproving] = useState(false);
  const [adminProxyMode, setAdminProxyMode] = useState(false);
  const [adminProxyReason, setAdminProxyReason] = useState('');
  const [approvalErr, setApprovalErr] = useState('');
  // 挂起确认
  const [confirmPause, setConfirmPause] = useState<Task | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const [t, p, d, tm, tr, aa] = await Promise.all([
      supabase.rpc('list_tasks', {
        p_scope: scope,
        p_query: q.trim() || null,
        p_task_type: fType || null,
        p_project_id: fProject || null,
        p_statuses: fStatus ? fStatus.split(',').filter(Boolean) : null,
        p_priority: fPriority || null,
        p_assignee: fDeveloper || null,
        p_team_id: fTeam || null,
        p_timing: fTiming || null,
        p_preset: fPreset || null,
        p_result: fResult || null,
        p_blocked: fBlocked ? fBlocked === '1' || fBlocked === 'true' : null,
        p_summary: fSummary || null,
        p_focus_id: focusId || null,
        p_page: page,
        p_page_size: PAGE_SIZE,
      }),
      supabase.from('projects').select('*').order('name'),
      supabase.from('developers').select('*').order('name'),
      supabase.from('teams').select('*').order('name'),
      supabase.from('test_rounds').select('*'),
      supabase.from('task_approval_audits').select('*').order('created_at', { ascending: false }),
    ]);
    const taskPage = (t.data as TaskPage | null) ?? { items: [], total: 0, page, page_size: PAGE_SIZE };
    setTasks(taskPage.items ?? []);
    setTotalTasks(taskPage.total ?? 0);
    setProjects((p.data as Project[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setTeams((tm.data as Team[]) ?? []);
    setTestRounds((tr.data as TestRound[]) ?? []);
    setApprovalAudits((aa.data as TaskApprovalAudit[]) ?? []);
    setLoading(false);
  }, [scope, q, fType, fProject, fStatus, fPriority, fDeveloper, fTeam, fTiming, fPreset, fResult, fBlocked, fSummary, focusId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const devName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? '未分配';
  const devPosition = (id: string | null) => developers.find((d) => d.id === id)?.position ?? '';
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '-';
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? '-';

  const isMine = (t: Task) => !!developer && t.developer_id === developer.id;

  // 实际投入天数已由服务端对当前页聚合，避免加载全系统工时段。
  const actualByTask = useMemo(() => {
    const days = new Map<string, number>();
    for (const task of tasks) days.set(task.id, task.actual_day_count ?? 0);
    return days;
  }, [tasks]);

  const detailTasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of [...tasks, ...contextTasks]) map.set(task.id, task);
    return [...map.values()];
  }, [tasks, contextTasks]);

  const loadTaskContext = useCallback(async (task: Task) => {
    const related = task.task_type === 'dev'
      ? await supabase.from('tasks').select('*').eq('linked_task_id', task.id).order('created_at', { ascending: false })
      : task.linked_task_id
        ? await supabase.from('tasks').select('*').eq('id', task.linked_task_id)
        : { data: [], error: null };
    setContextTasks([task, ...(((related.data as Task[]) ?? []))]);
  }, []);

  const openViewing = (task: Task) => {
    setViewing(task);
    void loadTaskContext(task);
  };

  const requiresProjectApproval = (t: Task) => t.task_type === 'dev' && !!t.project_id;

  // 普通审批权限唯一来源于当前 projects.owner_id；角色、组长身份均不参与。
  const canApprove = (t: Task) => {
    if (t.status !== 'review') return false;
    if (!developer) return false;
    const project = projects.find((p) => p.id === t.project_id);
    const owner = developers.find((d) => d.id === project?.owner_id);
    return !!project?.owner_id && owner?.is_active === true && project.owner_id === developer.id;
  };

  const canAdminProxy = (t: Task) => {
    if (role !== 'admin' || t.status !== 'review' || t.task_type === 'test') return false;
    const project = projects.find((p) => p.id === t.project_id);
    if (t.project_id && !project?.owner_id) return false;
    return !canApprove(t);
  };

  const canEdit = (t: Task) => {
    if (t.work_source !== 'development') return false;
    if (t.status === 'done' || t.status === 'delayed_done') return false;
    if (t.status === 'review') return false;
    // 测试中锁定：等待测试结论期间不可编辑（v2.5）
    if (t.status === 'testing') return false;
    if (role === 'admin' || role === 'manager') return true;
    // user：仅本人负责的在办任务
    return isMine(t);
  };

  // 数据库已完成筛选与分页；这里不再对全系统任务做浏览器端二次筛选。
  const totalPages = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = tasks;

  // 甘特图/质量轮次联动：focus 也是 URL 条件，目标任务由服务端精确返回。
  useEffect(() => {
    if (!focusId || loading) return;
    if (tasks.length === 0) {
      if (scope !== 'all') setScope('all');
      return;
    }
    const scroll = setTimeout(() => {
      document.getElementById(`task-row-${focusId}`)?.scrollIntoView({ block: 'center' });
    }, 150);
    return () => clearTimeout(scroll);
  }, [focusId, loading, tasks, scope]);

  // ---------- 增改删 ----------

  const openCreate = () => {
    // 负责人默认当前登录人（user 角色锁定为自己，其他角色可改）
    setForm({ ...emptyForm, developer_id: developer?.id ?? '' });
    setFormErr('');
    setEditing('new');
  };

  const openEdit = (t: Task) => {
    setForm({
      title: t.title,
      description: t.description ?? '',
      project_id: t.project_id ?? '',
      developer_id: t.developer_id ?? '',
      priority: t.priority,
      start_date: t.start_date ?? '',
      due_date: t.due_date ?? '',
    });
    setFormErr('');
    setEditing(t);
  };

  const saveTask = async () => {
    if (!form.title.trim()) return setFormErr('请填写任务标题');
    if (form.title.length > TASK_TITLE_MAX) return setFormErr(`任务标题不能超过 ${TASK_TITLE_MAX} 个字符`);
    if (form.description.length > TASK_DESCRIPTION_MAX) return setFormErr(`任务描述不能超过 ${TASK_DESCRIPTION_MAX} 个字符`);
    if (!form.project_id) return setFormErr('请选择所属项目');
    if (!form.start_date) return setFormErr('请选择开始日期');
    if (!form.due_date) return setFormErr('请选择截止日期');
    if (form.due_date < form.start_date) return setFormErr('截止日期不能早于开始日期');

    setSaving(true);
    setFormErr('');
    // team_id 继承项目（v2 §4.5）
    const project = projects.find((p) => p.id === form.project_id);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_id: form.project_id,
      developer_id: form.developer_id || null,
      team_id: project?.team_id ?? null,
      priority: form.priority,
      start_date: form.start_date,
      due_date: form.due_date,
    };

    const res =
      editing === 'new'
        ? await supabase.from('tasks').insert({ ...payload, created_by: developer?.id ?? null })
        : await supabase.from('tasks').update(payload).eq('id', (editing as Task).id);

    setSaving(false);
    if (res.error) return setFormErr(res.error.message);
    setEditing(null);
    load();
  };

  const removeTask = async (t: Task) => {
    if (!window.confirm(`确认删除任务「${t.title}」？此操作不可恢复。`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) alert(error.message);
    load();
  };

  // ---------- 状态流转 ----------

  const updateStatus = async (t: Task, patch: Partial<Task>) => {
    const { error } = await supabase.from('tasks').update(patch).eq('id', t.id);
    if (error) {
      alert(error.message);
      return false;
    }
    await load();
    return true;
  };

  const start = (t: Task) => updateStatus(t, { status: 'in_progress' });

  const submitReview = (t: Task) => {
    const project = projects.find((p) => p.id === t.project_id);
    if (t.project_id && !project?.owner_id) {
      alert('该项目缺少负责人，请先在项目管理中补充负责人后再提交审核。');
      return;
    }
    if (isTaskOverdue(t)) {
      // 超期必须填延期备注（v2 §4.5），该弹窗本身即为确认
      setNoteText(t.delay_note ?? '');
      setNoteFor({ mode: 'delay', task: t });
    } else {
      // 未超期：弹窗确认后提交
      setConfirmSubmit(t);
    }
  };


  const approve = async () => {
    if (!confirmApprove || approving) return;
    if (adminProxyMode && !adminProxyReason.trim()) {
      setApprovalErr('管理员异常代办必须填写代办原因');
      return;
    }
    setApproving(true);
    setApprovalErr('');
    let ok = false;
    if (adminProxyMode) {
      const { error } = await supabase.rpc('admin_proxy_task_review', {
        p_task_id: confirmApprove.id,
        p_approve: true,
        p_reason: adminProxyReason.trim(),
        p_reject_note: null,
      });
      if (error) setApprovalErr(error.message);
      else {
        ok = true;
        await load();
      }
    } else {
      // 数据库按 submitted_at 与 due_date 自动判定 done / delayed_done（v2 §5.3）
      ok = await updateStatus(confirmApprove, { status: 'done' });
    }
    setApproving(false);
    if (ok) {
      setConfirmApprove(null);
      setAdminProxyReason('');
    }
  };

  const openApprove = (t: Task, proxy: boolean) => {
    setAdminProxyMode(proxy);
    setAdminProxyReason('');
    setApprovalErr('');
    setConfirmApprove(t);
    void loadTaskContext(t);
  };

  const openReject = (t: Task) => {
    setNoteText('');
    setAdminProxyReason('');
    setNoteFor({ mode: 'reject', task: t });
  };

  const openAdminReject = (t: Task) => {
    setNoteText('');
    setAdminProxyReason('');
    setNoteFor({ mode: 'admin_reject', task: t });
  };

  const confirmNote = async () => {
    if (!noteFor) return;
    if (!noteText.trim()) return;
    if (noteFor.mode === 'admin_reject' && !adminProxyReason.trim()) return;
    if (noteText.length > TASK_NOTE_MAX) return alert(`备注不能超过 ${TASK_NOTE_MAX} 个字符`);
    if (noteFor.mode === 'delay') {
      await updateStatus(noteFor.task, { status: 'review', delay_note: noteText.trim() });
    } else if (noteFor.mode === 'reject') {
      await updateStatus(noteFor.task, { status: 'in_progress', reject_note: noteText.trim() });
    } else {
      const { error } = await supabase.rpc('admin_proxy_task_review', {
        p_task_id: noteFor.task.id,
        p_approve: false,
        p_reason: adminProxyReason.trim(),
        p_reject_note: noteText.trim(),
      });
      if (error) return alert(error.message);
      await load();
    }
    setNoteFor(null);
    setAdminProxyReason('');
  };

  // ---------- 选项 ----------

  const statusOptions = (Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
  }));
  const priorityOptions = (Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({
    value: p,
    label: PRIORITY_LABEL[p],
  }));
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  const developerOptions = developers.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.name }));
  const teamOptions = teams.map((t) => ({ value: t.id, label: t.name }));

  const withAll = (label: string, opts: { value: string; label: string }[]) => [
    { value: '', label },
    ...opts,
  ];
  return (
    <div>
      <PageHeader
        title="任务管理"
        actions={
          <button onClick={openCreate} className={`${btnPrimary} flex items-center gap-1.5`}>
            <Plus size={16} /> 添加任务
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3 text-sm">
        <div>
          <div className="font-medium text-slate-900 dark:text-white">测试工作已改为项目 / 阶段 / 版本轮次</div>
          <div className="mt-1 text-xs text-slate-500">开发任务不再单独提测；历史测试任务只读保留，新测试活动和测试建设任务请到测试中心处理。</div>
        </div>
        <button className={btnGhost} onClick={() => navigate('/testing')}>进入测试中心</button>
      </div>

      {sourceProject && (
        <div className="mb-4 rounded-xl border border-brand-500/25 bg-brand-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">来自项目驾驶舱：{projectName(fProject)}</div>
              <div className="mt-1 text-xs text-slate-500">下列来源条件已写入 URL，可继续叠加搜索、优先级、小组和人员筛选。</div>
            </div>
            <button onClick={returnToCockpit} className={`${btnGhost} inline-flex items-center gap-1.5`}><ArrowLeft size={14} /> 返回项目驾驶舱</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <SourceChip label={`项目：${projectName(fProject)}`} />
            {fType && <SourceChip label={`类型：${TASK_TYPE_LABEL[fType as TaskType]}`} onClear={() => setFType('')} />}
            {fStatus && <SourceChip label={`状态：${fStatus.split(',').map((s) => STATUS_LABEL[s as TaskStatus] ?? s).join('、')}`} onClear={() => setFStatus('')} />}
            {fTiming && <SourceChip label={fTiming === 'overdue' ? '时间：已逾期' : '时间：延期完成'} onClear={() => setUrlValue('timing', '')} />}
            {fPreset && <SourceChip label={fPreset === 'testing_active' ? '预设：测试中' : `预设：${fPreset}`} onClear={() => setUrlValue('preset', '')} />}
            {fResult && <SourceChip label={`测试结论：${TEST_RESULT_LABEL[fResult as 'pass' | 'fail'] ?? fResult}`} onClear={() => setUrlValue('result', '')} />}
            {fBlocked && <SourceChip label="质量：主流程阻断" onClear={() => setUrlValue('blocked', '')} />}
            {fSummary && <SourceChip label="质量：测试汇总未录入" onClear={() => setUrlValue('summary', '')} />}
            {fDeveloper === 'unassigned' && <SourceChip label="负责人：未分配" onClear={() => setFDeveloper('')} />}
            {focusId && <SourceChip label="定位：指定任务" onClear={() => setUrlValue('focus', '')} />}
          </div>
        </div>
      )}

      {/* 搜索 + 筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="relative min-w-56 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索任务 / 描述 / 项目…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <Select
          size="sm"
          className="w-28"
          value={scope}
          onChange={(v) => setScope(v as ScopeKey)}
          options={(Object.keys(SCOPE_LABEL) as ScopeKey[]).map((k) => ({ value: k, label: SCOPE_LABEL[k] }))}
        />
        <Select
          size="sm"
          className="w-28"
          value={fType}
          onChange={setFType}
          options={[
            { value: '', label: '全部类型' },
            ...(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((k) => ({ value: k, label: TASK_TYPE_LABEL[k] })),
          ]}
        />
        <Select size="sm" className="w-32" value={fProject} onChange={setFProject} options={withAll('全部项目', projectOptions)} />
        <Select size="sm" className="w-28" value={fStatus.includes(',') ? '' : fStatus} onChange={setFStatus} options={withAll('全部状态', statusOptions)} />
        <Select size="sm" className="w-28" value={fPriority} onChange={setFPriority} options={withAll('全部优先级', priorityOptions)} />
        <Select size="sm" className="w-28" value={fDeveloper} onChange={setFDeveloper} options={withAll('全部人员', developerOptions)} />
        <Select size="sm" className="w-28" value={fTeam} onChange={setFTeam} options={withAll('全部小组', teamOptions)} />
      </div>

      {/* 列表 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">任务</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">状态</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">优先级</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">负责人</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">截止日期</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 font-medium">工期</th>
              <th className="overflow-hidden whitespace-nowrap px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">加载中…</td></tr>
            )}
            {!loading && paged.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">暂无任务</td></tr>
            )}
            {paged.map((t) => (
              <tr
                key={t.id}
                id={`task-row-${t.id}`}
                className={`border-b border-slate-200 dark:border-slate-800/60 transition-colors ${
                  t.id === focusId
                    ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/40'
                    : 'hover:bg-slate-200/60 dark:hover:bg-slate-800/40'
                }`}
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openViewing(t)}
                    className="block w-full truncate text-left font-medium text-slate-900 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
                    title="查看任务详情"
                  >
                    {t.task_type === 'test' && (
                      <span className="mr-1.5 rounded bg-cyan-500/15 px-1.5 py-0.5 text-xs text-cyan-700 dark:text-cyan-300">测试</span>
                    )}
                    {t.title}
                  </button>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                    <span className="min-w-0 truncate">{projectName(t.project_id)}</span>
                    {t.task_type === 'test' && t.linked_task_id && (
                      <button
                        onClick={() => setFocusId(t.linked_task_id!)}
                        className="flex items-center gap-0.5 text-brand-500 hover:underline"
                        title="定位关联的开发任务"
                      >
                        <Link2 size={11} /> 关联任务
                      </button>
                    )}
                  </div>
                  {t.description && (
                    <div
                      className="mt-1 truncate text-xs leading-5 text-slate-600 dark:text-slate-400"
                    >
                      {t.description}
                    </div>
                  )}
                </td>
                <td className="overflow-hidden px-4 py-3">
                  <div className="space-y-1.5">
                    <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    {t.task_type === 'test' && (
                      t.test_result ? (
                        <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TEST_RESULT_BADGE[t.test_result]}`}>
                          {TEST_RESULT_LABEL[t.test_result]}
                        </span>
                      ) : (
                        <span className="inline-flex max-w-full truncate whitespace-nowrap rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-500/25 dark:text-slate-400">
                          待测试结论
                        </span>
                      )
                    )}
                  </div>
                </td>
                <td className="overflow-hidden px-4 py-3">
                  <span className={`inline-flex max-w-full truncate whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_BADGE[t.priority]}`}>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="truncate text-slate-800 dark:text-slate-200">{devName(t.developer_id)}</div>
                  <div className="truncate text-xs text-slate-500">{devPosition(t.developer_id)}</div>
                </td>
                <td className="overflow-hidden px-4 py-3 text-slate-500 dark:text-slate-400">
                  <div className="truncate whitespace-nowrap">{t.due_date ?? '-'}</div>
                  {taskTimingState(t) && (
                    <span className={`mt-1.5 inline-flex max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TIMING_BADGE}`}>
                      {taskTimingState(t) === 'overdue' ? '已逾期' : '逾期完成'}
                    </span>
                  )}
                </td>
                <td className="overflow-hidden px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  <div className="truncate whitespace-nowrap">
                    计划 {planDays(t.start_date, t.due_date) != null ? `${planDays(t.start_date, t.due_date)} 天` : '-'}
                  </div>
                  <div className="mt-0.5 truncate whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                    实际 {(actualByTask.get(t.id) ?? 0) > 0 ? `${actualByTask.get(t.id)} 天` : '-'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <IconBtn title="查看详情" onClick={() => openViewing(t)}><Eye size={15} /></IconBtn>
                    {/* 状态流转 */}
                    {t.status === 'todo' && t.work_source === 'development' && t.task_type === 'dev' && (isMine(t) || isAdminOrManager) && (
                      <IconBtn title="开始" onClick={() => start(t)}><Play size={15} /></IconBtn>
                    )}
                    {t.status === 'in_progress' && t.work_source === 'development' && t.task_type === 'dev' && (isMine(t) || isAdminOrManager) && (
                      <>
                        <IconBtn title={requiresProjectApproval(t) ? '完成并提交审批' : '完成任务'} onClick={() => submitReview(t)}><Send size={15} /></IconBtn>
                        <IconBtn title="挂起（被其他任务打断时）" onClick={() => setConfirmPause(t)}><Pause size={15} /></IconBtn>
                      </>
                    )}
                    {t.status === 'paused' && t.work_source === 'development' && t.task_type === 'dev' && (isMine(t) || isAdminOrManager) && (
                      <IconBtn title="继续" onClick={() => start(t)}><Play size={15} /></IconBtn>
                    )}
                    {t.work_source === 'test_activity' && (
                      <button className="rounded-lg px-2 py-1 text-xs text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300" onClick={() => navigate(`/testing/plans/${t.test_plan_id}`)}>测试中心处理</button>
                    )}
                    {t.work_source === 'construction' && (
                      <button className="rounded-lg px-2 py-1 text-xs text-violet-700 hover:bg-violet-500/10 dark:text-violet-300" onClick={() => navigate(`/testing/construction/${t.construction_work_id}`)}>建设工作处理</button>
                    )}
                    {t.work_source === 'legacy_single_test' && (
                      <span className="text-xs text-slate-500">历史测试只读</span>
                    )}
                    {t.status === 'testing' && (
                      <span className="flex items-center gap-1 text-xs text-cyan-700 dark:text-cyan-300"><Lock size={13} /> 测试中</span>
                    )}
                    {canApprove(t) && (
                      <>
                        <IconBtn title="审批通过（需确认详情）" tone="ok" onClick={() => openApprove(t, false)}><Check size={15} /></IconBtn>
                        <IconBtn title="审批驳回" tone="warn" onClick={() => openReject(t)}><Undo2 size={15} /></IconBtn>
                      </>
                    )}
                    {canAdminProxy(t) && (
                      <>
                        <IconBtn title="管理员异常代办通过（必须填写原因）" tone="danger" onClick={() => openApprove(t, true)}><ShieldAlert size={15} /></IconBtn>
                        <IconBtn title="管理员异常代办驳回（必须填写原因）" tone="danger" onClick={() => openAdminReject(t)}><Undo2 size={15} /></IconBtn>
                      </>
                    )}
                    {t.status === 'review' && t.project_id && !projects.find((p) => p.id === t.project_id)?.owner_id && (
                      <span className="text-xs text-red-600 dark:text-red-400">请先补项目负责人</span>
                    )}
                    {/* 编辑/删除 */}
                    {canEdit(t) && (
                      <IconBtn title="编辑" onClick={() => openEdit(t)}><Pencil size={15} /></IconBtn>
                    )}
                    {isAdminOrManager && t.work_source === 'development' && (
                      <IconBtn title="删除" tone="danger" onClick={() => removeTask(t)}><Trash2 size={15} /></IconBtn>
                    )}
                    {(t.status === 'done' || t.status === 'delayed_done') && (
                      <span className="flex items-center gap-1 text-xs text-slate-500"><Lock size={13} /> 已完成</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 分页 */}
        {!loading && totalTasks > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 px-4 py-3">
            <span className="text-xs text-slate-500">
              共 {totalTasks} 条 · 第 {safePage} / {totalPages} 页
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                className="flex items-center gap-0.5 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={13} /> 上一页
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                .reduce<(number | '…')[]>((acc, n) => {
                  const prev = acc[acc.length - 1];
                  if (typeof prev === 'number' && n - prev > 1) acc.push('…');
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, i) =>
                  n === '…' ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-slate-400 dark:text-slate-600">…</span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`min-w-7 rounded-lg px-2 py-1.5 text-xs ${
                        n === safePage
                          ? 'bg-brand-600 font-medium text-white'
                          : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                className="flex items-center gap-0.5 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页 <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 任务详情 */}
      <Modal title="任务详情" open={viewing !== null} onClose={() => setViewing(null)} width="max-w-3xl">
        {viewing && (
          <TaskDetail
            task={viewing}
            tasks={detailTasks}
            projects={projects}
            developers={developers}
            teams={teams}
            actualDayCount={actualByTask.get(viewing.id) ?? 0}
            testRounds={testRounds}
            approvalAudits={approvalAudits}
            onOpenTask={openViewing}
          />
        )}
      </Modal>

      {/* 审批通过：先核对完整任务详情，再执行不可逆的完成动作 */}
      <Modal
        title={adminProxyMode ? '管理员异常代办审批' : '确认审批通过'}
        open={confirmApprove !== null}
        onClose={() => { if (!approving) setConfirmApprove(null); }}
        width="max-w-3xl"
      >
        {confirmApprove && (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="font-medium">请核对以下任务详情后再确认</div>
              <div className="mt-1 leading-6">
                审批通过后任务将锁定为
                <span className="mx-1 font-semibold">
                  {confirmApprove.due_date && effectiveCompletionDate(confirmApprove) > confirmApprove.due_date
                    ? '延期完成'
                    : '已完成'}
                </span>
                ，{confirmApprove.submitted_at
                  ? '完成时间采用工作完成时刻，不采用当前审批时间。'
                  : '该任务缺少工作完成时间，系统将回退为当前审批时间。'}
              </div>
              <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-slate-900/50">
                <div className="text-xs opacity-75">本次将采用的完成时间</div>
                <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                  {formatDateTime(confirmApprove.submitted_at)}
                </div>
                <div className="mt-0.5 text-xs opacity-75">
                  来源：{!confirmApprove.submitted_at
                    ? '异常数据回退：当前审批时间'
                    : detailTasks.some((item) => item.task_type === 'test' && item.linked_task_id === confirmApprove.id && item.test_result === 'pass')
                      ? '开发任务提测时间'
                      : '最近一次提交完成时间'}
                </div>
              </div>
            </div>
            <TaskDetail
              task={confirmApprove}
              tasks={detailTasks}
              projects={projects}
              developers={developers}
              teams={teams}
              actualDayCount={actualByTask.get(confirmApprove.id) ?? 0}
              testRounds={testRounds}
              approvalAudits={approvalAudits}
            />
            {adminProxyMode && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
                <label className={labelCls}>管理员代办原因 <span className="text-red-600">*</span></label>
                <textarea
                  className={`${inputCls} mt-1 h-24 resize-none`}
                  value={adminProxyReason}
                  onChange={(e) => setAdminProxyReason(e.target.value)}
                  maxLength={TASK_NOTE_MAX}
                  placeholder="说明负责人离职、停用或系统异常等代办原因；该内容将写入审批审计"
                />
                <TextCounter value={adminProxyReason} max={TASK_NOTE_MAX} />
              </div>
            )}
            {approvalErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{approvalErr}</div>}
            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button className={btnGhost} disabled={approving} onClick={() => setConfirmApprove(null)}>取消</button>
              <button className={btnPrimary} disabled={approving} onClick={approve}>
                {approving ? '审批处理中…' : adminProxyMode ? '确认代办审批并完成任务' : '确认审批并完成任务'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 添加/编辑弹窗 */}
      <Modal
        title={editing === 'new' ? '添加任务' : '编辑任务'}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>任务标题 <span className="text-red-600 dark:text-red-400">*</span></label>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={TASK_TITLE_MAX}
              placeholder="请输入任务标题"
            />
            <TextCounter value={form.title} max={TASK_TITLE_MAX} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>所属项目 <span className="text-red-600 dark:text-red-400">*</span></label>
              <Select
                value={form.project_id}
                onChange={(v) => setForm({ ...form, project_id: v })}
                options={projects.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))}
                placeholder="请选择项目"
              />
            </div>
            <div>
              <label className={labelCls}>负责人</label>
              <Select
                value={form.developer_id}
                onChange={(v) => setForm({ ...form, developer_id: v })}
                options={[{ value: '', label: '未分配' }, ...developerOptions]}
                disabled={role === 'user'}
              />
              {role === 'user' && (
                <p className="mt-1 text-xs text-slate-500">普通用户创建的任务负责人为自己</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>优先级</label>
              <Select
                value={form.priority}
                onChange={(v) => setForm({ ...form, priority: v as Priority })}
                options={priorityOptions}
              />
            </div>
            <div>
              <label className={labelCls}>开始日期 <span className="text-red-400">*</span></label>
              <DatePicker
                value={form.start_date}
                onChange={(v) => setForm({ ...form, start_date: v })}
              />
            </div>
            <div>
              <label className={labelCls}>截止日期 <span className="text-red-400">*</span></label>
              <DatePicker
                value={form.due_date}
                onChange={(v) => setForm({ ...form, due_date: v })}
              />
            </div>
          </div>
          {planDays(form.start_date || null, form.due_date || null) != null && (
            <p className="-mt-2 text-xs text-slate-500">
              计划工期：{planDays(form.start_date || null, form.due_date || null)} 天
            </p>
          )}
          <div>
            <label className={labelCls}>描述</label>
            <textarea
              className={`${inputCls} h-24 resize-none`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={TASK_DESCRIPTION_MAX}
              placeholder="请输入任务描述"
            />
            <TextCounter value={form.description} max={TASK_DESCRIPTION_MAX} />
          </div>
          {formErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{formErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button className={btnGhost} onClick={() => setEditing(null)}>取消</button>
            <button className={btnPrimary} disabled={saving} onClick={saveTask}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 完成/提交审批确认弹窗 */}
      <Modal
        title={confirmSubmit && requiresProjectApproval(confirmSubmit) ? '确认提交审批' : '确认完成任务'}
        open={confirmSubmit !== null}
        onClose={() => setConfirmSubmit(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            确认完成任务「{confirmSubmit?.title}」？
          </p>
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {confirmSubmit && requiresProjectApproval(confirmSubmit)
              ? `该任务属于项目，提交后将进入“审核中”，等待项目负责人「${devName(projects.find((p) => p.id === confirmSubmit.project_id)?.owner_id ?? null)}」审批。`
              : '该任务无项目归属，确认后将直接完成并锁定。'}
          </p>
          <div className="flex justify-end gap-3">
            <button className={btnGhost} onClick={() => setConfirmSubmit(null)}>取消</button>
            <button
              className={btnPrimary}
              onClick={async () => {
                if (confirmSubmit) await updateStatus(confirmSubmit, { status: 'review' });
                setConfirmSubmit(null);
              }}
            >
              {confirmSubmit && requiresProjectApproval(confirmSubmit) ? '确认提交审批' : '确认完成'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 挂起确认弹窗 */}
      <Modal
        title="确认挂起任务"
        open={confirmPause !== null}
        onClose={() => setConfirmPause(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            确认挂起任务「{confirmPause?.title}」？
          </p>
          <ul className="space-y-1.5 rounded-lg bg-violet-500/10 px-3 py-2.5 text-xs text-violet-700 dark:text-violet-300">
            <li>· 挂起用于任务被打断的场景（如紧急任务插入），当前工时段将立即结束；</li>
            <li>· 挂起期间不计入实际工时，甘特图的"实际投入"条会在此中断；</li>
            <li>· 可随时点「继续」恢复为进行中，恢复后开始新的工时段。</li>
          </ul>
          <div className="flex justify-end gap-3">
            <button className={btnGhost} onClick={() => setConfirmPause(null)}>取消</button>
            <button
              className={btnPrimary}
              onClick={async () => {
                if (confirmPause) await updateStatus(confirmPause, { status: 'paused' });
                setConfirmPause(null);
              }}
            >
              确认挂起
            </button>
          </div>
        </div>
      </Modal>

      {/* 延期备注 / 驳回原因 弹窗 */}
      <Modal
        title={noteFor?.mode === 'delay' ? '任务已超期，请填写延期备注' : noteFor?.mode === 'admin_reject' ? '管理员异常代办驳回' : '驳回任务'}
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noteFor?.mode === 'delay'
              ? `任务「${noteFor?.task.title}」已超过截止日期，完成前需说明延期原因。${noteFor?.task && requiresProjectApproval(noteFor.task) ? '提交后进入项目审批。' : '确认后直接标记为延期完成。'}`
              : `审批驳回后任务「${noteFor?.task.title}」将退回「进行中」，负责人可修改后重新提交。`}
          </p>
          <textarea
            className={`${inputCls} h-24 resize-none`}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            maxLength={TASK_NOTE_MAX}
            placeholder={noteFor?.mode === 'delay' ? '延期原因…' : '驳回原因（必填）…'}
          />
          <TextCounter value={noteText} max={TASK_NOTE_MAX} />
          {noteFor?.mode === 'admin_reject' && (
            <div>
              <label className={labelCls}>管理员代办原因 <span className="text-red-600">*</span></label>
              <textarea
                className={`${inputCls} h-24 resize-none`}
                value={adminProxyReason}
                onChange={(e) => setAdminProxyReason(e.target.value)}
                maxLength={TASK_NOTE_MAX}
                placeholder="说明为何不能由项目负责人处理；该内容将写入审批审计"
              />
              <TextCounter value={adminProxyReason} max={TASK_NOTE_MAX} />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button className={btnGhost} onClick={() => setNoteFor(null)}>取消</button>
            <button className={btnPrimary} disabled={!noteText.trim() || (noteFor?.mode === 'admin_reject' && !adminProxyReason.trim())} onClick={confirmNote}>
              {noteFor?.mode === 'delay' ? (noteFor?.task && requiresProjectApproval(noteFor.task) ? '确认提交审批' : '确认延期完成') : noteFor?.mode === 'admin_reject' ? '确认代办驳回' : '确认审批驳回'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TextCounter({ value, max }: { value: string; max: number }) {
  const remaining = max - value.length;
  return (
    <div className={`mt-1 text-right text-xs ${remaining <= Math.min(100, max * 0.1) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
      {value.length.toLocaleString()} / {max.toLocaleString()}
    </div>
  );
}

function SourceChip({ label, onClear }: { label: string; onClear?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
      {label}
      {onClear && <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" title="清除此条件"><X size={11} /></button>}
    </span>
  );
}

function TaskDetail({
  task,
  tasks,
  projects,
  developers,
  teams,
  actualDayCount,
  testRounds,
  approvalAudits,
  onOpenTask,
}: {
  task: Task;
  tasks: Task[];
  projects: Project[];
  developers: Developer[];
  teams: Team[];
  actualDayCount: number;
  testRounds: TestRound[];
  approvalAudits: TaskApprovalAudit[];
  onOpenTask?: (task: Task) => void;
}) {
  const relatedTests = tasks
    .filter((item) => item.task_type === 'test' && item.linked_task_id === task.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const linkedTask = task.linked_task_id ? tasks.find((item) => item.id === task.linked_task_id) : null;
  const project = projects.find((item) => item.id === task.project_id);
  const projectOwner = developers.find((item) => item.id === project?.owner_id);
  const owner = developers.find((item) => item.id === task.developer_id);
  const team = teams.find((item) => item.id === task.team_id);
  const currentRound = testRounds.find((item) => item.test_task_id === task.id);

  const resultBadge = (result: Task['test_result']) => {
    if (!result) return <span className="text-slate-500">尚未提交结论</span>;
    return (
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TEST_RESULT_BADGE[result]}`}>
        {TEST_RESULT_LABEL[result]}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${task.task_type === 'test' ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' : 'bg-brand-500/15 text-brand-700 dark:text-brand-300'}`}>
            {TASK_TYPE_LABEL[task.task_type]}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[task.status]}`}>
            {STATUS_LABEL[task.status]}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
          {taskTimingState(task) && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TIMING_BADGE}`}>
              {taskTimingState(task) === 'overdue' ? '已逾期' : '逾期完成'}
            </span>
          )}
        </div>
        <h3 className="[overflow-wrap:anywhere] text-lg font-semibold text-slate-900 dark:text-white">{task.title}</h3>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">任务描述</h4>
        <div className="min-h-16 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
          {task.description?.trim() || <span className="text-slate-500">未填写任务描述</span>}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem label="所属项目" value={project?.name ?? '-'} />
        <DetailItem label="负责人" value={owner ? `${owner.name}${owner.position ? ` · ${owner.position}` : ''}` : '未分配'} />
        <DetailItem label="所属小组" value={team?.name ?? '-'} />
        <DetailItem
          label="审批归属"
          value={task.task_type === 'test'
            ? '测试结论即完成，测试任务不重复审批'
            : !task.project_id
              ? '无项目任务，由任务负责人直接完成'
              : project?.owner_id
                ? `项目负责人审批 · ${projectOwner?.name ?? '负责人账号已停用/不可用'}`
                : '项目缺少负责人，请先补充负责人'}
        />
        <DetailItem label="开始日期" value={task.start_date ?? '-'} />
        <DetailItem label="截止日期" value={task.due_date ?? '-'} />
        <DetailItem label="完成日期" value={task.completed_at?.slice(0, 10) ?? '-'} />
        <DetailItem
          label="工期"
          value={`${planDays(task.start_date, task.due_date) != null ? `计划 ${planDays(task.start_date, task.due_date)} 天` : '计划 -'}${actualDayCount > 0 ? ` · 实际 ${actualDayCount} 天` : ''}`}
        />
      </div>

      {task.task_type === 'test' && (
        <>
          <TestMetricsSummary round={currentRound} />
          <section className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">测试结论</h4>
              {resultBadge(task.test_result)}
            </div>
            <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-700 dark:text-slate-300">
              {task.test_note?.trim() || <span className="text-slate-500">未填写结论说明</span>}
            </div>
            {linkedTask && onOpenTask && (
              <button
                type="button"
                onClick={() => onOpenTask(linkedTask)}
                className="mt-3 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
              >
                <Link2 size={12} /> 查看关联开发任务：{linkedTask.title}
              </button>
            )}
          </section>
        </>
      )}

      {task.task_type === 'dev' && (
        <section>
          <h4 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">关联测试记录</h4>
          {relatedTests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500 dark:border-slate-700">
              暂无关联测试记录
            </div>
          ) : (
            <div className="space-y-3">
              {relatedTests.map((test, index) => {
                const tester = developers.find((item) => item.id === test.developer_id);
                const round = testRounds.find((item) => item.test_task_id === test.id);
                return (
                  <div key={test.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {onOpenTask ? (
                        <button type="button" onClick={() => onOpenTask(test)} className="min-w-0 [overflow-wrap:anywhere] text-left text-sm font-medium text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400">
                          第 {relatedTests.length - index} 次 · {test.title}
                        </button>
                      ) : (
                        <div className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium text-slate-900 dark:text-white">
                          第 {relatedTests.length - index} 次 · {test.title}
                        </div>
                      )}
                      {resultBadge(test.test_result)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      测试负责人：{tester?.name ?? '未分配'} · {test.completed_at?.slice(0, 10) ?? '尚未完成'}
                    </div>
                    {test.description?.trim() && (
                      <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">测试说明：</span>{test.description}
                      </div>
                    )}
                    {test.test_note?.trim() && (
                      <div className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <span className="font-medium">结论说明：</span>{test.test_note}
                      </div>
                    )}
                    <div className="mt-3">
                      <TestMetricsSummary round={round} compact />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {(task.reject_note || task.delay_note) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {task.reject_note && <DetailNote label="驳回/测试不通过原因" value={task.reject_note} tone="danger" />}
          {task.delay_note && <DetailNote label="延期备注" value={task.delay_note} tone="warn" />}
        </section>
      )}

      <ApprovalAuditTrail
        task={task}
        audits={approvalAudits.filter((item) => item.task_id === task.id)}
        developers={developers}
      />
    </div>
  );
}

function ApprovalAuditTrail({
  task,
  audits,
  developers,
}: {
  task: Task;
  audits: TaskApprovalAudit[];
  developers: Developer[];
}) {
  if (audits.length === 0 && !task.approved_by_user) return null;
  const name = (id: string | null) => developers.find((item) => item.id === id)?.name ?? (id ? '历史人员' : '-');
  return (
    <section>
      <h4 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">审批审计</h4>
      {audits.length === 0 ? (
        <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          历史审批人：{name(task.approved_by_user)}（旧数据未生成独立审计记录）
        </div>
      ) : (
        <div className="space-y-2">
          {audits.map((audit) => (
            <div key={audit.id} className="rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${audit.decision === 'approved' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'}`}>
                  {audit.decision === 'approved' ? '审批通过' : '审批驳回'}
                </span>
                {audit.is_admin_proxy && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">管理员代办</span>}
                <span className="font-medium text-slate-800 dark:text-slate-200">{audit.actor_name || name(audit.actor_id)}</span>
                <span className="text-xs text-slate-500">{new Date(audit.created_at).toLocaleString('zh-CN')}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">当时项目负责人：{audit.project_owner_name || name(audit.project_owner_id)} · 结果：{STATUS_LABEL[audit.to_status]}</div>
              {audit.decision_note && <div className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-700 dark:text-slate-300">驳回原因：{audit.decision_note}</div>}
              {audit.admin_proxy_reason && <div className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-red-500/5 px-3 py-2 text-red-700 dark:text-red-300">代办原因：{audit.admin_proxy_reason}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TestMetricsSummary({ round, compact = false }: { round: TestRound | undefined; compact?: boolean }) {
  if (!round) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-700">
        测试汇总未录入（历史数据不按 0 参与统计）
      </div>
    );
  }
  const rate = round.planned_case_count && round.executed_case_count != null
    ? Math.round((round.executed_case_count / round.planned_case_count) * 100)
    : null;
  const method = round.test_method ?? 'case_based';
  return (
    <section className={`rounded-xl border border-slate-200 dark:border-slate-700 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
          测试汇总 · 第 {round.round_no} 轮
        </h4>
        <span className="text-xs text-slate-500">{round.result ? '已出结论' : '测试进行中'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricValue label="测试方式" value={method === 'case_based' ? '标准用例' : '快速 / 探索性'} />
        {method === 'case_based' && <MetricValue label="计划用例" value={round.planned_case_count} />}
        {method === 'case_based' && <MetricValue label="实际执行" value={round.executed_case_count} extra={rate != null ? `${rate}%` : undefined} />}
        <MetricValue label="新增 Bug" value={round.result ? round.bug_count : null} />
        <MetricValue label="Reopen" value={round.result ? round.reopen_count : null} />
        <MetricValue label="主流程" value={round.result ? (round.blocked ? '阻断' : '正常') : null} danger={round.blocked} />
      </div>
      {method === 'exploratory' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DetailText label="验证范围" value={round.verification_scope || '未录入'} />
          <DetailText label="采用原因" value={round.verification_reason || '未录入'} />
        </div>
      )}
      {round.zentao_url && (
        <a
          href={round.zentao_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          <ExternalLink size={12} /> 打开禅道测试任务
        </a>
      )}
    </section>
  );
}

function DetailText({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-700 dark:text-slate-300">{value}</div>
    </div>
  );
}

function MetricValue({
  label,
  value,
  extra,
  danger = false,
}: {
  label: string;
  value: number | string | null;
  extra?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-medium ${danger ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>
        {value ?? '待结论'}{extra && <span className="ml-1 text-[11px] font-normal text-slate-500">{extra}</span>}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 [overflow-wrap:anywhere] text-sm text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}

function DetailNote({ label, value, tone }: { label: string; value: string; tone: 'warn' | 'danger' }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone === 'danger' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
      <div className="mb-1 text-xs font-medium">{label}</div>
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{value}</div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: 'ok' | 'warn' | 'danger';
  children: React.ReactNode;
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
        : tone === 'danger'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-slate-200';
  return (
    <button title={title} onClick={onClick} className={`rounded-md p-1.5 ${toneCls}`}>
      {children}
    </button>
  );
}
