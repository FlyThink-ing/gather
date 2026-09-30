import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Boxes, CheckCircle2, Clock3, Pause, Play, Plus,
  RotateCcw, Send, UserRound, XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { btnGhost, btnPrimary, inputCls, labelCls } from '../components/Modal';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import TestWorkEntriesModal from '../components/TestWorkEntriesModal';
import {
  CONSTRUCTION_STATUS_LABEL, type ConstructionDetail, type Developer, type Team, type WorkSegment,
} from '../lib/types';
import { formatEffort } from '../lib/workload';

const today = () => new Date().toISOString().slice(0, 10);

export default function TestConstructionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { role, developer } = useAuth();
  const [data, setData] = useState<ConstructionDetail | null>(null);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [hoursTask, setHoursTask] = useState<any>(null);
  const [reasonAction, setReasonAction] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [progressTask, setProgressTask] = useState<any>(null);
  const [progress, setProgress] = useState('');
  const [progressError, setProgressError] = useState('');
  const [task, setTask] = useState({ title: '', owner_id: '', planned_start: today(), planned_end: today(), planned_hours: '8' });
  const [hours, setHours] = useState({ date: today(), hours: '1', note: '' });
  const [workEntriesTask, setWorkEntriesTask] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [detail, devs, teamRes] = await Promise.all([
      supabase.rpc('get_construction_detail', { p_work_id: id }),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('teams').select('*').order('name'),
    ]);
    if (detail.error) setError(detail.error.message);
    else setError('');
    setData((detail.data as ConstructionDetail) ?? null);
    setDevelopers((devs.data as Developer[]) ?? []);
    setTeams((teamRes.data as Team[]) ?? []);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const isLead = teams.some((team) => team.is_test_team && team.leader_id === developer?.id);
  const isOwner = data?.owner_id === developer?.id;
  const canLead = role === 'admin' || isLead;
  const canOwn = role === 'admin' || isOwner;
  const testPeople = developers.filter((item) => ['测试工程师', '自动化测试工程师'].includes(item.position ?? ''));

  const canManageConstructionWorkEntry = (entry: WorkSegment) => {
    if (!workEntriesTask) return false;
    const terminal = ['completed', 'cancelled'].includes(data?.status ?? '')
      || ['done', 'delayed_done'].includes(workEntriesTask.status);
    if (terminal) return canLead;
    if (entry.entry_source === 'automatic') return canLead;
    if (role === 'admin') return true;
    return ['in_progress', 'paused'].includes(workEntriesTask.status)
      && entry.developer_id === developer?.id;
  };

  const rpc = async (name: string, params: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc(name, params);
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setTaskOpen(false); setHoursTask(null); setReasonOpen(false); setReason(''); setProgressTask(null); setProgressError('');
    load();
  };

  const submitProgress = () => {
    if (!progressTask) return;
    const value = progress.trim();
    if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 100) {
      setProgressError('请输入 0–100 的整数');
      return;
    }
    rpc('update_construction_task', {
      p_construction_task_id: progressTask.id,
      p_status: progressTask.status === 'todo' ? 'in_progress' : progressTask.status,
      p_progress: Number(value),
    });
  };

  const transition = (action: string, prompt = false) => {
    if (prompt) { setReasonAction(action); setReason(''); setReasonOpen(true); return; }
    rpc('transition_construction', { p_work_id: id, p_action: action, p_reason: null });
  };

  if (loading) return <div className="py-24 text-center text-slate-500">加载测试建设工作中…</div>;
  if (!data) return <div className="space-y-4"><PageHeader title="测试建设" /><ErrorBox text={error || '记录不存在'} /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title={data.title} actions={<button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => navigate('/testing?view=construction')}><ArrowLeft size={15} /> 测试建设列表</button>} />
      {error && <ErrorBox text={error} />}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="flex gap-2"><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs text-violet-700 dark:text-violet-300">测试建设工作</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">{CONSTRUCTION_STATUS_LABEL[data.status]}</span></div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{data.goal}</p>
          </div>
          <div className="text-sm text-slate-500"><div className="flex items-center gap-1.5"><UserRound size={14} /> {data.owner_name}</div><div className="mt-2">{data.planned_start ?? '—'} ~ {data.planned_end ?? '—'}</div></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {canOwn && data.status === 'draft' && <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => transition('submit_schedule')}><Send size={15} /> 提交排期确认</button>}
          {canLead && data.status === 'pending_schedule' && <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => transition('confirm_schedule')}><CheckCircle2 size={15} /> 确认排期与资源</button>}
          {(canOwn || canLead) && ['draft', 'active'].includes(data.status) && <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => { setTask({ title: '', owner_id: data.owner_id, planned_start: data.planned_start ?? today(), planned_end: data.planned_end ?? today(), planned_hours: '8' }); setTaskOpen(true); }}><Plus size={15} /> 拆分任务</button>}
          {(canOwn || canLead) && data.status === 'active' && <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => transition('pause', true)}><Pause size={15} /> 暂停</button>}
          {(canOwn || canLead) && data.status === 'paused' && <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => transition('resume')}><Play size={15} /> 恢复</button>}
          {canOwn && data.status === 'active' && <button className={btnPrimary} onClick={() => transition('submit_result', true)}>提交成果确认</button>}
          {canLead && data.status === 'pending_acceptance' && <><button className={btnPrimary} onClick={() => transition('confirm_result')}>确认最终成果</button><button className={btnGhost} onClick={() => transition('return_result', true)}>退回完善</button></>}
          {canLead && !['completed', 'cancelled'].includes(data.status) && <button className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-500/10" onClick={() => transition('cancel', true)}><XCircle className="mr-1 inline" size={15} /> 取消</button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="任务进度" value={`${data.done_count}/${data.task_count}`} />
        <Metric label="计划工时" value={formatEffort(data.planned_hours)} />
        <Metric label="实际工时" value={formatEffort(data.actual_hours)} />
        <Metric label="资源汇总" value="全部来源" hint="建设工时仅进入统一资源汇总，不重复计入项目测试成本" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="预期成果"><Text value={data.deliverables} /></Card>
        <Card title="成果确认标准"><Text value={data.acceptance_criteria} /></Card>
        <Card title="资源链接"><Text value={data.resource_links} /></Card>
        <Card title="风险 / 阻塞 / 调整"><Text value={[data.risk_note, data.blocker_note, data.adjustment_note].filter(Boolean).join('\n') || null} /></Card>
      </div>

      <Card title="建设任务与实际工时">
        <div className="space-y-2">
          {data.tasks.map((item) => (
            <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(110px,.7fr)_minmax(150px,.9fr)_110px_auto] dark:border-slate-700">
              <div className="min-w-0"><div className="truncate font-medium">{item.title}</div><div className="mt-1 text-xs text-slate-500">进度 {item.progress}% · {constructionTaskStatusLabel[item.status] ?? item.status}</div></div>
              <div className="min-w-0"><div className="text-xs text-slate-500 lg:hidden">负责人</div><div className="truncate whitespace-nowrap">{item.owner_name}</div></div><div className="whitespace-nowrap"><div className="text-xs text-slate-500 lg:hidden">计划日期</div>{item.planned_start} ~ {item.planned_end}</div>
              <div className="whitespace-nowrap"><div className="text-xs text-slate-500">计划 / 实际</div><div className="mt-1 font-medium">{formatEffort(item.planned_hours)} / {formatEffort(item.actual_hours)}</div></div>
              <div className="flex flex-wrap gap-1 lg:justify-end">{item.task_id && <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700" onClick={() => setWorkEntriesTask(item)}>工时明细</button>}{item.status !== 'done' && (item.owner_id === developer?.id || canOwn || canLead) && <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => { setProgressTask(item); setProgress(String(item.progress)); setProgressError(''); }}>更新进度</button>}{item.status !== 'done' && (item.owner_id === developer?.id || canOwn || canLead) && <button className="rounded-lg border border-emerald-500/40 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" onClick={() => rpc('update_construction_task', { p_construction_task_id: item.id, p_status: 'done', p_progress: 100 })}>完成</button>}{item.task_id && ['active', 'paused'].includes(data.status) && ['in_progress', 'paused'].includes(item.status) && item.owner_id === developer?.id && <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700" onClick={() => { setHoursTask(item); setHours({ date: today(), hours: '1', note: '' }); }}>登记工时</button>}</div>
              </div>
          ))}
          {!data.tasks.length && <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">尚未拆分建设任务</div>}
        </div>
      </Card>

      <Card title="状态与成果审计">
        <div className="space-y-2">
          {data.events.map((event: any) => <div key={event.id} className="flex gap-3 text-sm"><div className="w-36 shrink-0 text-xs text-slate-500">{new Date(event.created_at).toLocaleString('zh-CN', { hour12: false })}</div><div><span className="font-medium">{constructionEventLabel[event.event_type] ?? event.event_type}</span><span className="ml-2 text-slate-500">{event.actor_name ?? '系统'}{event.reason ? ` · ${event.reason}` : ''}</span></div></div>)}
        </div>
      </Card>

      <Modal title="拆分建设任务" open={taskOpen} onClose={() => !busy && setTaskOpen(false)}>
        <div className="space-y-4">
          <Field label="任务标题 *"><input className={inputCls} value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
          <Field label="负责人 *"><Select value={task.owner_id} onChange={(value) => setTask({ ...task, owner_id: value })} options={testPeople.map((item) => ({ value: item.id, label: `${item.name}（${item.position}）` }))} /></Field>
          <div className="grid grid-cols-3 gap-3"><Field label="开始"><DatePicker value={task.planned_start} onChange={(value) => setTask({ ...task, planned_start: value })} /></Field><Field label="结束"><DatePicker value={task.planned_end} onChange={(value) => setTask({ ...task, planned_end: value })} /></Field><Field label="计划工时"><input type="number" min="0" className={inputCls} value={task.planned_hours} onChange={(e) => setTask({ ...task, planned_hours: e.target.value })} /></Field></div>
          <Actions busy={busy} text="创建任务" onCancel={() => setTaskOpen(false)} onConfirm={() => rpc('add_construction_task', { p_work_id: id, p_title: task.title.trim(), p_owner_id: task.owner_id, p_planned_start: task.planned_start, p_planned_end: task.planned_end, p_planned_hours: Number(task.planned_hours) })} />
        </div>
      </Modal>

      <Modal title={`登记实际工时 · ${hoursTask?.title ?? ''}`} open={!!hoursTask} onClose={() => !busy && setHoursTask(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="日期"><DatePicker value={hours.date} onChange={(value) => setHours({ ...hours, date: value })} /></Field><Field label="工时"><input type="number" min="0.1" max="24" step="0.5" className={inputCls} value={hours.hours} onChange={(e) => setHours({ ...hours, hours: e.target.value })} /></Field></div>
          <Field label="说明"><textarea className={`${inputCls} min-h-20`} value={hours.note} onChange={(e) => setHours({ ...hours, note: e.target.value })} /></Field>
          <Actions busy={busy} text="保存工时" onCancel={() => setHoursTask(null)} onConfirm={() => rpc('record_test_work_hours', { p_task_id: hoursTask.task_id, p_work_date: hours.date, p_hours: Number(hours.hours), p_note: hours.note.trim() || null })} />
        </div>
      </Modal>
      <TestWorkEntriesModal taskId={workEntriesTask?.task_id ?? null} title={workEntriesTask?.title ?? ''} open={!!workEntriesTask} onClose={() => setWorkEntriesTask(null)} canManage={canManageConstructionWorkEntry} />

      <Modal title={`更新进度 · ${progressTask?.title ?? ''}`} open={!!progressTask} onClose={() => !busy && setProgressTask(null)}>
        <div className="space-y-4">
          <Field label="完成进度 *"><input className={inputCls} type="number" min="0" max="100" step="1" value={progress} onChange={(e) => { setProgress(e.target.value); setProgressError(''); }} /></Field>
          {progressError && <div className="text-sm text-red-600 dark:text-red-400">{progressError}</div>}
          <Actions busy={busy} text="保存进度" onCancel={() => setProgressTask(null)} onConfirm={submitProgress} />
        </div>
      </Modal>

      <Modal title="填写原因 / 成果说明" open={reasonOpen} onClose={() => !busy && setReasonOpen(false)}>
        <div className="space-y-4"><Field label="说明 *"><textarea className={`${inputCls} min-h-28`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Actions busy={busy} text="确认" onCancel={() => setReasonOpen(false)} onConfirm={() => rpc('transition_construction', { p_work_id: id, p_action: reasonAction, p_reason: reason.trim() })} /></div>
      </Modal>
    </div>
  );
}

const constructionTaskStatusLabel: Record<string, string> = {
  todo: '待处理',
  in_progress: '进行中',
  paused: '已暂停',
  done: '已完成',
  cancelled: '已取消',
};
const constructionEventLabel: Record<string, string> = {
  created: '创建建设工作',
  task_created: '拆分建设任务',
  submit_schedule: '提交排期确认',
  confirm_schedule: '确认排期与资源',
  pause: '暂停',
  resume: '恢复',
  submit_result: '提交成果确认',
  confirm_result: '确认最终成果',
  return_result: '退回完善',
  cancel: '取消',
  task_updated: '更新建设任务',
};

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h3 className="mb-4 font-semibold">{title}</h3>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><label className={labelCls}>{label}</label>{children}</div>; }
function Text({ value }: { value: string | null }) { return <div className="whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{value || '—'}</div>; }
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div>{hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}</div>; }
function ErrorBox({ text }: { text: string }) { return <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{text}</div>; }
function Actions({ busy, text, onCancel, onConfirm }: { busy: boolean; text: string; onCancel: () => void; onConfirm: () => void }) { return <div className="flex justify-end gap-3"><button className={btnGhost} onClick={onCancel}>取消</button><button disabled={busy} className={btnPrimary} onClick={onConfirm}>{busy ? '处理中…' : text}</button></div>; }
