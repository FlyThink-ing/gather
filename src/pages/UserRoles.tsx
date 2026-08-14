import React, { useCallback, useEffect, useState } from 'react';
import { Shield, UserCog, User as UserIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import Select from '../components/Select';
import { AlertDialog, ConfirmDialog } from '../components/ConfirmDialog';
import { ROLE_LABEL, type Developer, type Role } from '../lib/types';

interface UserRoleRow { user_id: string; role: Role }

const ROLE_CARDS: {
  role: Role;
  icon: React.ReactNode;
  iconCls: string;
  can: string[];
  cannot: string[];
}[] = [
  {
    role: 'admin',
    icon: <Shield size={18} />,
    iconCls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    can: ['管理所有项目', '管理开发人员', '管理所有任务并审批', '管理小组与用户权限'],
    cannot: [],
  },
  {
    role: 'manager',
    icon: <UserCog size={18} />,
    iconCls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    can: ['管理各小组的人员', '创建本组项目', '审批本小组项目下的任务', '查看数据分析'],
    cannot: ['不可管理小组设置', '不可管理权限'],
  },
  {
    role: 'user',
    icon: <UserIcon size={18} />,
    iconCls: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    can: ['查看所有项目/人员/任务', '创建并管理自己负责的任务'],
    cannot: ['不可编辑他人任务', '不可删除任务', '无审批权限'],
  },
];

export default function UserRoles() {
  const { session, refresh } = useAuth();
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [roles, setRoles] = useState<UserRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [confirmingRole, setConfirmingRole] = useState<{ developer: Developer; role: Role } | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [d, r] = await Promise.all([
      supabase.from('developers').select('*').order('name'),
      supabase.from('user_roles').select('*'),
    ]);
    setDevelopers((d.data as Developer[]) ?? []);
    setRoles((r.data as UserRoleRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 仅展示有登录账号的人员（user_id 非空才有角色可管）
  const accounts = developers.filter((d) => d.user_id);
  const roleOf = (uid: string): Role => roles.find((r) => r.user_id === uid)?.role ?? 'user';

  const persistRole = async (d: Developer, role: Role): Promise<boolean> => {
    setSavingFor(d.id);
    try {
      const { error } = await supabase.from('user_roles').update({ role }).eq('user_id', d.user_id!);
      if (error) {
        setNotice(error.message);
        return false;
      }
      await load();
      if (d.user_id === session?.user?.id) await refresh();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '角色更新失败，请稍后重试');
      return false;
    } finally {
      setSavingFor(null);
    }
  };
  const changeRole = (d: Developer, role: Role) => {
    if (roleOf(d.user_id!) === role) return;
    if (d.user_id === session?.user?.id && role !== 'admin') {
      setConfirmingRole({ developer: d, role });
      return;
    }
    void persistRole(d, role);
  };

  const ROLE_BADGE: Record<Role, string> = {
    admin: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    manager: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    user: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
  };

  return (
    <div>
      <PageHeader title="权限管理" />

      {/* 角色说明卡片 */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {ROLE_CARDS.map((c) => (
          <div key={c.role} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className={`rounded-lg p-2 ${c.iconCls}`}>{c.icon}</span>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">{ROLE_LABEL[c.role]}</h3>
            </div>
            <ul className="space-y-1.5 text-sm">
              {c.can.map((x) => (
                <li key={x} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" /> {x}
                </li>
              ))}
              {c.cannot.map((x) => (
                <li key={x} className="flex items-center gap-2 text-slate-500">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" /> {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* 用户角色列表 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">用户</th>
              <th className="px-4 py-3 font-medium">职位</th>
              <th className="px-4 py-3 font-medium">当前角色</th>
              <th className="px-4 py-3 font-medium">调整角色</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-500">加载中…</td></tr>
            )}
            {!loading && accounts.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-500">暂无注册用户</td></tr>
            )}
            {accounts.map((d) => {
              const cur = roleOf(d.user_id!);
              const isSelf = d.user_id === session?.user?.id;
              return (
                <tr key={d.id} className="border-b border-slate-200 dark:border-slate-800/60 hover:bg-slate-200/60 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600/30 text-xs font-medium text-brand-500">
                        {d.name.slice(0, 1)}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {d.name}
                        {isSelf && <span className="ml-2 text-xs text-slate-500">(我)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{d.position ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${ROLE_BADGE[cur]}`}>
                      {ROLE_LABEL[cur]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      size="sm"
                      className="w-28"
                      value={cur}
                      disabled={savingFor === d.id}
                      onChange={(v) => changeRole(d, v as Role)}
                      options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({
                        value: r,
                        label: ROLE_LABEL[r],
                      }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        title="确认降低自己的权限"
        open={confirmingRole !== null}
        message="你正在降低自己的权限，操作后将立即失去管理员功能。确认继续？"
        onClose={() => { if (!savingFor) setConfirmingRole(null); }}
        onConfirm={() => {
          if (confirmingRole) {
            void persistRole(confirmingRole.developer, confirmingRole.role).then((success) => {
              if (success) setConfirmingRole(null);
            });
          }
        }}
        confirmText="确认继续"
        busy={!!savingFor}
        danger
      />
      <AlertDialog open={!!notice} message={notice} onClose={() => setNotice('')} />
    </div>
  );
}
