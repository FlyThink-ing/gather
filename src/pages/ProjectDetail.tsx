import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FlaskConical,
  Gauge,
  History,
  ShieldAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { btnGhost, inputCls, labelCls } from '../components/Modal';
import {
  PROJECT_STATUS_LABEL,
  STATUS_LABEL,
  TEST_RESULT_BADGE,
  TEST_RESULT_LABEL,
  type Developer,
  type ProjectCockpit,
  type ProjectTestSummary,
  type Team,
} from '../lib/types';
import { formatEffort } from '../lib/workload';

const pct = (value: number | null) => value == null ? '—' : `${value}%`;
const numberValue = (value: number | null | undefined) => value == null ? '—' : String(value);

export default function ProjectDetail() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { role, developer } = useAuth();
  const [data, setData] = useState<ProjectCockpit | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projectTest, setProjectTest] = useState<ProjectTestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completing, setCompleting] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [forceErr, setForceErr] = useState('');
  const [noTestOpen, setNoTestOpen] = useState(false);
  const [noTestReason, setNoTestReason] = useState('');
  const [noTestUrl, setNoTestUrl] = useState('');
  const [noTestSaving, setNoTestSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    const [cockpit, t, d, testing] = await Promise.all([
      supabase.rpc('get_project_cockpit', { p_project_id: id }),
      supabase.from('teams').select('*').order('name'),
      supabase.from('developers').select('*').order('name'),
      supabase.rpc('get_project_test_summary', { p_project_id: id }),
    ]);
    if (cockpit.error) setError(cockpit.error.message);
    setData((cockpit.data as ProjectCockpit) ?? null);
    setTeams((t.data as Team[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setProjectTest((testing.data as ProjectTestSummary) ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading) return;
    const section = searchParams.get('section');
    const restore = Number(searchParams.get('restoreScroll'));
    const timer = window.setTimeout(() => {
      if (section) document.getElementById(`project-${section}`)?.scrollIntoView({ block: 'start' });
      else if (Number.isFinite(restore) && restore > 0) window.scrollTo({ top: restore });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [loading, searchParams]);

  const teamName = teams.find((team) => team.id === data?.team_id)?.name ?? '-';
  const owner = developers.find((dev) => dev.id === data?.owner_id);
  const canComplete = !!data && data.status !== 'completed' &&
    (role === 'admin' || (!!developer && data.owner_id === developer.id));

  const taskUrl = useCallback((filters: Record<string, string>) => {
    const params = new URLSearchParams({
      source: 'project',
      project: id,
      returnTo: `/projects/${id}`,
      returnScroll: String(Math.round(window.scrollY)),
      ...filters,
    });
    return `/tasks?${params.toString()}`;
  }, [id]);

  const openTasks = (filters: Record<string, string>) => navigate(taskUrl(filters));

  const complete = async (force = false) => {
    if (!data) return;
    setCompleting(true);
    const { error: completeError } = await supabase.rpc('complete_project', {
      p_project_id: data.id,
      p_force: force,
      p_reason: force ? forceReason.trim() : null,
    });
    setCompleting(false);
    if (completeError) {
      if (role === 'admin') {
        setForceErr(completeError.message);
        setForceOpen(true);
      } else {
        setError(completeError.message);
      }
      return;
    }
    setForceOpen(false);
    setForceReason('');
    setForceErr('');
    load();
  };

  const submitNoTest = async () => {
    setNoTestSaving(true);
    const { error: rpcError } = await supabase.rpc('submit_no_test_request', {
      p_project_id: id,
      p_reason: noTestReason.trim(),
      p_related_url: noTestUrl.trim() || null,
    });
    setNoTestSaving(false);
    if (rpcError) return setError(rpcError.message);
    setNoTestOpen(false);
    setNoTestReason('');
    setNoTestUrl('');
    load();
  };

  const statusMetrics = useMemo(() => data ? [
    { label: '待处理', value: data.todo_count, filters: { status: 'todo' }, tone: 'slate' },
    { label: '进行中', value: data.in_progress_count, filters: { status: 'in_progress' }, tone: 'blue' },
    { label: '已挂起', value: data.paused_count, filters: { status: 'paused' }, tone: 'violet' },
    { label: '测试中', value: data.testing_active_count, filters: { preset: 'testing_active' }, tone: 'cyan' },
    { label: '待审批', value: data.review_count, filters: { status: 'review' }, tone: 'amber' },
    { label: '已完成', value: data.completed_task_count, filters: { status: 'done,delayed_done' }, tone: 'emerald' },
    { label: '延期完成', value: data.delayed_done_count, filters: { status: 'delayed_done' }, tone: 'orange' },
    { label: '已逾期', value: data.overdue_count, filters: { timing: 'overdue' }, tone: 'orange' },
    { label: '无负责人', value: data.unassigned_count, filters: { assignee: 'unassigned' }, tone: 'red' },
  ] as const : [], [data]);

  if (loading) return <div className="py-24 text-center text-slate-500">加载项目全景中…</div>;
  if (!data) return (
    <div>
      <PageHeader title="项目全景" />
      <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-6 text-red-700 dark:text-red-300">
        {error || '项目不存在或无权查看'}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.name}
        actions={(
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/projects')} className={`${btnGhost} inline-flex items-center gap-1.5`}><ArrowLeft size={15} /> 项目列表</button>
            {canComplete && (
              <button disabled={completing} onClick={() => complete(false)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                <CheckCircle2 size={15} /> {completing ? '检查中…' : '完成项目'}
              </button>
            )}
          </div>
        )}
      />

      {error && <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

      <section id="project-overview" className="scroll-mt-20 space-y-4">
        <SectionTitle icon={<Gauge size={18} />} title="项目概览" hint="聚合只做判断；点击数字到统一任务入口继续处理。" />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300">{PROJECT_STATUS_LABEL[data.status]}</span>
                <span className="text-sm text-slate-500">{teamName}</span>
              </div>
              <p className="mt-3 max-w-4xl whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-600 dark:text-slate-300">{data.description || '暂无项目描述'}</p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="inline-flex items-center gap-1.5"><UserRound size={14} /> 项目负责人：{owner?.name ?? '待指定'}</div>
              <div className="mt-2"><CalendarDays size={14} className="mr-1 inline" />{data.start_date ?? '?'} ~ {data.end_date ?? '?'}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric icon={<CalendarDays size={17} />} label="计划周期" value={data.plan_days == null ? '—' : `${data.plan_days} 天`} hint="计划开始至计划结束，含首尾" />
          <OverviewMetric icon={<Clock3 size={17} />} label={data.completed_at ? '实际周期' : '已运行周期'} value={data.actual_cycle_days == null ? '—' : `${data.actual_cycle_days} 天`} hint={data.actual_started_at ? `实际启动 ${new Date(data.actual_started_at).toLocaleString('zh-CN', { hour12: false })}` : '尚无可靠工时段，未伪造启动时间'} />
          <OverviewMetric icon={<Users size={17} />} label="实际投入" value={formatEffort(data.actual_effort_hours)} hint="全部工时段累加，不对并发人员去重" />
          <OverviewMetric icon={<Gauge size={17} />} label="开发完成率" value={`${data.dev_task_completed}/${data.dev_task_total} · ${pct(data.dev_completion_rate)}`} hint="仅统计开发任务" onClick={() => openTasks({ type: 'dev' })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionMetric label="全部开发任务" value={data.dev_task_total} hint="统一任务入口" onClick={() => openTasks({ type: 'dev' })} />
          <ActionMetric label="全部测试任务" value={data.test_task_total} hint={`共 ${data.test_round_total} 个测试轮次`} onClick={() => openTasks({ type: 'test' })} />
          <ActionMetric label="待审批任务" value={data.review_count} hint="由项目负责人逐项审批" onClick={() => openTasks({ status: 'review' })} />
          <ActionMetric label="当前风险" value={data.overdue_count + data.blocked_round_count} hint={`${data.overdue_count} 逾期 · ${data.blocked_round_count} 阻断`} onClick={() => openTasks({ timing: 'overdue' })} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">任务状态分布</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-9">
            {statusMetrics.map((metric) => (
              <StatusMetric key={metric.label} {...metric} onClick={() => openTasks(metric.filters)} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">“测试中”采用组合口径：开发任务处于 testing，加上尚未出结论的在办测试任务。</p>
        </div>
      </section>

      <section id="project-quality" className="scroll-mt-20 space-y-4">
        <SectionTitle icon={<FlaskConical size={18} />} title="测试与质量" hint="Bug 明细仍以禅道为唯一来源，本页只展示每轮汇总。" />
        {projectTest && (
          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">项目级测试门禁</h3>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                    {projectTest.test_state === 'passed' ? '测试已通过' : projectTest.test_state === 'no_test_approved' ? '无需测试已批准' : projectTest.test_state}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  {projectTest.plan_id
                    ? `${projectTest.plan_title} · ${projectTest.cycle_count} 轮 · 执行 ${projectTest.executed_count} · Bug ${projectTest.bug_count} · 实际投入 ${formatEffort(projectTest.test_actual_hours)}`
                    : projectTest.no_test_status === 'pending'
                      ? `无需测试申请待测试组长确认：${projectTest.no_test_reason}`
                      : '尚未发起项目级测试。开发任务不再从单个任务提测。'}
                </p>
                {projectTest.no_test_status === 'rejected' && <p className="mt-1 text-sm text-red-600">无需测试申请已退回：{projectTest.no_test_decision_note}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {projectTest.plan_id ? (
                  <button className={btnGhost} onClick={() => navigate(`/testing/plans/${projectTest.plan_id}`)}>查看测试计划</button>
                ) : (
                  <>
                    <button className={btnGhost} onClick={() => navigate(`/testing?view=plans&project=${id}`)}>发起项目测试</button>
                    {data.owner_id === developer?.id && projectTest.no_test_status !== 'pending' && (
                      <button className={btnGhost} onClick={() => setNoTestOpen(true)}>申请无需测试</button>
                    )}
                    {data.owner_id === developer?.id && projectTest.no_test_status === 'pending' && (
                      <button className={btnGhost} onClick={async () => {
                        const { error: rpcError } = await supabase.rpc('withdraw_no_test_request', { p_project_id: id });
                        if (rpcError) setError(rpcError.message); else load();
                      }}>撤回无需测试申请</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <QualityMetric label="累计新增 Bug" value={numberValue(projectTest?.plan_id ? projectTest.bug_count : data.cumulative_bug_count)} icon={<Bug size={16} />} />
          <QualityMetric label="Reopen" value={numberValue(projectTest?.plan_id ? projectTest.reopen_count : data.reopen_count)} icon={<History size={16} />} />
          <QualityMetric label="阻断数量" value={numberValue(projectTest?.plan_id ? projectTest.blocked_count : data.blocked_round_count)} icon={<ShieldAlert size={16} />} danger={(projectTest?.plan_id ? projectTest.blocked_count : data.blocked_round_count) > 0} />
          <QualityMetric label="测试通过率" value={projectTest?.plan_id ? pct(projectTest.passed_cycle_count + projectTest.failed_cycle_count ? Math.round(projectTest.passed_cycle_count * 1000 / (projectTest.passed_cycle_count + projectTest.failed_cycle_count)) / 10 : null) : pct(data.test_pass_rate)} icon={<CheckCircle2 size={16} />} hint="通过轮次 / 已确认结论轮次" />
          <QualityMetric label="结论覆盖率" value={projectTest?.plan_id ? pct(projectTest.cycle_count ? Math.round((projectTest.passed_cycle_count + projectTest.failed_cycle_count) * 1000 / projectTest.cycle_count) / 10 : null) : pct(data.summary_coverage_rate)} icon={<Gauge size={16} />} hint={projectTest?.plan_id ? `${projectTest.passed_cycle_count + projectTest.failed_cycle_count}/${projectTest.cycle_count}` : `${data.summary_covered_count}/${data.summary_expected_count}`} />
          <QualityMetric label="待确认/在办轮次" value={projectTest?.plan_id ? String(projectTest.active_cycle_count) : String(Math.max(0, data.summary_expected_count - data.summary_covered_count))} icon={<AlertTriangle size={16} />} danger={projectTest?.plan_id ? projectTest.active_cycle_count > 0 : data.summary_expected_count > data.summary_covered_count} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-white">历史单任务测试汇总</h3>
          </div>
          {data.quality_rounds.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">暂无已录入的测试汇总；历史空数据不会按 0 统计。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950/40">
                  <tr><th className="px-4 py-3">测试任务</th><th className="px-4 py-3">轮次 / 方式</th><th className="px-4 py-3">结论</th><th className="px-4 py-3">用例</th><th className="px-4 py-3">Bug / Reopen</th><th className="px-4 py-3">阻断</th><th className="px-4 py-3">禅道</th></tr>
                </thead>
                <tbody>
                  {data.quality_rounds.map((round) => {
                    const visibleResult = round.result ?? round.test_result;
                    return (
                    <tr key={round.id ?? `missing-${round.test_task_id}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="max-w-72 px-4 py-3"><button className="block max-w-full truncate font-medium text-slate-900 hover:text-brand-600 dark:text-white" onClick={() => openTasks({ focus: round.test_task_id })}>{round.test_task_title}</button><div className="mt-1 truncate text-xs text-slate-500">{round.tester_name ?? '未分配测试负责人'}</div>{round.linked_task_title && <div className="mt-0.5 max-w-full truncate text-xs text-slate-500">关联：{round.linked_task_title}</div>}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{round.summary_recorded ? `第 ${round.round_no} 轮` : '汇总未录入'}<div className="text-xs text-slate-500">{round.test_method === 'case_based' ? '标准用例' : round.test_method === 'exploratory' ? '快速 / 探索' : '历史测试任务'}</div>{round.summary_recorded && <div className="mt-1 text-[11px] text-slate-500">{round.started_at ? new Date(round.started_at).toLocaleDateString('zh-CN') : '—'} → {round.concluded_at ? new Date(round.concluded_at).toLocaleDateString('zh-CN') : '进行中'}</div>}</td>
                      <td className="px-4 py-3">{visibleResult ? <><span className={`rounded-full px-2 py-1 text-xs ${TEST_RESULT_BADGE[visibleResult]}`}>{TEST_RESULT_LABEL[visibleResult]}</span>{!round.summary_recorded && <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">仅历史结论，无结构化汇总</div>}</> : <span className="text-slate-500">进行中</span>}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{!round.summary_recorded ? '未录入' : round.test_method === 'case_based' ? `${round.executed_case_count ?? '—'} / ${round.planned_case_count ?? '—'}` : '不记录用例数'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{round.result ? `${round.bug_count ?? 0} / ${round.reopen_count ?? 0}` : '—'}</td>
                      <td className="px-4 py-3">{round.blocked ? <span className="rounded-full bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">主流程阻断</span> : <span className="text-slate-500">{round.summary_recorded ? '否' : '—'}</span>}</td>
                      <td className="px-4 py-3">{round.zentao_url ? <a className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400" href={round.zentao_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> 打开禅道</a> : <span className="text-slate-500">未关联</span>}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section id="project-people" className="scroll-mt-20 space-y-4">
        <SectionTitle icon={<Users size={18} />} title="人员与投入" hint="投入来自工时段；人员任务明细继续从统一任务入口查看。" />
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {data.people.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">暂无项目人员投入</div> : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950/40"><tr><th className="px-5 py-3">人员</th><th className="px-5 py-3">全部任务</th><th className="px-5 py-3">开发 / 测试</th><th className="px-5 py-3">已完成</th><th className="px-5 py-3">待审批 / 逾期</th><th className="px-5 py-3">实际投入</th><th className="px-5 py-3 text-right">查看</th></tr></thead>
                <tbody>{data.people.map((person) => (
                  <tr key={person.developer_id ?? 'unassigned'} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-5 py-3"><div className="font-medium text-slate-900 dark:text-white">{person.person_name}</div><div className="text-xs text-slate-500">{person.position ?? (person.developer_id ? '未设置职位' : '待分配')}</div></td>
                    <td className="px-5 py-3">{person.task_count}</td><td className="px-5 py-3">{person.dev_task_count} / {person.test_task_count}</td><td className="px-5 py-3">{person.completed_task_count}</td><td className="px-5 py-3">{person.review_task_count} / {person.overdue_task_count}</td><td className="px-5 py-3">{formatEffort(person.actual_effort_hours)}</td>
                    <td className="px-5 py-3 text-right"><button className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400" onClick={() => openTasks({ assignee: person.developer_id ?? 'unassigned' })}>任务明细 <ChevronRight size={13} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><History size={16} /> 项目阶段时间线</h3>
          {data.timeline.length === 0 ? <div className="py-6 text-sm text-slate-500">暂无阶段事件</div> : (
            <ol className="mt-4 space-y-3 border-l border-slate-200 pl-5 dark:border-slate-700">
              {data.timeline.map((event, index) => (
                <li key={`${event.event_type}-${event.occurred_at}-${index}`} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-900" />
                  <div className="flex flex-wrap items-center gap-x-3"><span className="text-sm font-medium text-slate-900 dark:text-white">{event.title}</span><span className="text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString('zh-CN', { hour12: false })}</span></div>
                  {event.detail && <div className="mt-0.5 text-xs text-slate-500">{event.detail}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <Modal title="管理员强制完成项目" open={forceOpen} onClose={() => setForceOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"><div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> 存在项目完成阻断项</div><p className="mt-1 leading-6">{forceErr}</p></div>
          <div><label className={labelCls}>强制完成原因 <span className="text-red-500">*</span></label><textarea className={`${inputCls} h-28 resize-none`} maxLength={2000} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="说明异常代办原因；内容会写入项目状态审计。" /></div>
          <div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setForceOpen(false)}>取消</button><button disabled={!forceReason.trim() || completing} onClick={() => complete(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"><ShieldAlert size={15} /> {completing ? '提交中…' : '确认强制完成'}</button></div>
        </div>
      </Modal>
      <Modal title="申请无需测试" open={noTestOpen} onClose={() => !noTestSaving && setNoTestOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            申请提交后仍视为“需要测试”，只有测试组长批准后才解除项目测试门禁。所有决定均保留审计。
          </div>
          <div><label className={labelCls}>无需测试原因 <span className="text-red-500">*</span></label><textarea className={`${inputCls} h-32 resize-none`} minLength={10} maxLength={1000} value={noTestReason} onChange={(e) => setNoTestReason(e.target.value)} placeholder="10～1000 字，说明为何本项目无需测试。" /></div>
          <div><label className={labelCls}>关联链接（选填）</label><input className={inputCls} value={noTestUrl} onChange={(e) => setNoTestUrl(e.target.value)} placeholder="https://..." /></div>
          <div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setNoTestOpen(false)}>取消</button><button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={noTestSaving || noTestReason.trim().length < 10} onClick={submitNoTest}>{noTestSaving ? '提交中…' : '提交测试组长确认'}</button></div>
        </div>
      </Modal>
    </div>
  );
}

function SectionTitle({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return <div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">{icon}{title}</h2><p className="mt-1 text-sm text-slate-500">{hint}</p></div>;
}

function OverviewMetric({ icon, label, value, hint, onClick }: { icon: React.ReactNode; label: string; value: string; hint: string; onClick?: () => void }) {
  const content = <><div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div><div className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{value}</div><div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div></>;
  return onClick ? <button onClick={onClick} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:bg-brand-500/5 dark:border-slate-800 dark:bg-slate-900">{content}</button> : <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">{content}</div>;
}

function ActionMetric({ label, value, hint, onClick }: { label: string; value: number; hint: string; onClick: () => void }) {
  return <button onClick={onClick} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900"><span><span className="block text-xs text-slate-500">{label}</span><span className="mt-1 block text-2xl font-semibold text-slate-950 dark:text-white">{value}</span><span className="mt-1 block text-[11px] text-slate-500">{hint}</span></span><ChevronRight className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500" size={18} /></button>;
}

const STATUS_TONE: Record<string, string> = {
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300', amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300', red: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

function StatusMetric({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-xl px-3 py-2 text-left transition hover:-translate-y-0.5 ${STATUS_TONE[tone]}`}><span className="block truncate text-[11px] opacity-80">{label}</span><span className="mt-1 block text-xl font-semibold">{value}</span></button>;
}

function QualityMetric({ label, value, icon, hint, danger = false, onClick }: { label: string; value: string; icon: React.ReactNode; hint?: string; danger?: boolean; onClick?: () => void }) {
  const cls = `rounded-2xl border p-4 text-left ${danger ? 'border-red-500/30 bg-red-500/5' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'} ${onClick ? 'transition hover:border-brand-400' : ''}`;
  const content = <><div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div><div className={`mt-2 text-2xl font-semibold ${danger ? 'text-red-700 dark:text-red-300' : 'text-slate-950 dark:text-white'}`}>{value}</div>{hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}</>;
  return onClick ? <button className={cls} onClick={onClick}>{content}</button> : <div className={cls}>{content}</div>;
}
