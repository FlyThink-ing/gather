import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { TaskPausePeriod } from '../lib/types';

const PAGE_SIZE = 200;
const timestampFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false,
});

function durationMs(period: TaskPausePeriod) {
  return period.resumed_at ? Math.max(0, Date.parse(period.resumed_at) - Date.parse(period.paused_at)) : 0;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const parts = [
    [Math.floor(seconds / 86400), '天'],
    [Math.floor(seconds / 3600) % 24, '小时'],
    [Math.floor(seconds / 60) % 60, '分钟'],
    [seconds % 60, '秒'],
  ];
  return parts.filter(([value]) => value).map(([value, unit]) => `${value} ${unit}`).join(' ') || '不足 1 秒';
}

export default function TaskPauseHistory({ taskId }: { taskId: string }) {
  const [history, setHistory] = useState<TaskPausePeriod[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const periods: TaskPausePeriod[] = [];
      while (!cancelled) {
        const { data, error } = await supabase.from('task_pause_periods').select('id, task_id, paused_at, resumed_at')
          .eq('task_id', taskId).order('paused_at', { ascending: false }).order('id', { ascending: false })
          .range(periods.length, periods.length + PAGE_SIZE - 1);
        if (cancelled) return;
        if (error || !data) {
          setFailed(true);
          return;
        }
        periods.push(...data);
        if (data.length < PAGE_SIZE) {
          setHistory(periods);
          return;
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [taskId]);

  if (failed) return <p role="status" className="text-sm text-amber-700 dark:text-amber-300">挂起记录加载失败，请重新打开查看。</p>;
  if (!history) return <p role="status" className="text-xs text-slate-500">正在加载挂起记录…</p>;
  if (history.length === 0) return null;

  const completed = history.filter((period) => period.resumed_at);
  return (
    <section className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800" aria-label="挂起记录">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">挂起记录（{history.length} 次）</h4>
        {completed.length > 0 && (
          <p className="text-xs text-slate-600 dark:text-slate-400">已结束挂起累计 {formatDuration(completed.reduce((sum, period) => sum + durationMs(period), 0))}</p>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">北京时间</p>
      <ol className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
        {history.map((period) => (
          <li key={period.id}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 py-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">挂起时间</dt>
                <dd className="mt-0.5 tabular-nums"><time dateTime={period.paused_at}>{timestampFormat.format(new Date(period.paused_at))}</time></dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">恢复时间</dt>
                <dd className="mt-0.5 tabular-nums">{period.resumed_at ? <time dateTime={period.resumed_at}>{timestampFormat.format(new Date(period.resumed_at))}</time> : '尚未恢复'}</dd>
              </div>
              {period.resumed_at && <div><dt className="text-slate-500 dark:text-slate-400">挂起时长</dt><dd className="mt-0.5">{formatDuration(durationMs(period))}</dd></div>}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
