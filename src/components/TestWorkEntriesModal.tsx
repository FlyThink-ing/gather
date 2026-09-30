import React, { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Modal, { btnGhost, btnPrimary, inputCls, labelCls } from './Modal';
import DatePicker from './DatePicker';
import type { TestWorkEntries, WorkSegment } from '../lib/types';

const dateOf = (value: string) => value.slice(0, 10);
const hoursOf = (item: WorkSegment) => item.ended_at
  ? Math.round(((new Date(item.ended_at).getTime() - new Date(item.started_at).getTime()) / 36e5) * 10) / 10
  : 0;

export default function TestWorkEntriesModal({ taskId, title, open, onClose, canManage }: {
  taskId: string | null;
  title: string;
  open: boolean;
  onClose: () => void;
  canManage: (entry: WorkSegment) => boolean;
}) {
  const [data, setData] = useState<TestWorkEntries>({ items: [], audits: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<WorkSegment | null>(null);
  const [form, setForm] = useState({ date: '', hours: '', note: '', reason: '' });
  const [voiding, setVoiding] = useState<WorkSegment | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = async () => {
    if (!taskId) return;
    setBusy(true); setError('');
    const { data: result, error: rpcError } = await supabase.rpc('get_test_work_entries', { p_task_id: taskId });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setData((result as TestWorkEntries) ?? { items: [], audits: [] });
  };
  useEffect(() => { if (open) void load(); }, [open, taskId]);

  const save = async () => {
    if (!editing || !form.reason.trim()) return setError('编辑原因不能为空。');
    const hours = Number(form.hours);
    if (!form.date || !Number.isFinite(hours) || hours <= 0 || hours > 24) return setError('请填写日期及 0–24 小时的工时。');
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('update_test_work_entry', { p_segment_id: editing.id, p_work_date: form.date, p_hours: hours, p_note: form.note.trim() || null, p_reason: form.reason.trim() });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setEditing(null); await load();
  };
  const voidEntry = async () => {
    if (!voiding || !voidReason.trim()) return setError('作废原因不能为空。');
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('void_test_work_entry', { p_segment_id: voiding.id, p_reason: voidReason.trim() });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setVoiding(null); setVoidReason(''); await load();
  };

  return <Modal title={`工时明细 · ${title}`} open={open} onClose={onClose} width="max-w-3xl">
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
        {data.items.map((entry) => {
          const editable = !entry.voided_at && canManage(entry);
          return <div key={entry.id} className={`rounded-xl border p-3 text-sm dark:border-slate-700 ${entry.voided_at ? 'border-slate-200 bg-slate-50 opacity-70 dark:bg-slate-800/40' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{dateOf(entry.started_at)} · {hoursOf(entry)} 小时</div><div className="flex items-center gap-1">{entry.voided_at ? <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-xs text-slate-500">已作废</span> : entry.entry_source === 'automatic' ? <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-xs text-slate-500">自动记录</span> : <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700">手工记录</span>}{editable && <><button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="编辑工时" onClick={() => { setEditing(entry); setForm({ date: dateOf(entry.started_at), hours: String(hoursOf(entry)), note: entry.note ?? '', reason: '' }); }}><Pencil size={14} /></button><button className="rounded p-1.5 text-red-600 hover:bg-red-500/10" title="作废工时" onClick={() => { setVoiding(entry); setVoidReason(''); }}><Trash2 size={14} /></button></>}</div></div>
            <div className="mt-1 text-xs text-slate-500">登记人：{entry.developer_name || '历史人员'}{entry.note ? ` · ${entry.note}` : ''}{entry.void_reason ? ` · 作废原因：${entry.void_reason}` : ''}</div>
          </div>;
        })}
        {!busy && !data.items.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">暂无工时明细</div>}
      </div>
      {data.audits.length > 0 && <details className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><summary className="cursor-pointer font-medium">更正审计（{data.audits.length}）</summary><div className="mt-2 space-y-1">{data.audits.map((audit) => <div key={audit.id}>{new Date(audit.created_at).toLocaleString('zh-CN')} · {audit.action === 'voided' ? '作废' : '编辑'} · {audit.reason || '—'}</div>)}</div></details>}
      <div className="flex justify-end"><button className={btnGhost} onClick={onClose}>关闭</button></div>
    </div>

    <Modal title="编辑工时" open={editing !== null} onClose={() => setEditing(null)}>
      <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div><label className={labelCls}>日期</label><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} /></div><div><label className={labelCls}>工时</label><input className={inputCls} type="number" min="0.1" max="24" step="0.1" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} /></div></div><div><label className={labelCls}>说明</label><textarea className={`${inputCls} h-20 resize-none`} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></div><div><label className={labelCls}>编辑原因 *</label><textarea className={`${inputCls} h-20 resize-none`} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></div><div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setEditing(null)}>取消</button><button className={btnPrimary} disabled={busy || !form.reason.trim()} onClick={save}>保存更正</button></div></div>
    </Modal>
    <Modal title="作废工时" open={voiding !== null} onClose={() => setVoiding(null)}><div className="space-y-4"><div><label className={labelCls}>作废原因 *</label><textarea className={`${inputCls} h-24 resize-none`} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></div><div className="flex justify-end gap-3"><button className={btnGhost} onClick={() => setVoiding(null)}>取消</button><button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !voidReason.trim()} onClick={voidEntry}>确认作废</button></div></div></Modal>
  </Modal>;
}
