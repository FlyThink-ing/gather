import React, { useEffect, useState, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Notification } from '../lib/types';

const TYPE_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  task_assigned: (p) => `你被指派了任务「${p.title}」`,
  task_submitted: (p) => `任务「${p.title}」已提交审批，待你处理`,
  task_approved: (p) => `任务「${p.title}」审批通过（${p.result === 'delayed_done' ? '延期完成' : '已完成'}）`,
  task_rejected: (p) => `任务「${p.title}」审批被驳回：${p.reason ?? ''}`,
  task_comment: () => `你的任务有新评论`,
  test_assigned: (p) => `任务「${p.title}」已提测，等待你测试`,
  test_passed: (p) => `「${p.title}」测试通过，关联开发任务已进入项目审批`,
  test_failed: (p) => `「${p.title}」测试不通过：${p.reason ?? ''}`,
};

export default function NotificationBell() {
  const { developer } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!developer) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', developer.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems((data as Notification[]) ?? []);
  }, [developer]);

  useEffect(() => {
    load();
    if (!developer) return;
    // Realtime：新通知即时刷新
    const ch = supabase
      .channel(`notif-${developer.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${developer.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [developer, load]);

  const unread = items.filter((i) => !i.is_read).length;

  const markAllRead = async () => {
    if (!developer || unread === 0) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', developer.id)
      .eq('is_read', false);
    load();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 px-4 py-2.5">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">通知</span>
            <button onClick={markAllRead} className="text-xs text-brand-500 hover:underline">
              全部已读
            </button>
          </div>
          <div className="max-h-96 overflow-auto">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">暂无通知</div>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                className={`border-b border-slate-200/70 dark:border-slate-700/50 px-4 py-3 text-sm ${
                  n.is_read ? 'text-slate-500' : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {(TYPE_TEXT[n.type]?.(n.payload) ?? n.type)}
                <div className="mt-1 text-xs text-slate-500">
                  {new Date(n.created_at).toLocaleString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
