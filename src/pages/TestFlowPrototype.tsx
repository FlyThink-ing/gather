import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, ExternalLink, FileCheck2, FlaskConical, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type TestMode = 'case_based' | 'exploratory';
type Stage = 'start' | 'conclude' | 'detail';

const fieldCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';
const primaryCls = 'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';
const ghostCls = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

export default function TestFlowPrototype() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('start');
  const [mode, setMode] = useState<TestMode>('case_based');
  const [urgent, setUrgent] = useState(false);
  const [planned, setPlanned] = useState('18');
  const [scope, setScope] = useState('登录、下单、支付主流程及本次修改影响范围');
  const [reason, setReason] = useState('紧急线上修复，先完成主流程和风险点验证');
  const [zentao, setZentao] = useState('');
  const [executed, setExecuted] = useState('20');
  const [bugs, setBugs] = useState('2');
  const [reopen, setReopen] = useState('0');
  const [blocked, setBlocked] = useState(false);
  const [passed, setPassed] = useState(true);
  const [note, setNote] = useState('核心流程验证通过，发现的非阻断问题已登记禅道。');
  const [error, setError] = useState('');

  const isExploratory = mode === 'exploratory';
  const startValid = isExploratory ? scope.trim() && reason.trim() : /^\d+$/.test(planned) && Number(planned) > 0;
  const concludeValid = (isExploratory || (/^\d+$/.test(executed) && Number(executed) >= 0)) && /^\d+$/.test(bugs) && /^\d+$/.test(reopen) && (passed || note.trim());
  const executionRate = useMemo(() => {
    if (isExploratory || !Number(planned)) return null;
    return Math.round((Number(executed || 0) / Number(planned)) * 100);
  }, [isExploratory, planned, executed]);

  const chooseMode = (next: TestMode) => {
    setMode(next);
    setError('');
  };

  const begin = () => {
    if (!startValid) {
      setError(isExploratory ? '请填写验证范围和采用快速验证的原因' : '标准用例测试的计划用例数必须大于 0');
      return;
    }
    setError('');
    setStage('conclude');
  };

  const conclude = () => {
    if (!concludeValid) {
      setError(!passed && !note.trim() ? '不通过时必须填写具体原因' : '请完整填写非负整数统计项');
      return;
    }
    setError('');
    setStage('detail');
  };

  const toggleBlocked = (value: boolean) => {
    setBlocked(value);
    if (value) {
      setPassed(false);
      if (!note.trim() || note.includes('验证通过')) {
        setNote('支付主流程被阻断，问题已登记禅道，待修复后重新验证。');
      }
    }
  };

  const reset = () => {
    setStage('start');
    setMode('case_based');
    setUrgent(false);
    setPlanned('18');
    setExecuted('20');
    setBugs('2');
    setReopen('0');
    setBlocked(false);
    setPassed(true);
    setError('');
  };

  return (
    <div className="mx-auto max-w-6xl pb-10">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate('/tasks')} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600 dark:text-slate-400">
            <ArrowLeft size={15} /> 返回任务管理
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">测试汇总流程原型</h1>
            <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-600 dark:text-violet-300">仅演示，不写入数据</span>
          </div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">请按真实工作习惯操作，重点判断字段是否必要、切换是否顺手、结果是否容易理解。</p>
        </div>
        <button onClick={reset} className={ghostCls}><RotateCcw size={15} /> 重新体验</button>
      </div>

      <div className="mb-5 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {[
          ['start', '1', '开始测试'],
          ['conclude', '2', '填写结论'],
          ['detail', '3', '查看详情与统计'],
        ].map(([key, no, text], index) => {
          const order = { start: 0, conclude: 1, detail: 2 };
          const active = order[stage] >= index;
          return <div key={key} className={`flex items-center justify-center gap-2 px-3 py-3 text-sm ${index ? 'border-l border-slate-200 dark:border-slate-800' : ''} ${active ? 'bg-brand-500/5 font-medium text-brand-600 dark:text-brand-300' : 'text-slate-400'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${active ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'}`}>{order[stage] > index ? <Check size={14} /> : no}</span>
            {text}
          </div>;
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,.75fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">测试任务 · EHC-APP</div>
                <h2 className="mt-1 font-semibold text-slate-900 dark:text-white">修复订单支付失败后的状态同步问题</h2>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-300">
                <input type="checkbox" checked={urgent} onChange={(e) => { setUrgent(e.target.checked); if (e.target.checked) chooseMode('exploratory'); }} />
                模拟紧急任务
              </label>
            </div>
          </div>

          {stage === 'start' && <div className="space-y-5 p-5">
            <div>
              <div className={labelCls}>本轮采用哪种测试方式？</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  selected={mode === 'case_based'}
                  onClick={() => chooseMode('case_based')}
                  icon={<FileCheck2 size={20} />}
                  title="标准用例测试"
                  description="有正式用例，需要统计计划数、实际执行数和执行率。"
                  tag="默认"
                />
                <ModeCard
                  selected={mode === 'exploratory'}
                  onClick={() => chooseMode('exploratory')}
                  icon={<Sparkles size={20} />}
                  title="快速 / 探索性验证"
                  description="紧急或不写正式用例时，记录验证范围与采用原因。"
                  tag={urgent ? '适合当前紧急任务' : undefined}
                />
              </div>
            </div>

            {!isExploratory ? <div>
              <label className={labelCls}>计划用例数 <span className="text-red-500">*</span></label>
              <input type="number" min="1" step="1" value={planned} onChange={(e) => setPlanned(e.target.value)} className={fieldCls} placeholder="例如：18" />
              <p className="mt-1.5 text-xs text-slate-500">这里的 0 不表示“未写用例”。没有正式用例时请切换为快速 / 探索性验证。</p>
            </div> : <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>验证范围 <span className="text-red-500">*</span></label>
                <textarea value={scope} onChange={(e) => setScope(e.target.value)} className={`${fieldCls} min-h-24 resize-y`} placeholder="本轮实际验证了哪些流程或风险点？" />
              </div>
              <div>
                <label className={labelCls}>采用快速验证的原因 <span className="text-red-500">*</span></label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldCls} min-h-24 resize-y`} placeholder="例如：线上紧急修复，暂无正式用例" />
              </div>
            </div>}

            <div>
              <label className={labelCls}>禅道测试任务链接 <span className="font-normal text-slate-400">（选填）</span></label>
              <input value={zentao} onChange={(e) => setZentao(e.target.value)} className={fieldCls} placeholder="https://zentao.example.com/testtask-123.html" />
            </div>

            {error && <ErrorBox text={error} />}
            <div className="flex justify-end"><button onClick={begin} className={primaryCls}>确认开始测试 <ArrowRight size={15} /></button></div>
          </div>}

          {stage === 'conclude' && <div className="space-y-5 p-5">
            <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-3 text-sm">
              <span className="font-medium text-brand-700 dark:text-brand-300">当前方式：{isExploratory ? '快速 / 探索性验证' : '标准用例测试'}</span>
              <button onClick={() => setStage('start')} className="ml-3 text-slate-500 underline underline-offset-2">返回修改</button>
            </div>

            <div>
              <div className={labelCls}>测试结论</div>
              <div className="grid grid-cols-2 gap-3">
                <button disabled={blocked} onClick={() => setPassed(true)} className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${passed && !blocked ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}><Check className="mr-1.5 inline" size={16} />通过</button>
                <button onClick={() => setPassed(false)} className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${!passed ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-slate-300 text-slate-500 dark:border-slate-700'}`}><CircleAlert className="mr-1.5 inline" size={16} />不通过</button>
              </div>
            </div>

            {!isExploratory && <div>
              <label className={labelCls}>实际执行用例数 <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="1" value={executed} onChange={(e) => setExecuted(e.target.value)} className={fieldCls} />
              <p className="mt-1.5 text-xs text-slate-500">允许超过计划数，用于反映测试过程中增加的覆盖范围。</p>
            </div>}

            {isExploratory && <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
              本轮没有正式用例，因此不填写用例数量，也不计算执行率和每百用例 Bug 数；Bug、Reopen、阻断和结论仍正常统计。
            </div>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={labelCls}>新增 Bug 数 <span className="text-red-500">*</span></label><input type="number" min="0" step="1" value={bugs} onChange={(e) => setBugs(e.target.value)} className={fieldCls} /></div>
              <div><label className={labelCls}>Reopen 数 <span className="text-red-500">*</span></label><input type="number" min="0" step="1" value={reopen} onChange={(e) => setReopen(e.target.value)} className={fieldCls} /></div>
            </div>

            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${blocked ? 'border-red-500 bg-red-500/5' : 'border-slate-200 dark:border-slate-700'}`}>
              <input type="checkbox" className="mt-1" checked={blocked} onChange={(e) => toggleBlocked(e.target.checked)} />
              <span><span className="block text-sm font-medium text-slate-900 dark:text-white">主流程阻断</span><span className="mt-0.5 block text-xs text-slate-500">勾选后自动切换为“不通过”，避免产生矛盾结论。</span></span>
            </label>

            <div><label className={labelCls}>结论说明 {!passed && <span className="text-red-500">*</span>}</label><textarea value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldCls} min-h-24 resize-y`} placeholder={passed ? '可选填本轮测试说明' : '请填写不通过的具体原因'} /></div>

            {error && <ErrorBox text={error} />}
            <div className="flex justify-between gap-3"><button onClick={() => setStage('start')} className={ghostCls}><ArrowLeft size={15} /> 上一步</button><button onClick={conclude} className={primaryCls}>提交测试结论 <ArrowRight size={15} /></button></div>
          </div>}

          {stage === 'detail' && <div className="space-y-5 p-5">
            <div className={`flex items-center gap-3 rounded-xl border p-4 ${passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              {passed ? <Check className="text-emerald-600" /> : <ShieldAlert className="text-red-600" />}
              <div><div className={`font-semibold ${passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>测试{passed ? '通过' : '不通过'}</div><div className="mt-0.5 text-xs text-slate-500">2026-07-12 14:30 · 测试工程师 王小明</div></div>
            </div>

            <div>
              <h3 className="mb-3 font-semibold text-slate-900 dark:text-white">测试汇总</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Metric label="测试方式" value={isExploratory ? '快速 / 探索性' : '标准用例'} />
                {!isExploratory && <><Metric label="计划 / 实际用例" value={`${planned} / ${executed}`} /><Metric label="执行率" value={`${executionRate}%`} /></>}
                <Metric label="新增 Bug" value={bugs} />
                <Metric label="Reopen" value={reopen} />
                <Metric label="主流程阻断" value={blocked ? '是' : '否'} danger={blocked} />
              </div>
            </div>

            {isExploratory && <div className="grid gap-3 sm:grid-cols-2"><DetailText label="验证范围" value={scope} /><DetailText label="采用原因" value={reason} /></div>}
            <DetailText label="结论说明" value={note || '未填写'} />
            {zentao && <a href={zentao} target="_blank" rel="noreferrer" className={ghostCls}><ExternalLink size={15} /> 打开禅道测试任务</a>}
            <div className="flex justify-end"><button onClick={reset} className={primaryCls}><RotateCcw size={15} /> 再体验一次</button></div>
          </div>}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><FlaskConical size={18} className="text-brand-500" /> 当前设计规则</div>
            <ul className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <Rule ok text="默认选择标准用例测试" />
              <Rule ok text="紧急任务可主动切换快速验证" />
              <Rule ok text="不使用 0 代表“没有写用例”" />
              <Rule ok text="快速验证必须说明范围和原因" />
              <Rule ok text="两种方式都统计 Bug、Reopen 和阻断" />
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 font-semibold text-slate-900 dark:text-white">数据分析中的表现</div>
            <div className="space-y-3 text-sm">
              <SummaryRow label="测试轮次" value="全部纳入" />
              <SummaryRow label="通过 / 不通过" value="全部纳入" />
              <SummaryRow label="Bug / Reopen / 阻断" value="全部纳入" />
              <SummaryRow label="用例执行率" value={isExploratory ? '本轮不纳入' : '本轮纳入'} muted={isExploratory} />
              <SummaryRow label="每百用例 Bug 数" value={isExploratory ? '本轮不纳入' : '本轮纳入'} muted={isExploratory} />
            </div>
          </div>

          <div className="rounded-xl bg-slate-200/60 p-4 text-xs leading-5 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
            这个页面不会保存任何数据。你可以故意清空必填项、勾选主流程阻断或切换紧急任务，检查异常状态是否符合预期。
          </div>
        </aside>
      </div>
    </div>
  );
}

function ModeCard({ selected, onClick, icon, title, description, tag }: { selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; description: string; tag?: string }) {
  return <button type="button" onClick={onClick} className={`relative rounded-xl border p-4 text-left transition ${selected ? 'border-brand-500 bg-brand-500/5 ring-2 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}>
    <div className="flex items-start gap-3"><span className={`rounded-lg p-2 ${selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{icon}</span><span><span className="block font-medium text-slate-900 dark:text-white">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span></div>
    {tag && <span className="mt-3 inline-block rounded-full bg-brand-500/10 px-2 py-1 text-[11px] font-medium text-brand-600 dark:text-brand-300">{tag}</span>}
  </button>;
}

function ErrorBox({ text }: { text: string }) {
  return <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 shrink-0" size={16} />{text}</div>;
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-xl bg-slate-100 px-4 py-3 dark:bg-slate-800"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 font-semibold ${danger ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>{value}</div></div>;
}

function DetailText({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700"><div className="text-xs text-slate-500">{label}</div><div className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{value}</div></div>;
}

function Rule({ text }: { ok: boolean; text: string }) {
  return <li className="flex items-start gap-2"><Check className="mt-0.5 shrink-0 text-emerald-500" size={15} /><span>{text}</span></li>;
}

function SummaryRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><span className={`font-medium ${muted ? 'text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</span></div>;
}
