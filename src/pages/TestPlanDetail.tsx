import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, Bug, CalendarDays, CheckCircle2, Clock3,
  ExternalLink, FileCheck2, Gauge, Pause, Play, Plus, RotateCcw,
  ShieldAlert, Users, XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { btnGhost, btnPrimary, inputCls, labelCls } from '../components/Modal';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import TestWorkEntriesModal from '../components/TestWorkEntriesModal';
import {
  STATUS_LABEL, TEST_CYCLE_STATUS_LABEL, TEST_TYPE_LABEL, type Developer, type Team, type TestActivity, type TestCycle,
  type TestPlanDetail,
  type Task,
  type WorkSegment,
} from '../lib/types';
import { formatEffort } from '../lib/workload';

const today = () => new Date().toISOString().slice(0, 10);

export default function TestPlanDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { role, developer } = useAuth();
  const [data, setData] = useState<TestPlanDetail | null>(null);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'schedule' | 'activity' | 'batch' | 'conclusion' | 'reason' | 'nextCycle' | 'reportReason' | null>(null);
  const [reasonAction, setReasonAction] = useState('');
  const [reason, setReason] = useState('');
  const [repairTasks, setRepairTasks] = useState<Task[]>([]);
  const [repairTaskId, setRepairTaskId] = useState('');
  const [hoursActivity, setHoursActivity] = useState<any>(null);
  const [hours, setHours] = useState({ date: today(), hours: '1', note: '' });
  const [workEntriesActivity, setWorkEntriesActivity] = useState<any>(null);
  const [nextCycleVersion, setNextCycleVersion] = useState('');
  const [nextCycleError, setNextCycleError] = useState('');
  const [reportId, setReportId] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reportReasonError, setReportReasonError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [batchError, setBatchError] = useState('');

  const [schedule, setSchedule] = useState({ main_tester_id: '', planned_start: today(), planned_end: today(), reason: '' });
  const [activity, setActivity] = useState({ activity_type: 'system', title: '', owner_id: '', planned_start: today(), planned_end: today(), planned_hours: '8', preconditions: '', deliverable: '' });
  const [batch, setBatch] = useState({ executed_on: today(), activity_id: '', environment_name: '', build_version: '', test_type: 'system', planned_count: '0', executed_count: '0', passed_count: '0', failed_count: '0', blocked_count: '0', skipped_count: '0', bug_count: '0', reopen_count: '0', smoke_passed: '', issue_summary: '', blocker_summary: '', risk_summary: '', zentao_url: '' });
  const [conclusion, setConclusion] = useState({ result: 'pass', scope: '', completion: '', new_issues: '', legacy_issues: '', blockers: '', risks: '', release_recommendation: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [detail, devs, teamRes] = await Promise.all([
      supabase.rpc('get_test_plan_detail', { p_plan_id: id }),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('teams').select('*').order('name'),
    ]);
    if (detail.error) setError(detail.error.message);
    else setError('');
    setData((detail.data as TestPlanDetail) ?? null);
    setDevelopers((devs.data as Developer[]) ?? []);
    setTeams((teamRes.data as Team[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.project_id) { setRepairTasks([]); return; }
    void supabase.from('tasks').select('*').eq('project_id', data.project_id).order('created_at', { ascending: false })
      .then(({ data: rows }) => setRepairTasks(((rows as Task[]) ?? []).filter((task) => task.task_type === 'dev')));
  }, [data?.project_id]);

  const cycle = data?.cycles?.[0];
  const testPeople = developers.filter((person) => ['测试工程师', '自动化测试工程师'].includes(person.position ?? ''));
  const isLead = !!data && teams.some((team) => team.id === data.test_team_id && team.is_test_team && team.leader_id === developer?.id);
  const isMain = cycle?.main_tester_id === developer?.id;
  const canLead = role === 'admin' || isLead;
  const canOperate = role === 'admin' || isLead || isMain;
  const isProjectOwnerReadOnly = !!data?.project_id && !canOperate && data.project_id !== null;
  const totals = useMemo(() => aggregate(cycle), [cycle]);
  const canLogActivityHours = (item: TestActivity) => !!developer
    && ['in_progress', 'paused'].includes(item.status)
    && (item.owner_id === developer.id || (item.participants ?? []).some((participant) => participant.developer_id === developer.id));
  const canManageActivityWorkEntry = (entry: WorkSegment) => {
    if (!workEntriesActivity) return false;
    const terminal = ['passed', 'failed', 'cancelled'].includes(cycle?.status ?? '')
      || ['done', 'delayed_done'].includes(workEntriesActivity.status);
    if (terminal) return canLead;
    if (entry.entry_source === 'automatic') return canLead;
    if (role === 'admin') return true;
    return ['in_progress', 'paused'].includes(workEntriesActivity.status)
      && entry.developer_id === developer?.id;
  };

  const run = async (name: string, params: Record<string, unknown>, close = true) => {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc(name, params);
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    if (close) setModal(null);
    setReason('');
    await load();
  };

  const transition = (action: string, needsReason = false) => {
    if (needsReason) {
      setReasonAction(action);
      setReason('');
      setModal('reason');
    } else if (cycle) {
      run('transition_test_cycle', { p_cycle_id: cycle.id, p_action: action, p_reason: null });
    }
  };

  const submitSchedule = (accept: boolean) => {
    if (!cycle) return;
    run('review_test_schedule', {
      p_cycle_id: cycle.id, p_accept: accept,
      p_main_tester_id: accept ? schedule.main_tester_id : null,
      p_planned_start: accept ? schedule.planned_start : null,
      p_planned_end: accept ? schedule.planned_end : null,
      p_participants: [], p_reason: accept ? schedule.reason.trim() || null : reason.trim(),
    });
  };

  const submitActivity = () => {
    if (!cycle) return;
    const validationError = validateActivity(activity);
    if (validationError) {
      setActivityError(validationError);
      return;
    }
    setActivityError('');
    run('add_test_activity', {
      p_cycle_id: cycle.id, p_activity_type: activity.activity_type,
      p_title: activity.title.trim(), p_owner_id: activity.owner_id,
      p_planned_start: activity.planned_start, p_planned_end: activity.planned_end,
      p_planned_hours: Number(activity.planned_hours), p_preconditions: activity.preconditions.trim() || null,
      p_expected_deliverable: activity.deliverable.trim() || null, p_participants: [],
    });
  };

  const submitBatch = () => {
    if (!cycle) return;
    const validationError = validateBatch(batch);
    if (validationError) {
      setBatchError(validationError);
      return;
    }
    setBatchError('');
    run('add_test_execution_batch', {
      p_cycle_id: cycle.id, p_activity_id: batch.activity_id || null, p_executed_on: batch.executed_on,
      p_environment_name: batch.environment_name.trim(), p_build_version: batch.build_version.trim(),
      p_test_type: batch.test_type, p_planned_count: Number(batch.planned_count), p_executed_count: Number(batch.executed_count),
      p_passed_count: Number(batch.passed_count), p_failed_count: Number(batch.failed_count),
      p_blocked_count: Number(batch.blocked_count), p_skipped_count: Number(batch.skipped_count),
      p_bug_count: Number(batch.bug_count), p_reopen_count: Number(batch.reopen_count),
      p_smoke_passed: batch.smoke_passed === '' ? null : batch.smoke_passed === 'yes',
      p_issue_summary: batch.issue_summary.trim() || null, p_blocker_summary: batch.blocker_summary.trim() || null,
      p_risk_summary: batch.risk_summary.trim() || null, p_zentao_url: batch.zentao_url.trim() || null,
    });
  };

  const submitConclusion = () => {
    if (!cycle) return;
    const submit = () => run('submit_test_conclusion', {
      p_cycle_id: cycle.id, p_result: conclusion.result, p_scope: conclusion.scope.trim(),
      p_completion: conclusion.completion.trim(), p_new_issues: conclusion.new_issues.trim(),
      p_legacy_issues: conclusion.legacy_issues.trim(), p_blockers: conclusion.blockers.trim(),
      p_risks: conclusion.risks.trim(), p_release_recommendation: conclusion.release_recommendation.trim(),
    });
    if (conclusion.result === 'fail' && data.source === 'internal_project') {
      if (!repairTaskId) { setError('测试不通过必须选择具体整改任务'); return; }
      setBusy(true);
      void supabase.rpc('link_test_repair_task', { p_cycle_id: cycle.id, p_repair_task_id: repairTaskId, p_scope_task_id: null })
        .then(({ error: linkError }) => {
          setBusy(false);
          if (linkError) setError(linkError.message);
          else submit();
        });
      return;
    }
    submit();
  };

  const createNextCycle = async () => {
    if (!data) return;
    if (!nextCycleVersion.trim()) {
      setNextCycleError('请填写新一轮的阶段 / 版本');
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_test_cycle', {
      p_plan_id: data.id, p_stage_version: nextCycleVersion.trim(), p_scope_note: null, p_report_types: [],
    });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else {
      setModal(null);
      setNextCycleVersion('');
      load();
    }
  };

  const openNextCycle = () => {
    setNextCycleVersion('');
    setNextCycleError('');
    setModal('nextCycle');
  };

  const openReportReason = (id: string) => {
    setReportId(id);
    setReportReason('');
    setReportReasonError('');
    setModal('reportReason');
  };

  const submitReportReason = () => {
    if (!reportReason.trim()) {
      setReportReasonError('请填写未出具原因');
      return;
    }
    run('set_test_report_status', { p_report_id: reportId, p_status: 'not_issued', p_not_issued_reason: reportReason.trim() });
  };

  const performReasonAction = () => {
    if (!cycle) return;
    if (reasonAction === 'schedule_return') return submitSchedule(false);
    if (reasonAction === 'conclusion_return') return run('review_test_conclusion', { p_cycle_id: cycle.id, p_confirm: false, p_reason: reason.trim() });
    run('transition_test_cycle', { p_cycle_id: cycle.id, p_action: reasonAction, p_reason: reason.trim() });
  };

  if (loading) return <div className="py-24 text-center text-slate-500">加载测试计划中…</div>;
  if (!data || !cycle) return <div className="space-y-4"><PageHeader title="测试计划" /><ErrorBox text={error || '测试计划不存在'} /></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.title}
        actions={<button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => navigate('/testing')}><ArrowLeft size={15} /> 测试中心</button>}
      />
      {error && <ErrorBox text={error} />}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge text={data.source === 'internal_project' ? '内部项目测试' : '外部独立测试'} tone="blue" />
              <Badge text={TEST_CYCLE_STATUS_LABEL[cycle.status]} tone={cycle.status === 'failed' ? 'red' : cycle.status === 'passed' ? 'green' : 'amber'} />
              <Badge text={`第 ${cycle.cycle_no} 轮 · ${cycle.stage_version}`} tone="slate" />
            </div>
            <h2 className="mt-3 text-lg font-semibold">{data.project_name ?? data.external_project_name}</h2>
            {data.source === 'external_request' && <p className="mt-1 text-sm text-slate-500">项目负责人（文本）：{data.external_owner_name}</p>}
            <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{data.test_scope}</p>
          </div>
          <div className="text-sm text-slate-500">
            <div>测试小组：{data.test_team_name}</div>
            <div className="mt-1">主测试负责人：{cycle.main_tester_name ?? '待确认'}</div>
            <div className="mt-1">计划：{cycle.planned_start ?? '—'} ~ {cycle.planned_end ?? '—'}</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {isProjectOwnerReadOnly && <span className="rounded-full bg-slate-500/10 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">只读访问</span>}
          {canLead && ['requested', 'returned'].includes(cycle.status) && (
            <>
              <button className={btnPrimary} onClick={() => { setSchedule((current) => ({ ...current, main_tester_id: data.recommended_owner_id ?? testPeople[0]?.id ?? '', planned_start: data.expected_start ?? today(), planned_end: data.expected_end ?? today() })); setModal('schedule'); }}>确认排期</button>
              <button className={btnGhost} onClick={() => { setReasonAction('schedule_return'); setReason(''); setModal('reason'); }}>退回申请</button>
            </>
          )}
          {canOperate && cycle.status === 'accepted' && <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => transition('start')}><Play size={15} /> 开始测试</button>}
          {canOperate && cycle.status === 'in_progress' && (
            <>
              <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => transition('pause', true)}><Pause size={15} /> 暂停</button>
              {canLead && <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => { setActivityError(''); setModal('activity'); }}><Plus size={15} /> 拆分活动</button>}
              <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => { setBatchError(''); setModal('batch'); }}><Activity size={15} /> 记录执行批次</button>
              {isMain || role === 'admin' ? <button className={btnPrimary} onClick={() => setModal('conclusion')}>提交结构化结论</button> : null}
            </>
          )}
          {canOperate && cycle.status === 'paused' && <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => transition('resume')}><RotateCcw size={15} /> 恢复</button>}
          {canLead && cycle.status === 'conclusion_pending' && (
            <>
              <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => run('review_test_conclusion', { p_cycle_id: cycle.id, p_confirm: true, p_reason: null })}><CheckCircle2 size={15} /> 确认结论</button>
              <button className={btnGhost} onClick={() => { setReasonAction('conclusion_return'); setReason(''); setModal('reason'); }}>退回修改</button>
            </>
          )}
          {canOperate && !['passed', 'failed', 'cancelled'].includes(cycle.status) && <button className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-500/10" onClick={() => transition('cancel', true)}><XCircle className="mr-1 inline" size={15} />取消轮次</button>}
          {['passed', 'failed', 'cancelled'].includes(cycle.status) && (role === 'admin' || data.source === 'external_request' || data.project_id) && (
            <button disabled={busy} className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={openNextCycle}><Plus size={15} /> 发起下一轮</button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="计划执行" value={String(totals.planned)} icon={<Gauge size={16} />} />
        <Metric label="实际执行" value={String(totals.executed)} icon={<Activity size={16} />} />
        <Metric label="通过 / 失败" value={`${totals.passed} / ${totals.failed}`} icon={<CheckCircle2 size={16} />} />
        <Metric label="阻塞" value={String(totals.blocked)} icon={<ShieldAlert size={16} />} danger={totals.blocked > 0} />
        <Metric label="新增 Bug / Reopen" value={`${totals.bugs} / ${totals.reopen}`} icon={<Bug size={16} />} danger={totals.bugs > 0} />
        <Metric label="本轮实际投入" value={formatEffort(cycle.actual_hours ?? cycle.activities.reduce((sum, item) => sum + Number(item.actual_hours ?? 0), 0))} icon={<Clock3 size={16} />} />
      </div>

      <Section title="范围快照" hint="只保存当时已审批开发任务的快照；历史审批记录不会随负责人变更而改写。">
        {cycle.scope_tasks.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {cycle.scope_tasks.map((raw: any) => <div key={raw.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><div className="font-medium">{raw.task_title_snapshot}</div><div className="mt-1 text-xs text-slate-500">{raw.task_owner_snapshot ?? '未分配'} · {STATUS_LABEL[raw.task_status_snapshot as keyof typeof STATUS_LABEL] ?? raw.task_status_snapshot} · 审批：{raw.approved_by_snapshot ?? '历史未记录'}</div></div>)}
          </div>
        ) : <Empty text={data.source === 'external_request' ? '外部测试不关联内部开发任务' : '本轮没有范围快照'} />}
      </Section>

      <Section title="测试活动与实际工时" hint="活动生成工作任务，但由测试中心状态机控制，不经过项目负责人审批。">
        <div className="space-y-2">
          {cycle.activities.map((item) => (
            <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(110px,.7fr)_minmax(150px,.9fr)_100px_100px_auto] dark:border-slate-700">
              <div className="min-w-0"><span className="block truncate font-medium">{item.title}</span><div className="mt-1 text-xs text-slate-500">{TEST_TYPE_LABEL[item.activity_type] ?? item.activity_type}</div></div>
              <div className="min-w-0"><div className="text-xs text-slate-500 lg:hidden">负责人</div><div className="truncate whitespace-nowrap">{item.owner_name}</div></div><div className="whitespace-nowrap"><div className="text-xs text-slate-500 lg:hidden">计划日期</div>{item.planned_start} ~ {item.planned_end}</div>
              <div className="whitespace-nowrap"><div className="text-xs text-slate-500">计划投入</div><div className="mt-1 font-medium">{formatEffort(item.planned_hours)}</div></div>
              <div className="whitespace-nowrap"><div className="text-xs text-slate-500">实际投入</div><div className="mt-1 font-medium">{formatEffort(item.actual_hours)}</div></div>
              <div className="flex flex-wrap gap-1 lg:justify-end">{item.task_id && <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700" onClick={() => setWorkEntriesActivity(item)}>工时明细</button>}{item.task_id && canLogActivityHours(item) && <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700" onClick={() => { setHoursActivity(item); setHours({ date: today(), hours: '1', note: '' }); }}>登记工时</button>}</div>
            </div>
          ))}
          {!cycle.activities.length && <Empty text="尚未拆分测试活动" />}
        </div>
      </Section>

      <Section title="执行批次" hint="分类数量之和必须等于实际执行数；修改数据必须带原因并留审计。">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="pb-3">日期 / 执行人</th><th>环境 / 构建</th><th>计划 / 执行</th><th>通过</th><th>失败</th><th>阻塞</th><th>跳过</th><th>Bug / Reopen</th><th>禅道</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {cycle.batches.map((item) => <tr key={item.id}><td className="py-3">{item.executed_on}<div className="text-xs text-slate-500">{item.executor_name}</div></td><td>{item.environment_name}<div className="text-xs text-slate-500">{item.build_version} · {TEST_TYPE_LABEL[item.test_type] ?? item.test_type}</div></td><td>{item.planned_count} / {item.executed_count}</td><td className="text-emerald-600">{item.passed_count}</td><td className="text-red-600">{item.failed_count}</td><td className="text-amber-600">{item.blocked_count}</td><td>{item.skipped_count}</td><td>{item.bug_count} / {item.reopen_count}</td><td>{item.zentao_url ? <a className="text-brand-600" target="_blank" rel="noreferrer" href={item.zentao_url}><ExternalLink size={14} /></a> : '—'}</td></tr>)}
              {!cycle.batches.length && <tr><td colSpan={9}><Empty text="尚未登记执行批次" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="报告状态" hint="只记录已出具/未出具；不上传文件，不采集报告链接、版本或编写人。">
        <div className="grid gap-3 md:grid-cols-2">
          {cycle.reports.map((report) => (
            <div key={report.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div><div className="font-medium">{report.report_name}</div><div className="mt-1 text-xs text-slate-500">{report.is_required ? '提交结论前必须完成状态' : '选填'}</div>{report.not_issued_reason && <div className="mt-1 text-xs text-amber-600">未出具：{report.not_issued_reason}</div>}</div>
              {canOperate && <div className="flex gap-2">
                <button disabled={busy} className={`rounded px-2 py-1 text-xs ${report.status === 'issued' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`} onClick={() => run('set_test_report_status', { p_report_id: report.id, p_status: 'issued', p_not_issued_reason: null }, false)}>已出具</button>
                <button disabled={busy} className={`rounded px-2 py-1 text-xs ${report.status === 'not_issued' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`} onClick={() => openReportReason(report.id)}>未出具</button>
              </div>}
            </div>
          ))}
          {!cycle.reports.length && <Empty text="本轮未要求测试报告" />}
        </div>
      </Section>

      {(cycle.proposed_result || ['passed', 'failed'].includes(cycle.status)) && (
        <Section title="结构化测试结论" hint="主测提交后由测试组长确认；测试组长确认不替代项目负责人逐项审批开发任务。">
          <div className="grid gap-3 md:grid-cols-2">
            <ConclusionItem label="结论" value={cycle.proposed_result === 'pass' ? '通过' : '不通过'} />
            <ConclusionItem label="测试范围" value={cycle.conclusion_scope} />
            <ConclusionItem label="完成情况" value={cycle.conclusion_completion} />
            <ConclusionItem label="本轮新问题" value={cycle.conclusion_new_issues} />
            <ConclusionItem label="遗留问题" value={cycle.conclusion_legacy_issues} />
            <ConclusionItem label="阻断项" value={cycle.conclusion_blockers} />
            <ConclusionItem label="风险" value={cycle.conclusion_risks} />
            <ConclusionItem label="发布建议" value={cycle.release_recommendation} />
          </div>
        </Section>
      )}

      <Modal title="确认测试排期" open={modal === 'schedule'} onClose={() => !busy && setModal(null)}>
        <div className="space-y-4">
          <Field label="主测试负责人 *"><Select value={schedule.main_tester_id} onChange={(value) => setSchedule({ ...schedule, main_tester_id: value })} options={testPeople.map((person) => ({ value: person.id, label: `${person.name}（${person.position}）` }))} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="计划开始 *"><DatePicker value={schedule.planned_start} onChange={(value) => setSchedule({ ...schedule, planned_start: value })} /></Field><Field label="计划结束 *"><DatePicker value={schedule.planned_end} onChange={(value) => setSchedule({ ...schedule, planned_end: value })} /></Field></div>
          <Field label="排期说明"><textarea className={`${inputCls} min-h-20`} value={schedule.reason} onChange={(e) => setSchedule({ ...schedule, reason: e.target.value })} /></Field>
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={() => submitSchedule(true)} text="确认并分配" />
        </div>
      </Modal>

      <Modal title="拆分测试活动" open={modal === 'activity'} onClose={() => !busy && setModal(null)}>
        <div className="space-y-4">
          {activityError && <FormError text={activityError} />}
          <Field label="活动名称 *"><input className={inputCls} value={activity.title} onChange={(e) => setActivity({ ...activity, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="类型 *"><Select value={activity.activity_type} onChange={(value) => setActivity({ ...activity, activity_type: value })} options={testTypeOptions} /></Field><Field label="负责人 *"><Select value={activity.owner_id} onChange={(value) => setActivity({ ...activity, owner_id: value })} options={testPeople.map((person) => ({ value: person.id, label: person.name }))} /></Field></div>
          <div className="grid grid-cols-3 gap-3"><Field label="开始 *"><DatePicker value={activity.planned_start} onChange={(value) => setActivity({ ...activity, planned_start: value })} /></Field><Field label="结束 *"><DatePicker value={activity.planned_end} onChange={(value) => setActivity({ ...activity, planned_end: value })} /></Field><Field label="计划工时 *"><input className={inputCls} type="number" min="0.1" step="0.5" value={activity.planned_hours} onChange={(e) => setActivity({ ...activity, planned_hours: e.target.value })} /></Field></div>
          <Field label="前置条件"><textarea className={`${inputCls} min-h-16`} value={activity.preconditions} onChange={(e) => setActivity({ ...activity, preconditions: e.target.value })} /></Field>
          <Field label="预期交付物"><textarea className={`${inputCls} min-h-16`} value={activity.deliverable} onChange={(e) => setActivity({ ...activity, deliverable: e.target.value })} /></Field>
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={submitActivity} text="创建活动任务" />
        </div>
      </Modal>

      <Modal title="记录执行批次" open={modal === 'batch'} onClose={() => !busy && setModal(null)} width="max-w-3xl">
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          {batchError && <FormError text={batchError} />}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="执行日期 *"><DatePicker value={batch.executed_on} onChange={(value) => setBatch({ ...batch, executed_on: value })} /></Field>
            <Field label="测试活动"><Select value={batch.activity_id} onChange={(value) => setBatch({ ...batch, activity_id: value })} options={cycle.activities.map((item) => ({ value: item.id, label: item.title }))} placeholder="可不关联具体活动" /></Field>
            <Field label="测试类型 *"><Select value={batch.test_type} onChange={(value) => setBatch({ ...batch, test_type: value, smoke_passed: value === 'smoke' ? batch.smoke_passed : '' })} options={testTypeOptions} /></Field>
            <Field label="环境 *"><input className={inputCls} value={batch.environment_name} onChange={(e) => setBatch({ ...batch, environment_name: e.target.value })} /></Field>
            <Field label="构建 / 版本 *"><input className={inputCls} value={batch.build_version} onChange={(e) => setBatch({ ...batch, build_version: e.target.value })} /></Field>
            {batch.test_type === 'smoke' && <Field label="冒烟结果 *"><Select value={batch.smoke_passed} onChange={(value) => setBatch({ ...batch, smoke_passed: value })} options={[{ value: '', label: '请选择' }, { value: 'yes', label: '通过' }, { value: 'no', label: '不通过' }]} /></Field>}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(['planned_count', 'executed_count', 'passed_count', 'failed_count', 'blocked_count', 'skipped_count', 'bug_count', 'reopen_count'] as const).map((key) => <Field key={key} label={`${batchLabel[key]} *`}><input className={inputCls} type="number" min="0" step="1" value={batch[key]} onChange={(e) => setBatch({ ...batch, [key]: e.target.value })} /></Field>)}
          </div>
          <div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800">校验：通过 + 失败 + 阻塞 + 跳过 = 实际执行。用例与 Bug 明细仍以禅道为唯一来源。</div>
          <div className="grid gap-3 md:grid-cols-2"><Field label="问题摘要"><textarea className={`${inputCls} min-h-16`} value={batch.issue_summary} onChange={(e) => setBatch({ ...batch, issue_summary: e.target.value })} /></Field><Field label="阻断摘要"><textarea className={`${inputCls} min-h-16`} value={batch.blocker_summary} onChange={(e) => setBatch({ ...batch, blocker_summary: e.target.value })} /></Field><Field label="风险摘要"><textarea className={`${inputCls} min-h-16`} value={batch.risk_summary} onChange={(e) => setBatch({ ...batch, risk_summary: e.target.value })} /></Field><Field label="禅道链接"><input className={inputCls} value={batch.zentao_url} onChange={(e) => setBatch({ ...batch, zentao_url: e.target.value })} /></Field></div>
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={submitBatch} text="保存执行批次" />
        </div>
      </Modal>

      <Modal title="提交结构化测试结论" open={modal === 'conclusion'} onClose={() => !busy && setModal(null)} width="max-w-3xl">
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <Field label="建议结论 *"><Select value={conclusion.result} onChange={(value) => setConclusion({ ...conclusion, result: value })} options={[{ value: 'pass', label: '通过' }, { value: 'fail', label: '不通过' }]} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['scope', '实际测试范围'], ['completion', '完成情况'], ['new_issues', '本轮新问题'],
              ['legacy_issues', '遗留问题'], ['blockers', '阻断项'], ['risks', '风险'],
              ['release_recommendation', '发布建议'],
            ] as const).map(([key, label]) => <Field key={key} label={`${label} *`}><textarea className={`${inputCls} min-h-20`} value={conclusion[key]} onChange={(e) => setConclusion({ ...conclusion, [key]: e.target.value })} placeholder={key === 'blockers' ? '无阻断也请填写“无”' : ''} /></Field>)}
          </div>
          {conclusion.result === 'fail' && data.source === 'internal_project' && (
            <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Field label="具体整改任务 *">
                <Select value={repairTaskId} onChange={setRepairTaskId} options={repairTasks.map((task) => ({ value: task.id, label: `${task.title}（${STATUS_LABEL[task.status]}）` }))} placeholder="选择同项目开发任务；不会批量打回全部任务" />
              </Field>
            </div>
          )}
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={submitConclusion} text="提交给测试组长确认" />
        </div>
      </Modal>

      <Modal title="填写原因" open={modal === 'reason'} onClose={() => !busy && setModal(null)}>
        <div className="space-y-4"><Field label="原因 *"><textarea className={`${inputCls} min-h-28`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Actions busy={busy} onCancel={() => setModal(null)} onConfirm={performReasonAction} text="确认" /></div>
      </Modal>
      <Modal title="发起下一轮测试" open={modal === 'nextCycle'} onClose={() => !busy && setModal(null)}>
        <div className="space-y-4">
          <Field label="阶段 / 版本 *"><input className={inputCls} value={nextCycleVersion} onChange={(e) => { setNextCycleVersion(e.target.value); setNextCycleError(''); }} /></Field>
          {nextCycleError && <div className="text-sm text-red-600 dark:text-red-400">{nextCycleError}</div>}
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={createNextCycle} text="创建新一轮" />
        </div>
      </Modal>
      <Modal title="填写未出具原因" open={modal === 'reportReason'} onClose={() => !busy && setModal(null)}>
        <div className="space-y-4">
          <Field label="未出具原因 *"><textarea className={`${inputCls} min-h-24`} value={reportReason} onChange={(e) => { setReportReason(e.target.value); setReportReasonError(''); }} /></Field>
          {reportReasonError && <div className="text-sm text-red-600 dark:text-red-400">{reportReasonError}</div>}
          <Actions busy={busy} onCancel={() => setModal(null)} onConfirm={submitReportReason} text="确认" />
        </div>
      </Modal>
      <Modal title={`登记实际工时 · ${hoursActivity?.title ?? ''}`} open={!!hoursActivity} onClose={() => !busy && setHoursActivity(null)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="日期"><DatePicker value={hours.date} onChange={(value) => setHours({ ...hours, date: value })} /></Field><Field label="工时"><input type="number" min="0.1" max="24" step="0.5" className={inputCls} value={hours.hours} onChange={(e) => setHours({ ...hours, hours: e.target.value })} /></Field></div>
          <Field label="说明"><textarea className={`${inputCls} min-h-20`} value={hours.note} onChange={(e) => setHours({ ...hours, note: e.target.value })} /></Field>
          <Actions busy={busy} onCancel={() => setHoursActivity(null)} onConfirm={() => {
            setBusy(true);
            void supabase.rpc('record_test_work_hours', { p_task_id: hoursActivity.task_id, p_work_date: hours.date, p_hours: Number(hours.hours), p_note: hours.note.trim() || null })
              .then(({ error: rpcError }) => {
                setBusy(false);
                if (rpcError) setError(rpcError.message);
                else { setHoursActivity(null); load(); }
              });
          }} text="保存工时" />
        </div>
      </Modal>
      <TestWorkEntriesModal taskId={workEntriesActivity?.task_id ?? null} title={workEntriesActivity?.title ?? ''} open={!!workEntriesActivity} onClose={() => setWorkEntriesActivity(null)} canManage={canManageActivityWorkEntry} />
    </div>
  );
}

const testTypeOptions = Object.entries(TEST_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const testTypes = new Set(Object.keys(TEST_TYPE_LABEL));
const batchCountKeys = ['planned_count', 'executed_count', 'passed_count', 'failed_count', 'blocked_count', 'skipped_count', 'bug_count', 'reopen_count'] as const;
const batchLabel = {
  planned_count: '计划数量', executed_count: '实际执行', passed_count: '通过',
  failed_count: '失败', blocked_count: '阻塞', skipped_count: '跳过',
  bug_count: '新增 Bug', reopen_count: 'Reopen',
};
function validateActivity(activity: {
  activity_type: string; title: string; owner_id: string; planned_start: string;
  planned_end: string; planned_hours: string;
}) {
  if (!activity.activity_type || !testTypes.has(activity.activity_type)) return '请选择有效的活动类型。';
  if (!activity.owner_id) return '请选择活动负责人。';
  if (!activity.title.trim()) return '请填写活动名称。';
  if (!activity.planned_start) return '请选择计划开始日期。';
  if (!activity.planned_end) return '请选择计划结束日期。';
  if (activity.planned_end < activity.planned_start) return '计划结束日期不能早于计划开始日期。';
  const plannedHours = Number(activity.planned_hours);
  if (!activity.planned_hours.trim() || !Number.isFinite(plannedHours) || plannedHours <= 0) return '计划工时必须是大于 0 的数字。';
  return '';
}
function validateBatch(batch: {
  executed_on: string; environment_name: string; build_version: string; test_type: string;
  planned_count: string; executed_count: string; passed_count: string; failed_count: string;
  blocked_count: string; skipped_count: string; bug_count: string; reopen_count: string;
  smoke_passed: string; zentao_url: string;
}) {
  if (!batch.executed_on) return '请选择批次执行日期。';
  if (!batch.environment_name.trim()) return '请填写测试环境。';
  if (!batch.build_version.trim()) return '请填写构建或版本号。';
  if (!batch.test_type || !testTypes.has(batch.test_type)) return '请选择有效的测试类型。';
  for (const key of batchCountKeys) {
    const value = Number(batch[key]);
    if (!batch[key].trim() || !Number.isInteger(value) || value < 0) return `${batchLabel[key]}必须是非负整数。`;
  }
  const planned = Number(batch.planned_count);
  const executed = Number(batch.executed_count);
  if (executed > planned) return '实际执行数量不能超过计划数量。';
  const resultTotal = Number(batch.passed_count) + Number(batch.failed_count) + Number(batch.blocked_count) + Number(batch.skipped_count);
  if (resultTotal !== executed) return '通过、失败、阻塞和跳过数量之和必须等于实际执行数量。';
  if (batch.test_type === 'smoke' && !['yes', 'no'].includes(batch.smoke_passed)) return '请选择冒烟测试结果。';
  if (batch.zentao_url.trim() && !/^https?:\/\/\S+$/i.test(batch.zentao_url.trim())) return '禅道链接必须是有效的 HTTP 或 HTTPS 地址。';
  return '';
}
function aggregate(cycle?: TestCycle) {
  return (cycle?.batches ?? []).reduce((sum, item) => ({
    planned: sum.planned + item.planned_count, executed: sum.executed + item.executed_count,
    passed: sum.passed + item.passed_count, failed: sum.failed + item.failed_count,
    blocked: sum.blocked + item.blocked_count, bugs: sum.bugs + item.bug_count, reopen: sum.reopen + item.reopen_count,
  }), { planned: 0, executed: 0, passed: 0, failed: 0, blocked: 0, bugs: 0, reopen: 0 });
}
function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><span className="text-xs text-slate-500">{hint}</span></div>{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><label className={labelCls}>{label}</label>{children}</div>; }
function Actions({ busy, onCancel, onConfirm, text }: { busy: boolean; onCancel: () => void; onConfirm: () => void; text: string }) { return <div className="flex justify-end gap-3"><button className={btnGhost} onClick={onCancel}>取消</button><button disabled={busy} className={btnPrimary} onClick={onConfirm}>{busy ? '处理中…' : text}</button></div>; }
function ErrorBox({ text }: { text: string }) { return <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{text}</div>; }
function FormError({ text }: { text: string }) { return <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{text}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">{text}</div>; }
function Badge({ text, tone }: { text: string; tone: 'blue' | 'red' | 'green' | 'amber' | 'slate' }) {
  const cls = { blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', red: 'bg-red-500/10 text-red-700 dark:text-red-300', green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-xs ${cls}`}>{text}</span>;
}
function Metric({ label, value, icon, danger = false }: { label: string; value: string; icon: React.ReactNode; danger?: boolean }) { return <div className={`rounded-xl border p-4 ${danger ? 'border-red-500/30 bg-red-500/5' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}><div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div><div className={`mt-2 text-xl font-semibold ${danger ? 'text-red-600' : ''}`}>{value}</div></div>; }
function ConclusionItem({ label, value }: { label: string; value: string | null }) { return <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 whitespace-pre-wrap text-sm">{value || '—'}</div></div>; }
