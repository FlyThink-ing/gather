import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AlertDialog } from './ConfirmDialog';
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

interface PopupPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export default function NotificationBell() {
  const { developer } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!developer) return null;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', developer.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return error.message;
    setItems((data as Notification[]) ?? []);
    return null;
  }, [developer]);

  useEffect(() => {
    load();
    if (!developer) return;
    const ch = supabase
      .channel(`notif-${developer.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${developer.id}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [developer, load]);

  const updatePosition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor) return;
    const edge = 12;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - edge * 2);
    const top = Math.max(edge, Math.min(rect.bottom + 8, window.innerHeight - 180));
    setPosition({
      top,
      left: Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge)),
      width,
      maxHeight: Math.max(0, window.innerHeight - top - edge),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const unread = items.filter((item) => !item.is_read).length;
  const markAllRead = async () => {
    if (!developer || unread === 0 || marking) return;
    setMarking(true);
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', developer.id)
        .eq('is_read', false);
      if (error) {
        setNotice(error.message);
        return;
      }
      const refreshError = await load();
      if (refreshError) setNotice(refreshError);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '通知更新失败，请稍后重试');
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label="通知"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id="notification-panel"
          role="dialog"
          aria-label="通知"
          style={position ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}
          className="fixed z-[80] flex overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex min-h-0 w-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">通知</span>
              <button type="button" disabled={marking || unread === 0} onClick={markAllRead} className="text-xs text-brand-500 hover:underline disabled:cursor-not-allowed disabled:opacity-50">
                {marking ? '处理中…' : '全部已读'}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">暂无通知</div>}
              {items.map((item) => (
                <div key={item.id} className={`break-words [overflow-wrap:anywhere] border-b border-slate-200/70 px-4 py-3 text-sm last:border-b-0 dark:border-slate-700/50 ${item.is_read ? 'text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>
                  {TYPE_TEXT[item.type]?.(item.payload) ?? item.type}
                  <div className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString('zh-CN')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <AlertDialog open={!!notice} message={notice} onClose={() => setNotice('')} />
    </div>
  );
}
