import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useFloatingLayer } from './useFloatingLayer';

interface Props {
  value: string; // 'YYYY-MM-DD' 或 ''
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 与整体风格一致的日期选择器（替代原生 input[type=date]） */
export default function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  size = 'md',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => (value ? new Date(value) : new Date()));
  const ref = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const position = useFloatingLayer(open, ref, calendarRef, 360);

  useEffect(() => {
    if (open) setView(value ? new Date(value) : new Date());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !calendarRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = fmt(new Date());

  // 6x7 网格（含相邻月补位）
  const grid = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const shiftMonth = (n: number) => {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  };

  const sizeCls = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-left outline-none transition-colors focus:border-brand-500 ${sizeCls} ${
          open ? 'border-brand-500' : ''
        }`}
      >
        <span className={`truncate ${value ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500'}`}>
          {value || placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="rounded p-0.5 text-slate-500 hover:text-red-600 dark:hover:text-red-400"
              title="清除"
            >
              <X size={size === 'sm' ? 12 : 13} />
            </span>
          )}
          <Calendar size={size === 'sm' ? 13 : 15} className="text-slate-500" />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={calendarRef}
          style={position ? { top: position.top, left: position.left, width: Math.max(position.width, 256), maxHeight: position.maxHeight } : { visibility: 'hidden' }}
          className="fixed z-[60] overflow-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-3 shadow-xl"
        >
          {/* 月份切换 */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/60"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {view.getFullYear()} 年 {view.getMonth() + 1} 月
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/60"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* 星期表头 */}
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] text-slate-500">
            {WEEK.map((w) => (
              <span key={w} className="py-1">{w}</span>
            ))}
          </div>

          {/* 日期网格 */}
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((d) => {
              const ds = fmt(d);
              const inMonth = d.getMonth() === view.getMonth();
              const isSel = ds === value;
              const isToday = ds === today;
              return (
                <button
                  key={ds}
                  type="button"
                  onClick={() => {
                    onChange(ds);
                    setOpen(false);
                  }}
                  className={`rounded-md py-1.5 text-center text-xs transition-colors ${
                    isSel
                      ? 'bg-brand-600 font-medium text-white'
                      : isToday
                        ? 'text-brand-500 ring-1 ring-inset ring-brand-500/50 hover:bg-slate-200 dark:hover:bg-slate-700/60'
                        : inMonth
                          ? 'text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60'
                          : 'text-slate-400 dark:text-slate-600 hover:bg-slate-200/60 dark:hover:bg-slate-700/40'
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* 快捷操作 */}
          <div className="mt-2 flex justify-between border-t border-slate-200/70 dark:border-slate-700/50 pt-2">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              清除
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
              className="text-xs text-brand-500 hover:underline"
            >
              今天
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
