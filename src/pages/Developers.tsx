import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, BadgeCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Modal, { inputCls, labelCls, btnPrimary, btnGhost } from '../components/Modal';
import Select from '../components/Select';
import { POSITIONS, type Developer, type Team, type Task } from '../lib/types';
import { calcWorkload, isUnfinished } from '../lib/workload';

interface DevTeam { developer_id: string; team_id: string }

export default function Developers() {
  const { role } = useAuth();
  const canManage = role === 'admin' || role === 'manager';

  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [devTeams, setDevTeams] = useState<DevTeam[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Developer | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', position: POSITIONS[0] as string });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, t, dt, k] = await Promise.all([
      supabase.from('developers').select('*').order('name'),
      supabase.from('teams').select('*'),
      supabase.from('developer_teams').select('*'),
      supabase.from('tasks').select('*'),
    ]);
    setDevelopers((d.data as Developer[]) ?? []);
    setTeams((t.data as Team[]) ?? []);
    setDevTeams((dt.data as DevTeam[]) ?? []);
    setTasks((k.data as Task[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const teamsOf = (devId: string) => {
    const names = new Set<string>();
    for (const t of teams) if (t.leader_id === devId) names.add(t.name);
    for (const x of devTeams) {
      if (x.developer_id === devId) {
        const t = teams.find((y) => y.id === x.team_id);
        if (t) names.add(t.name);
      }
    }
    return [...names];
  };

  const openCreate = () => {
    setForm({ name: '', position: POSITIONS[0] });
    setFormErr('');
    setEditing('new');
  };

  const openEdit = (d: Developer) => {
    setForm({ name: d.name, position: d.position ?? POSITIONS[0] });
    setFormErr('');
    setEditing(d);
  };

  const save = async () => {
    if (!form.name.trim()) return setFormErr('请填写姓名');
    setSaving(true);
    setFormErr('');
    const payload = { name: form.name.trim(), position: form.position };
    const res =
      editing === 'new'
        ? await supabase.from('developers').insert({ ...payload, is_active: true })
        : await supabase.from('developers').update(payload).eq('id', (editing as Developer).id);
    setSaving(false);
    if (res.error) return setFormErr(res.error.message);
    setEditing(null);
    load();
  };

  const toggleActive = async (d: Developer) => {
    const verb = d.is_active ? '停用' : '启用';
    if (!window.confirm(`确认${verb}「${d.name}」？${d.is_active ? '停用后不再出现在任务分配和甘特图中。' : ''}`)) return;
    const { error } = await supabase.from('developers').update({ is_active: !d.is_active }).eq('id', d.id);
    if (error) alert(error.message);
    load();
  };

  const remove = async (d: Developer) => {
    const open = tasks.filter((t) => t.developer_id === d.id && isUnfinished(t)).length;
    const warn = open > 0 ? `\n注意：TA 名下还有 ${open} 个未完成任务，删除后将变为「未分配」。` : '';
    if (!window.confirm(`确认删除开发人员「${d.name}」？${warn}`)) return;
    const { error } = await supabase.from('developers').delete().eq('id', d.id);
    if (error) alert(error.message);
    load();
  };

  return (
    <div>
      <PageHeader
        title="开发人员"
        actions={
          canManage ? (
            <button onClick={openCreate} className={`${btnPrimary} flex items-center gap-1.5`}>
              <Plus size={16} /> 添加人员
            </button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="py-24 text-center text-slate-500">加载中…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">职位</th>
                <th className="px-4 py-3 font-medium">所属小组</th>
                <th className="px-4 py-3 font-medium">未完成任务</th>
                <th className="px-4 py-3 font-medium">负载</th>
                <th className="px-4 py-3 font-medium">账号</th>
                <th className="px-4 py-3 font-medium">状态</th>
                {canManage && <th className="px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {developers.map((d) => {
                const mine = tasks.filter((t) => t.developer_id === d.id);
                const wl = calcWorkload(mine);
                const groups = teamsOf(d.id);
                return (
                  <tr key={d.id} className={`border-b border-slate-200 dark:border-slate-800/60 hover:bg-slate-200/60 dark:hover:bg-slate-800/40 ${d.is_active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600/30 text-xs font-medium text-brand-500">
                          {d.name.slice(0, 1)}
                        </div>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{d.position ?? '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {groups.length === 0 ? (
                          <span className="text-slate-500">-</span>
                        ) : (
                          groups.map((g) => (
                            <span key={g} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-600 dark:text-violet-400">
                              {g}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{wl.taskCount}</td>
                    <td className={`px-4 py-3 text-xs ${wl.colorCls}`}>{wl.taskCount > 0 ? wl.label : '-'}</td>
                    <td className="px-4 py-3">
                      {d.user_id ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <BadgeCheck size={13} /> 已注册
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">未注册</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${d.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                        {d.is_active ? '在职' : '已停用'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openEdit(d)}
                            className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                            title="编辑"
                          >
                            <Pencil size={15} />
                          </button>
                          {role === 'admin' && (
                            <>
                              <button
                                onClick={() => toggleActive(d)}
                                className="rounded-md px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                              >
                                {d.is_active ? '停用' : '启用'}
                              </button>
                              <button
                                onClick={() => remove(d)}
                                className="rounded-md p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                                title="删除"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={editing === 'new' ? '添加开发人员' : '编辑开发人员'}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>姓名 <span className="text-red-600 dark:text-red-400">*</span></label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="请输入姓名"
            />
          </div>
          <div>
            <label className={labelCls}>职位</label>
            <Select
              value={form.position}
              onChange={(v) => setForm({ ...form, position: v })}
              options={POSITIONS.map((p) => ({ value: p, label: p }))}
            />
          </div>
          {editing === 'new' && (
            <p className="text-xs text-slate-500">
              手动添加的人员没有登录账号，仅用于任务分配；对方自行注册后会生成独立的开发人员记录。
            </p>
          )}
          {formErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{formErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button className={btnGhost} onClick={() => setEditing(null)}>取消</button>
            <button className={btnPrimary} disabled={saving} onClick={save}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
