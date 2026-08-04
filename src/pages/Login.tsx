import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isDemoMode } from '../lib/supabase';
import Select from '../components/Select';
import { POSITIONS } from '../lib/types';

export default function Login() {
  const { session, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState<string>(POSITIONS[0]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate('/dashboard', { replace: true });
  }, [session, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate('/dashboard', { replace: true });
      } else {
        const { needsConfirm } = await signUp(email, password, name, position);
        if (needsConfirm) {
          setInfo('注册成功，请前往邮箱完成验证后再登录。');
          setMode('login');
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (err) {
      setError((err as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white">
            <span className="rounded-lg bg-brand-600 px-2 py-1 text-sm text-white">PM</span>
            项目管理系统
          </div>
          <p className="text-sm text-slate-500">
            {mode === 'login' ? '登录以继续' : '创建你的账号'}
          </p>
          {isDemoMode && (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              演示模式：输入任意邮箱和密码即可登录体验
            </p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">密码</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
              placeholder="至少 6 位"
            />
          </div>

          {mode === 'register' && (
            <>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">姓名</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
                  placeholder="你的姓名"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-500 dark:text-slate-400">职位</label>
                <Select
                  value={position}
                  onChange={setPosition}
                  options={POSITIONS.map((p) => ({ value: p, label: p }))}
                />
              </div>
            </>
          )}

          {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
          {info && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">{info}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-slate-500">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
              setInfo('');
            }}
            className="ml-1 text-brand-500 hover:underline"
          >
            {mode === 'login' ? '注册' : '去登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
