import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  UsersRound,
  ListTodo,
  LineChart,
  ShieldCheck,
  FlaskConical,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isDemoMode } from '../lib/supabase';
import { getTheme, applyTheme, type Theme } from '../lib/theme';
import { ROLE_LABEL, type Role } from '../lib/types';
import NotificationBell from './NotificationBell';

interface MenuItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: Role[]; // 不填表示全部角色可见
}

const MENU: MenuItem[] = [
  { to: '/dashboard', label: '工作台', icon: <LayoutDashboard size={18} /> },
  { to: '/projects', label: '项目管理', icon: <FolderKanban size={18} /> },
  { to: '/developers', label: '开发人员', icon: <Users size={18} /> },
  { to: '/teams', label: '小组管理', icon: <UsersRound size={18} />, roles: ['admin'] },
  { to: '/tasks', label: '任务管理', icon: <ListTodo size={18} /> },
  { to: '/testing', label: '测试中心', icon: <FlaskConical size={18} /> },
  { to: '/analytics', label: '数据分析', icon: <LineChart size={18} />, roles: ['admin', 'manager'] },
  { to: '/user-roles', label: '权限管理', icon: <ShieldCheck size={18} />, roles: ['admin'] },
];

export default function Layout() {
  const { role, developer, signOut } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(getTheme());

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  const visible = MENU.filter((m) => !m.roles || m.roles.includes(role));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
      {/* 侧边栏 */}
      <aside className="flex w-60 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-semibold text-slate-900 dark:text-white">
          <span className="rounded-lg bg-brand-600 px-2 py-1 text-sm text-white">PM</span>
          项目管理
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {visible.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`
              }
            >
              {m.icon}
              {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 dark:border-slate-800 p-3">
          <div className="mb-2 px-2 text-sm">
            <div className="font-medium text-slate-900 dark:text-slate-100">{developer?.name ?? '未命名'}</div>
            <div className="text-xs text-slate-500">{ROLE_LABEL[role]}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6">
          {isDemoMode && (
            <span
              className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-600 dark:text-amber-400"
              title="未配置真实数据库，当前展示内置模拟数据。配置 .env 后自动切换为真实数据。"
            >
              演示模式
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
            title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
