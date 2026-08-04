import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Crown, X, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import Modal, { inputCls, labelCls, btnPrimary, btnGhost } from '../components/Modal';
import Select from '../components/Select';
import type { Team, Developer } from '../lib/types';

interface DevTeam { id: string; developer_id: string; team_id: string }

export default function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [devTeams, setDevTeams] = useState<DevTeam[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', leader_id: '', is_test_team: false });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  // 添加成员：team_id -> 选中的 developer_id
  const [addingFor, setAddingFor] = useState<Team | null>(null);
  const [addDevId, setAddDevId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [t, d, dt] = await Promise.all([
      supabase.from('teams').select('*').order('name'),
      supabase.from('developers').select('*').eq('is_active', true).order('name'),
      supabase.from('developer_teams').select('*'),
    ]);
    setTeams((t.data as Team[]) ?? []);
    setDevelopers((d.data as Developer[]) ?? []);
    setDevTeams((dt.data as DevTeam[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const devName = (id: string | null) => developers.find((d) => d.id === id)?.name ?? '未指定';
  // 成员列表：不含组长（组长自动视为成员，不重复计入 —— v2 §2.3）
  const membersOf = (team: Team) =>
    devTeams
      .filter((x) => x.team_id === team.id && x.developer_id !== team.leader_id)
      .map((x) => ({ link: x, dev: developers.find((d) => d.id === x.developer_id) }))
      .filter((m) => m.dev);

  const openCreate = () => {
    setForm({ name: '', leader_id: '', is_test_team: false });
    setFormErr('');
    setEditing('new');
  };

  const openEdit = (t: Team) => {
    setForm({ name: t.name, leader_id: t.leader_id ?? '', is_test_team: !!t.is_test_team });
    setFormErr('');
    setEditing(t);
  };

  const save = async () => {
    if (!form.name.trim()) return setFormErr('请填写小组名称');
    setSaving(true);
    setFormErr('');
    const payload = { name: form.name.trim(), leader_id: form.leader_id || null, is_test_team: form.is_test_team };
    const res =
      editing === 'new'
        ? await supabase.from('teams').insert(payload)
        : await supabase.from('teams').update(payload).eq('id', (editing as Team).id);
    setSaving(false);
    if (res.error) return setFormErr(res.error.message);
    setEditing(null);
    load();
  };

  const remove = async (t: Team) => {
    if (!window.confirm(`确认删除小组「${t.name}」？\n该小组下的项目和任务将失去小组归属（需重新分配）。`)) return;
    const { error } = await supabase.from('teams').delete().eq('id', t.id);
    if (error) alert(error.message);
    load();
  };

  const addMember = async () => {
    if (!addingFor || !addDevId) return;
    const dup = devTeams.some((x) => x.team_id === addingFor.id && x.developer_id === addDevId);
    if (dup) { setAddingFor(null); return; }
    const { error } = await supabase
      .from('developer_teams')
      .insert({ developer_id: addDevId, team_id: addingFor.id });
    if (error) alert(error.message);
    setAddingFor(null);
    setAddDevId('');
    load();
  };

  const removeMember = async (linkId: string, name: string) => {
    if (!window.confirm(`将「${name}」移出小组？`)) return;
    const { error } = await supabase.from('developer_teams').delete().eq('id', linkId);
    if (error) alert(error.message);
    load();
  };

  // 可加入的成员：不在该组、也不是组长
  const addableDevs = addingFor
    ? developers.filter(
        (d) =>
          d.id !== addingFor.leader_id &&
          !devTeams.some((x) => x.team_id === addingFor.id && x.developer_id === d.id)
      )
    : [];

  // 某开发者已属的其他小组（成员关系 + 担任组长），用于添加成员时提示跨组
  const otherTeamsOf = (devId: string) => {
    const names = new Set<string>();
    for (const x of devTeams) {
      if (x.developer_id === devId && x.team_id !== addingFor?.id) {
        const t = teams.find((y) => y.id === x.team_id);
        if (t) names.add(t.name);
      }
    }
    for (const t of teams) {
      if (t.leader_id === devId && t.id !== addingFor?.id) names.add(t.name);
    }
    return [...names];
  };

  return (
    <div>
      <PageHeader
        title="小组管理"
        actions={
          <button onClick={openCreate} className={`${btnPrimary} flex items-center gap-1.5`}>
            <Plus size={16} /> 创建小组
          </button>
        }
      />

      {loading ? (
        <div className="py-24 text-center text-slate-500">加载中…</div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 p-12 text-center text-slate-500">
          还没有小组，点击右上角创建
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => {
            const members = membersOf(t);
            return (
              <div key={t.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">{t.name}</h3>
                  {t.is_test_team && <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300">测试小组</span>}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => openEdit(t)}
                      className="rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200"
                      title="编辑小组/更换组长"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="rounded-md p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                      title="删除小组"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-2 text-sm">
                  <Crown size={15} className="text-amber-600 dark:text-amber-400" />
                  <span className="text-slate-700 dark:text-slate-300">组长：{devName(t.leader_id)}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    {members.length + (t.leader_id ? 1 : 0)} 名成员
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {t.leader_id && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-600 dark:text-amber-400">
                      <Crown size={11} /> {devName(t.leader_id)}
                    </span>
                  )}
                  {members.map(({ link, dev }) => (
                    <span
                      key={link.id}
                      className="group flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300"
                    >
                      {dev!.name}
                      <button
                        onClick={() => removeMember(link.id, dev!.name)}
                        className="text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                        title="移出小组"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => { setAddingFor(t); setAddDevId(''); }}
                    className="flex items-center gap-1 rounded-full border border-dashed border-slate-400 dark:border-slate-600 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:border-brand-500 hover:text-brand-500"
                  >
                    <UserPlus size={11} /> 添加成员
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 创建/编辑小组 */}
      <Modal
        title={editing === 'new' ? '创建小组' : '编辑小组'}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>小组名称 <span className="text-red-600 dark:text-red-400">*</span></label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：移动端组"
            />
          </div>
          <div>
            <label className={labelCls}>组长</label>
            <Select
              value={form.leader_id}
              onChange={(v) => setForm({ ...form, leader_id: v })}
              options={[
                { value: '', label: '暂不指定' },
                ...developers.map((d) => ({
                  value: d.id,
                  label: `${d.name}（${d.position ?? '未设置职位'}）`,
                })),
              ]}
            />
            <p className="mt-1 text-xs text-slate-500">
              测试小组组长负责确认测试排期、无需测试申请和最终测试结论；不因此获得项目任务审批权。
            </p>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.is_test_team}
              onChange={(e) => setForm({ ...form, is_test_team: e.target.checked })}
            />
            <span>
              <span className="font-medium text-slate-900 dark:text-white">标记为测试小组</span>
              <span className="mt-1 block text-xs text-slate-500">一个组织可配置测试小组；测试组长权限只作用于测试中心。</span>
            </span>
          </label>
          {formErr && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{formErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button className={btnGhost} onClick={() => setEditing(null)}>取消</button>
            <button className={btnPrimary} disabled={saving} onClick={save}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 添加成员 */}
      <Modal
        title={`添加成员到「${addingFor?.name ?? ''}」`}
        open={addingFor !== null}
        onClose={() => setAddingFor(null)}
      >
        <div className="space-y-4">
          {addableDevs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">所有开发人员都已在该小组中。</p>
          ) : (
            <div>
              <label className={labelCls}>选择开发人员</label>
              <Select
                value={addDevId}
                onChange={setAddDevId}
                options={addableDevs.map((d) => {
                  const others = otherTeamsOf(d.id);
                  return {
                    value: d.id,
                    label: `${d.name}（${d.position ?? '未设置职位'}）${others.length > 0 ? ` · 已在：${others.join('、')}` : ''}`,
                  };
                })}
                placeholder="请选择"
              />
              {addDevId && otherTeamsOf(addDevId).length > 0 && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  注意：该成员已属于「{otherTeamsOf(addDevId).join('、')}」。
                  跨组协作是允许的（一人可属多组），但请留意其工作负载，避免多头任务过载。
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button className={btnGhost} onClick={() => setAddingFor(null)}>取消</button>
            <button className={btnPrimary} disabled={!addDevId} onClick={addMember}>添加</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
