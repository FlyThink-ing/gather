import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Boxes, ChevronRight, ClipboardCheck, FlaskConical,
  FolderKanban, Plus, RefreshCw, ShieldAlert, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { btnGhost, btnPrimary, inputCls, labelCls } from '../components/Modal';
import Select from '../components/Select';
import DatePicker from '../components/DatePicker';
import {
  CONSTRUCTION_STATUS_LABEL, PRIORITY_LABEL, TEST_CYCLE_STATUS_LABEL,
  type ConstructionSummary, type Developer, type Priority, type Project,
  type Team, type TestPlanSource, type TestPlanSummary,
} from '../lib/types';
import { formatEffort } from '../lib/workload';

type View = 'plans' | 'construction' | 'resources';
type PageData<T> = { items: T[]; total: number; page: number; page_size: number };
type EligibleInternalProject = {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
  test_state: string;
  eligible_task_count: number;
};
type EligibleProjectResult = {
  items: EligibleInternalProject[];
  owned_project_count: number;
  inactive_count: number;
  no_test_approved_count: number;
  active_cycle_count: number;
  no_eligible_task_count: number;
};
type PendingNoTestProject = Pick<Project, 'id' | 'name' | 'no_test_status' | 'no_test_reason'>;

const today = () => new Date().toISOString().slice(0, 10);
const dayAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function TestingCenter() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { role, developer } = useAuth();
  const view = (params.get('view') as View) || 'plans';
  const [plans, setPlans] = useState<PageData<TestPlanSummary>>({ items: [], total: 0, page: 1, page_size: 20 });
  const [construction, setConstruction] = useState<PageData<ConstructionSummary>>({ items: [], total: 0, page: 1, page_size: 20 });
  const [resources, setResources] = useState<{ rows: any[]; totals: Record<string, number> }>({ rows: [], totals: {} });
  const [teams, setTeams] = useState<Team[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [eligibleProjects, setEligibleProjects] = useState<EligibleInternalProject[]>([]);
  const [eligibleProjectResult, setEligibleProjectResult] = useState<EligibleProjectResult>({
    items: [], owned_project_count: 0, inactive_count: 0,
    no_test_approved_count: 0, active_cycle_count: 0, no_eligible_task_count: 0,
  });
  const [projectSearch, setProjectSearch] = useState('');
  const [pendingNoTest, setPendingNoTest] = useState<PendingNoTestProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [constructionOpen, setConstructionOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [noTestReviewProject, setNoTestReviewProject] = useState<PendingNoTestProject | null>(null);
  const [noTestReason, setNoTestReason] = useState('');
  const [noTestReasonError, setNoTestReasonError] = useState('');
  const [noTestReviewing, setNoTestReviewing] = useState(false);

  const testTeams = teams.filter((team) => team.is_test_team);
  const testPeople = developers.filter((item) =>
    item.is_active && ['测试工程师', '自动化测试工程师'].includes(item.position ?? ''));
  const canCreateExternal = role === 'admin' || ['测试工程师', '自动化测试工程师'].includes(developer?.position ?? '');
  const canCreateConstruction = role === 'admin' || developer?.position === '自动化测试工程师'
    || testTeams.some((team) => team.leader_id === developer?.id);
  const canReviewNoTest = role === 'admin' || testTeams.some((team) => team.leader_id === developer?.id);
  const canCreateInternal = eligibleProjectResult.owned_project_count > 0;

  const defaultProject = params.get('project') ?? '';
  const [planForm, setPlanForm] = useState({
    source: (defaultProject ? 'internal_project' : 'external_request') as TestPlanSource,
    title: '',
    project_id: defaultProject,
    external_project_name: '',
    external_owner_name: '',
    version_name: '',
    test_scope: '',
    test_goal: '',
    deliverables: '',
    expected_start: today(),
    expected_end: dayAfter(7),
    environment_note: '',
    priority: 'medium' as Priority,
    related_url: '',
    zentao_url: '',
    test_team_id: '',
    recommended_owner_id: '',
    reports: [] as string[],
  });
  const [constructionForm, setConstructionForm] = useState({
    title: '', work_type: 'automation_script', goal: '', priority: 'medium' as Priority,
    owner_id: developer?.id ?? '', planned_start: today(), planned_end: dayAfter(14),
    deliverables: '', acceptance_criteria: '', resource_links: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [teamRes, devRes, eligibleRes, pendingNoTestRes, planRes, constructionRes, resourceRes] = await Promise.all([
      supabase.from('teams').select('*').order('name'),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.rpc('get_eligible_internal_test_projects', { p_search: null }),
      supabase.from('projects').select('id,name,no_test_status,no_test_reason').eq('no_test_status', 'pending').order('name'),
      supabase.rpc('get_testing_center', {
        p_source: params.get('source') || null,
        p_status: params.get('status') || null,
        p_page: Number(params.get('page')) || 1,
        p_page_size: 20,
      }),
      supabase.rpc('get_construction_works', {
        p_status: params.get('status') || null,
        p_page: Number(params.get('page')) || 1,
        p_page_size: 20,
      }),
      supabase.rpc('get_test_resource_summary', {
        p_from: params.get('from') || null,
        p_to: params.get('to') || null,
      }),
    ]);
    setTeams((teamRes.data as Team[]) ?? []);
    setDevelopers((devRes.data as Developer[]) ?? []);
    const eligibleData = (eligibleRes.data as EligibleProjectResult) ?? {
      items: [], owned_project_count: 0, inactive_count: 0,
      no_test_approved_count: 0, active_cycle_count: 0, no_eligible_task_count: 0,
    };
    setEligibleProjects(eligibleData.items ?? []);
    setEligibleProjectResult(eligibleData);
    setPendingNoTest((pendingNoTestRes.data as PendingNoTestProject[]) ?? []);
    setPlanForm((current) => current.project_id && !(eligibleData.items ?? []).some((project) => project.id === current.project_id)
      ? { ...current, project_id: '' }
      : current);
    setPlans((planRes.data as PageData<TestPlanSummary>) ?? { items: [], total: 0, page: 1, page_size: 20 });
    setConstruction((constructionRes.data as PageData<ConstructionSummary>) ?? { items: [], total: 0, page: 1, page_size: 20 });
    setResources((resourceRes.data as any) ?? { rows: [], totals: {} });
    const firstError = eligibleRes.error ?? pendingNoTestRes.error ?? planRes.error ?? constructionRes.error ?? resourceRes.error;
    if (firstError) setError(firstError.message);
    setLoading(false);
  }, [params]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void supabase.rpc('get_eligible_internal_test_projects', { p_search: projectSearch.trim() || null })
        .then(({ data: result, error: rpcError }) => {
          if (rpcError) {
            setError(rpcError.message);
            return;
          }
          const next = result as EligibleProjectResult;
          setEligibleProjects(next?.items ?? []);
          if (next) setEligibleProjectResult(next);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [projectSearch]);

  useEffect(() => {
    if (!planForm.test_team_id && testTeams[0]) {
      setPlanForm((current) => ({ ...current, test_team_id: testTeams[0].id }));
    }
  }, [planForm.test_team_id, testTeams]);

  const setView = (next: View) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('view', next);
    nextParams.delete('status');
    nextParams.delete('page');
    setParams(nextParams);
  };

  const toggleReport = (value: string) => setPlanForm((current) => ({
    ...current,
    reports: current.reports.includes(value)
      ? current.reports.filter((item) => item !== value)
      : [...current.reports, value],
  }));

  const createPlan = async () => {
    setFormError('');
    if (!planForm.title.trim() || !planForm.test_scope.trim() || !planForm.test_goal.trim()) {
      return setFormError('计划名称、测试范围和测试目标必填');
    }
    if (!planForm.test_team_id) return setFormError('请先在小组管理中标记测试小组');
    if (planForm.source === 'internal_project' &&
      (!planForm.project_id || !eligibleProjects.some((project) => project.id === planForm.project_id))) {
      return setFormError('请选择当前可发起测试的内部项目');
    }
    if (planForm.source === 'external_request' &&
      (!planForm.external_project_name.trim() || !planForm.external_owner_name.trim())) {
      return setFormError('外部项目名称和项目负责人必填');
    }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('create_test_plan', {
      p_source: planForm.source,
      p_title: planForm.title.trim(),
      p_test_team_id: planForm.test_team_id,
      p_project_id: planForm.source === 'internal_project' ? planForm.project_id : null,
      p_external_project_name: planForm.source === 'external_request' ? planForm.external_project_name.trim() : null,
      p_external_owner_name: planForm.source === 'external_request' ? planForm.external_owner_name.trim() : null,
      p_version_name: planForm.version_name.trim() || null,
      p_test_scope: planForm.test_scope.trim(),
      p_test_goal: planForm.test_goal.trim(),
      p_deliverables: planForm.deliverables.trim() || null,
      p_expected_start: planForm.expected_start || null,
      p_expected_end: planForm.expected_end || null,
      p_environment_note: planForm.environment_note.trim() || null,
      p_priority: planForm.priority,
      p_related_url: planForm.related_url.trim() || null,
      p_zentao_url: planForm.zentao_url.trim() || null,
      p_recommended_owner_id: planForm.recommended_owner_id || null,
      p_report_types: planForm.reports,
    });
    setSaving(false);
    if (rpcError) return setFormError(rpcError.message);
    setPlanOpen(false);
    navigate(`/testing/plans/${data}`);
  };

  const createConstruction = async () => {
    setFormError('');
    if (!constructionForm.title.trim() || !constructionForm.goal.trim()
      || !constructionForm.deliverables.trim() || !constructionForm.acceptance_criteria.trim()) {
      return setFormError('标题、目标、预期成果和验收标准必填');
    }
    if (!constructionForm.owner_id) return setFormError('请选择建设负责人');
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('create_test_construction', {
      p_title: constructionForm.title.trim(),
      p_work_type: constructionForm.work_type,
      p_goal: constructionForm.goal.trim(),
      p_priority: constructionForm.priority,
      p_owner_id: constructionForm.owner_id,
      p_planned_start: constructionForm.planned_start || null,
      p_planned_end: constructionForm.planned_end || null,
      p_deliverables: constructionForm.deliverables.trim(),
      p_acceptance_criteria: constructionForm.acceptance_criteria.trim(),
      p_resource_links: constructionForm.resource_links.trim() || null,
      p_participants: [],
    });
    setSaving(false);
    if (rpcError) return setFormError(rpcError.message);
    setConstructionOpen(false);
    navigate(`/testing/construction/${data}`);
  };

  const openPlanModal = (source: TestPlanSource) => {
    setFormError('');
    if (source === 'internal_project') setProjectSearch('');
    setPlanForm((current) => ({ ...current, source }));
    setPlanOpen(true);
  };

  const reviewNoTest = async (project: PendingNoTestProject, approve: boolean, reason: string | null = null) => {
    setNoTestReviewing(true);
    const { error: rpcError } = await supabase.rpc('review_no_test_request', {
      p_project_id: project.id, p_approve: approve, p_reason: reason?.trim() || null,
    });
    setNoTestReviewing(false);
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    await load();
    return true;
  };

  const openNoTestReturn = (project: PendingNoTestProject) => {
    setNoTestReviewProject(project);
    setNoTestReason('');
    setNoTestReasonError('');
  };

  const submitNoTestReturn = async () => {
    if (!noTestReviewProject) return;
    if (!noTestReason.trim()) {
      setNoTestReasonError('请填写退回原因');
      return;
    }
    if (await reviewNoTest(noTestReviewProject, false, noTestReason)) setNoTestReviewProject(null);
  };

  const totals = resources.totals ?? {};
  const resourceByPerson = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of resources.rows ?? []) {
      const current = map.get(row.developer_id) ?? {
        developer_id: row.developer_id, name: row.name, position: row.position,
        internal_project: 0, external_request: 0, construction: 0, planned: 0, conflict_count: 0,
      };
      current[row.source] = Number(row.actual_hours ?? 0);
      current.planned += Number(row.planned_hours ?? 0);
      current.conflict_count = Math.max(current.conflict_count, Number(row.conflict_count ?? 0));
      map.set(row.developer_id, current);
    }
    return [...map.values()];
  }, [resources]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="测试中心"
        actions={(
          <div className="flex flex-wrap gap-2">
            <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={load}><RefreshCw size={15} /> 刷新</button>
            {view === 'plans' && (
              <>
                {canCreateInternal && (
                  <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={() => openPlanModal('internal_project')}>
                    <FolderKanban size={15} /> 发起内部测试
                  </button>
                )}
                {canCreateExternal && (
                  <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => openPlanModal('external_request')}>
                    <Plus size={15} /> 登记外部测试
                  </button>
                )}
              </>
            )}
            {view === 'construction' && canCreateConstruction && (
              <button className={`${btnPrimary} inline-flex items-center gap-1.5`} onClick={() => { setFormError(''); setConstructionOpen(true); }}>
                <Plus size={15} /> 新建建设工作
              </button>
            )}
          </div>
        )}
      />

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <Tab active={view === 'plans'} onClick={() => setView('plans')} icon={<FlaskConical size={16} />} label="测试计划" />
        <Tab active={view === 'construction'} onClick={() => setView('construction')} icon={<Boxes size={16} />} label="测试建设" />
        <Tab active={view === 'resources'} onClick={() => setView('resources')} icon={<Users size={16} />} label="资源汇总" />
      </div>

      {error && <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {testTeams.length === 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          尚未配置测试小组。管理员需先在“小组管理”中标记测试小组并指定组长，之后才能确认排期与结论。
        </div>
      )}
      {view === 'plans' && pendingNoTest.length > 0 && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <div className="mb-3 flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200"><ShieldAlert size={17} /> 无需测试申请待确认</div>
          <div className="space-y-2">
            {pendingNoTest.map((project) => (
              <div key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/70 p-3 text-sm dark:bg-slate-900/70">
                <div><div className="font-medium">{project.name}</div><div className="mt-1 max-w-3xl text-xs text-slate-500">{project.no_test_reason}</div></div>
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => navigate(`/projects/${project.id}?section=quality`)}>查看项目</button>
                  {canReviewNoTest && <><button disabled={noTestReviewing} className={btnGhost} onClick={() => openNoTestReturn(project)}>退回</button><button disabled={noTestReviewing} className={btnPrimary} onClick={() => reviewNoTest(project, true)}>批准无需测试</button></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center text-slate-500">加载测试中心中…</div>
      ) : view === 'plans' ? (
        <PlanList items={plans.items} onOpen={(id) => navigate(`/testing/plans/${id}`)} />
      ) : view === 'construction' ? (
        <ConstructionList items={construction.items} onOpen={(id) => navigate(`/testing/construction/${id}`)} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="内部项目测试实际工时" value={formatEffort(Number(totals.internal_project ?? 0))} />
            <Metric label="外部独立测试实际工时" value={formatEffort(Number(totals.external_request ?? 0))} />
            <Metric label="测试建设实际工时" value={formatEffort(Number(totals.construction ?? 0))} />
            <Metric label="三来源实际工时合计" value={formatEffort(Number(totals.internal_project ?? 0) + Number(totals.external_request ?? 0) + Number(totals.construction ?? 0))} />
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950/60">
                <tr><th className="px-4 py-3">人员</th><th>计划工时</th><th>内部项目</th><th>外部测试</th><th>测试建设</th><th>并发冲突</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {resourceByPerson.map((row) => (
                  <tr key={row.developer_id}>
                    <td className="px-4 py-3"><div className="font-medium">{row.name}</div><div className="text-xs text-slate-500">{row.position}</div></td>
                    <td>{formatEffort(row.planned)}</td><td>{formatEffort(row.internal_project)}</td>
                    <td>{formatEffort(row.external_request)}</td><td>{formatEffort(row.construction)}</td>
                    <td>{row.conflict_count > 0 ? <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">{row.conflict_count} 组重叠</span> : <span className="text-slate-500">无</span>}</td>
                  </tr>
                ))}
                {resourceByPerson.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">暂无已登记资源数据</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">这里只做三来源工作量与冲突识别，不作为个人绩效排名。</p>
        </div>
      )}

      <Modal title={planForm.source === 'internal_project' ? '发起内部项目测试' : '登记外部独立测试'} open={planOpen} onClose={() => !saving && setPlanOpen(false)} width="max-w-3xl">
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            测试单位是项目/阶段/版本轮次，不再从单个开发任务提测。内部测试自动快照尚未被通过轮次覆盖的已审批开发任务。
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="测试计划名称 *"><input className={inputCls} value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} /></Field>
            <Field label="测试小组 *"><Select value={planForm.test_team_id} onChange={(value) => setPlanForm({ ...planForm, test_team_id: value })} options={testTeams.map((team) => ({ value: team.id, label: team.name }))} placeholder="请选择测试小组" /></Field>
            {planForm.source === 'internal_project' ? (
              <div>
                <Field label="内部项目 *">
                  <div className="space-y-2">
                    <input className={inputCls} value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="搜索本人负责的项目" />
                    <Select
                      value={planForm.project_id}
                      onChange={(value) => setPlanForm({ ...planForm, project_id: value })}
                      options={eligibleProjects.map((project) => ({
                        value: project.id,
                        label: `${project.name} · ${project.team_name} · ${projectTestStateLabel[project.test_state] ?? project.test_state} · ${project.eligible_task_count} 个可纳入任务`,
                      }))}
                      placeholder="仅显示当前可发起测试的项目"
                    />
                  </div>
                </Field>
                {eligibleProjects.length === 0 && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{eligibleProjectEmptyText(eligibleProjectResult, projectSearch)}</p>}
              </div>
            ) : (
              <>
                <Field label="外部项目名称 *"><input className={inputCls} value={planForm.external_project_name} onChange={(e) => setPlanForm({ ...planForm, external_project_name: e.target.value })} /></Field>
                <Field label="项目负责人（文本） *"><input className={inputCls} value={planForm.external_owner_name} onChange={(e) => setPlanForm({ ...planForm, external_owner_name: e.target.value })} placeholder="不要求对方登录系统" /></Field>
              </>
            )}
            <Field label="阶段 / 版本"><input className={inputCls} value={planForm.version_name} onChange={(e) => setPlanForm({ ...planForm, version_name: e.target.value })} /></Field>
            <Field label="优先级"><Select value={planForm.priority} onChange={(value) => setPlanForm({ ...planForm, priority: value as Priority })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="期望开始"><DatePicker value={planForm.expected_start} onChange={(value) => setPlanForm({ ...planForm, expected_start: value })} /></Field>
            <Field label="期望结束"><DatePicker value={planForm.expected_end} onChange={(value) => setPlanForm({ ...planForm, expected_end: value })} /></Field>
            <Field label="建议主测"><Select value={planForm.recommended_owner_id} onChange={(value) => setPlanForm({ ...planForm, recommended_owner_id: value })} options={testPeople.map((person) => ({ value: person.id, label: person.name }))} placeholder="由测试组长最终确认" /></Field>
          </div>
          <Field label="测试范围 *"><textarea className={`${inputCls} min-h-24`} value={planForm.test_scope} onChange={(e) => setPlanForm({ ...planForm, test_scope: e.target.value })} /></Field>
          <Field label="测试目标 *"><textarea className={`${inputCls} min-h-20`} value={planForm.test_goal} onChange={(e) => setPlanForm({ ...planForm, test_goal: e.target.value })} /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="环境说明"><textarea className={`${inputCls} min-h-20`} value={planForm.environment_note} onChange={(e) => setPlanForm({ ...planForm, environment_note: e.target.value })} /></Field>
            <Field label="预期交付物"><textarea className={`${inputCls} min-h-20`} value={planForm.deliverables} onChange={(e) => setPlanForm({ ...planForm, deliverables: e.target.value })} /></Field>
            <Field label="相关链接"><input className={inputCls} value={planForm.related_url} onChange={(e) => setPlanForm({ ...planForm, related_url: e.target.value })} /></Field>
            <Field label="禅道链接"><input className={inputCls} value={planForm.zentao_url} onChange={(e) => setPlanForm({ ...planForm, zentao_url: e.target.value })} /></Field>
          </div>
          <div>
            <label className={labelCls}>本轮要求的报告</label>
            <div className="flex flex-wrap gap-2">
              {[['system', '系统测试报告'], ['performance', '性能测试报告'], ['security', '安全测试报告'], ['compatibility', '兼容性测试报告']].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <input type="checkbox" checked={planForm.reports.includes(value)} onChange={() => toggleReport(value)} /> {label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">系统只记录“已出具/未出具”，不上传或关联报告文件。</p>
          </div>
          {formError && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{formError}</div>}
          <div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setPlanOpen(false)}>取消</button><button disabled={saving} className={btnPrimary} onClick={createPlan}>{saving ? '提交中…' : '提交测试申请'}</button></div>
        </div>
      </Modal>

      <Modal title="新建测试建设工作" open={constructionOpen} onClose={() => !saving && setConstructionOpen(false)} width="max-w-2xl">
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            测试建设不关联项目或测试计划，不采集用例、Bug、Reopen 等执行质量指标，也不计入项目测试成本。
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="标题 *"><input className={inputCls} value={constructionForm.title} onChange={(e) => setConstructionForm({ ...constructionForm, title: e.target.value })} /></Field>
            <Field label="类型"><Select value={constructionForm.work_type} onChange={(value) => setConstructionForm({ ...constructionForm, work_type: value })} options={[
              { value: 'automation_framework', label: '自动化框架' }, { value: 'automation_script', label: '自动化脚本' },
              { value: 'tooling', label: '测试工具' }, { value: 'environment', label: '环境建设' },
              { value: 'data_preparation', label: '数据准备' }, { value: 'platform', label: '平台建设' }, { value: 'other', label: '其他' },
            ]} /></Field>
            <Field label="负责人 *"><Select value={constructionForm.owner_id} onChange={(value) => setConstructionForm({ ...constructionForm, owner_id: value })} options={testPeople.map((person) => ({ value: person.id, label: `${person.name}（${person.position}）` }))} /></Field>
            <Field label="优先级"><Select value={constructionForm.priority} onChange={(value) => setConstructionForm({ ...constructionForm, priority: value as Priority })} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="计划开始"><DatePicker value={constructionForm.planned_start} onChange={(value) => setConstructionForm({ ...constructionForm, planned_start: value })} /></Field>
            <Field label="计划结束"><DatePicker value={constructionForm.planned_end} onChange={(value) => setConstructionForm({ ...constructionForm, planned_end: value })} /></Field>
          </div>
          <Field label="建设目标 *"><textarea className={`${inputCls} min-h-20`} value={constructionForm.goal} onChange={(e) => setConstructionForm({ ...constructionForm, goal: e.target.value })} /></Field>
          <Field label="预期成果 *"><textarea className={`${inputCls} min-h-20`} value={constructionForm.deliverables} onChange={(e) => setConstructionForm({ ...constructionForm, deliverables: e.target.value })} /></Field>
          <Field label="成果确认标准 *"><textarea className={`${inputCls} min-h-20`} value={constructionForm.acceptance_criteria} onChange={(e) => setConstructionForm({ ...constructionForm, acceptance_criteria: e.target.value })} /></Field>
          <Field label="代码库 / 文档 / 流水线链接"><textarea className={`${inputCls} min-h-16`} value={constructionForm.resource_links} onChange={(e) => setConstructionForm({ ...constructionForm, resource_links: e.target.value })} /></Field>
          {formError && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{formError}</div>}
          <div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setConstructionOpen(false)}>取消</button><button disabled={saving} className={btnPrimary} onClick={createConstruction}>{saving ? '保存中…' : '创建草稿'}</button></div>
        </div>
      </Modal>

      <Modal title="退回无需测试申请" open={!!noTestReviewProject} onClose={() => !noTestReviewing && setNoTestReviewProject(null)}>
        <div className="space-y-4">
          <div className="text-sm text-slate-600 dark:text-slate-300">请填写退回「{noTestReviewProject?.name}」申请的原因。</div>
          <Field label="退回原因 *"><textarea className={`${inputCls} min-h-24`} value={noTestReason} onChange={(e) => { setNoTestReason(e.target.value); setNoTestReasonError(''); }} /></Field>
          {noTestReasonError && <div className="text-sm text-red-600 dark:text-red-400">{noTestReasonError}</div>}
          <div className="flex justify-end gap-3"><button disabled={noTestReviewing} className={btnGhost} onClick={() => setNoTestReviewProject(null)}>取消</button><button disabled={noTestReviewing} className={btnPrimary} onClick={submitNoTestReturn}>{noTestReviewing ? '提交中…' : '确认退回'}</button></div>
        </div>
      </Modal>
    </div>
  );
}

const projectTestStateLabel: Record<string, string> = {
  not_requested: '未发起测试',
  requested: '待确认排期',
  accepted: '待开始',
  testing: '测试中',
  conclusion_pending: '结论待确认',
  fixing: '整改中',
  passed: '测试通过',
  no_test_approved: '无需测试已批准',
};

function eligibleProjectEmptyText(result: EligibleProjectResult, search: string) {
  if (search.trim()) return '没有匹配且当前可发起测试的项目。';
  if (result.owned_project_count === 0) return '你不是任何项目负责人，不能发起内部项目测试。';
  const reasons: string[] = [];
  if (result.no_eligible_task_count > 0) reasons.push('没有已审批且未覆盖的开发任务');
  if (result.active_cycle_count > 0) reasons.push('已有进行中的测试轮次');
  if (result.no_test_approved_count > 0) reasons.push('项目已批准无需测试');
  if (result.inactive_count > 0) reasons.push('项目已完成或已暂停');
  return reasons.length ? `当前没有可选项目：${reasons.join('；')}。` : '当前没有可发起测试的项目。';
}

function PlanList({ items, onOpen }: { items: TestPlanSummary[]; onOpen: (id: string) => void }) {
  if (!items.length) return <Empty text="暂无符合条件的测试计划" />;
  return <div className="grid gap-4 xl:grid-cols-2">{items.map((plan) => (
    <button key={plan.id} onClick={() => onOpen(plan.id)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-brand-500/60 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-600"><FlaskConical size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-900 dark:text-white">{plan.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs ${plan.source === 'internal_project' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300'}`}>{plan.source === 'internal_project' ? '内部项目' : '外部测试'}</span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{TEST_CYCLE_STATUS_LABEL[plan.cycle_status]}</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{plan.project_name ?? `${plan.external_project_name} · 负责人：${plan.external_owner_name}`}</p>
        </div>
        <ChevronRight className="text-slate-400 transition group-hover:translate-x-1" size={18} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <SmallMetric label={`第 ${plan.cycle_no} 轮`} value={plan.stage_version} />
        <SmallMetric label="执行 / 计划" value={`${plan.executed_case_count}/${plan.planned_case_count}`} />
        <SmallMetric label="实际投入" value={formatEffort(plan.actual_hours)} />
        <SmallMetric label="失败 / 阻塞" value={`${plan.failed_count}/${plan.blocked_count}`} danger={plan.failed_count + plan.blocked_count > 0} />
        <SmallMetric label="新增 Bug" value={String(plan.bug_count)} danger={plan.bug_count > 0} />
        <SmallMetric label="主测" value={plan.main_tester_name ?? '待排期'} />
      </div>
    </button>
  ))}</div>;
}

function ConstructionList({ items, onOpen }: { items: ConstructionSummary[]; onOpen: (id: string) => void }) {
  if (!items.length) return <Empty text="暂无测试建设工作" />;
  return <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => (
    <button key={item.id} onClick={() => onOpen(item.id)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-brand-500/60 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-600"><Boxes size={20} /></div>
        <div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-slate-900 dark:text-white">{item.title}</h3><p className="mt-1 line-clamp-2 text-sm text-slate-500">{item.goal}</p></div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{CONSTRUCTION_STATUS_LABEL[item.status]}</span>
        <ChevronRight className="text-slate-400" size={18} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        <SmallMetric label="负责人" value={item.owner_name} />
        <SmallMetric label="任务进度" value={`${item.done_count}/${item.task_count}`} />
        <SmallMetric label="计划工时" value={formatEffort(item.planned_hours)} />
        <SmallMetric label="实际工时" value={formatEffort(item.actual_hours)} />
      </div>
    </button>
  ))}</div>;
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${active ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{icon}{label}</button>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={labelCls}>{label}</label>{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-20 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/50"><ClipboardCheck className="mx-auto mb-3 opacity-40" />{text}</div>;
}
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div>{hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}</div>;
}
function SmallMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`min-w-0 rounded-lg p-2 ${danger ? 'bg-red-500/10' : 'bg-slate-50 dark:bg-slate-800/70'}`}><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-1 truncate text-sm font-medium ${danger ? 'text-red-600 dark:text-red-300' : ''}`}>{value || '—'}</div></div>;
}
