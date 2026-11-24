import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { testingFeaturesEnabled } from '../lib/testingFeatures';
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

const NOTIFICATION_LIMIT = 20;
const TAB_FLASH_INTERVAL = 1_200;
const testingNotificationType = /^(?:test_|project_test_|no_test_)/;
const testingTaskTitle = /^(?:【测试】|\[测试活动\]|\[测试建设\])/;

async function loadNotifications(recipientId: string) {
  const visible: Notification[] = [];
  for (let offset = 0; visible.length < NOTIFICATION_LIMIT; offset += NOTIFICATION_LIMIT) {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + NOTIFICATION_LIMIT - 1);
    if (error) return { data: [], error };
    const rows = (data as Notification[]) ?? [];
    if (testingFeaturesEnabled) return { data: rows, error: null };

    const ordinary = rows.filter(({ type, payload }) =>
      !testingNotificationType.test(type) && (!type.startsWith('task_') || !testingTaskTitle.test(String(payload.title ?? ''))));
    // 通用的任务指派等通知也可能关联测试任务。
    const taskIds = ordinary.flatMap(({ type, payload }) =>
      type.startsWith('task_') && typeof payload.task_id === 'string' ? [payload.task_id] : []);
    const testTasks = taskIds.length > 0
      ? await supabase.from('tasks').select('id').eq('task_type', 'test').in('id', taskIds)
      : { data: [], error: null };
    if (testTasks.error) return { data: [], error: testTasks.error };
    const hiddenTaskIds = new Set((testTasks.data ?? []).map(({ id }) => id));
    visible.push(...ordinary.filter(({ payload }) => !hiddenTaskIds.has(payload.task_id)));
    if (rows.length < NOTIFICATION_LIMIT) break;
  }
  return { data: visible.slice(0, NOTIFICATION_LIMIT), error: null };
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export default function NotificationBell() {
  const { developer } = useAuth();
  const recipientId = developer?.id;
  const [items, setItems] = useState<Notification[]>([]);
  const [hasTabAlert, setHasTabAlert] = useState(false);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousItems = useRef<Notification[] | null>(null);
  const initialInsertIds = useRef(new Set<string>());
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    if (!recipientId) return null;
    const request = ++loadRequest.current;
    const { data, error } = await loadNotifications(recipientId);
    if (request !== loadRequest.current) return null;
    if (error) return error.message;

    const previous = previousItems.current;
    const unreadItems = data.filter((item) => !item.is_read);
    if (unreadItems.length === 0) {
      setHasTabAlert(false);
    } else if (document.hidden && unreadItems.some((item) => previous
      ? !previous.some((oldItem) => oldItem.id === item.id)
      : initialInsertIds.current.has(item.id),
    )) {
      setHasTabAlert(true);
    }
    initialInsertIds.current.clear();
    previousItems.current = data;
    setItems(data);
    return null;
  }, [recipientId]);

  useEffect(() => {
    if (!recipientId) return;
    void load();
    const ch = supabase
      .channel(`notif-${recipientId}`)
      .on<Notification>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
        ({ new: item }) => {
          if (previousItems.current === null) initialInsertIds.current.add(item.id);
          void load();
        },
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') void load(); });
    return () => {
      loadRequest.current++;
      void supabase.removeChannel(ch);
    };
  }, [recipientId, load]);

  useEffect(() => {
    if (!hasTabAlert) return;
    if (!document.hidden) {
      setHasTabAlert(false);
      return;
    }

    const originalTitle = document.title;
    const alertTitle = `有新通知 · ${originalTitle}`;
    document.title = alertTitle;
    const timer = window.setInterval(() => {
      document.title = document.title === alertTitle ? originalTitle : alertTitle;
    }, TAB_FLASH_INTERVAL);
    const onVisibilityChange = () => {
      if (!document.hidden) setHasTabAlert(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.title = originalTitle;
    };
  }, [hasTabAlert]);

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
      const query = supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', developer.id)
        .eq('is_read', false);
      const { error } = await (testingFeaturesEnabled
        ? query
        : query.in('id', items.filter((item) => !item.is_read).map((item) => item.id)));
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
