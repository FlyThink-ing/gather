import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { useFloatingLayer } from './useFloatingLayer';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string; // 附加到外层（控制宽度等）
}

/** 与整体风格一致的自定义下拉框（替代原生 select） */
export default function Select({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled,
  size = 'md',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useFloatingLayer(open, ref, menuRef, 240);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
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

  const selected = options.find((o) => o.value === value);
  const sizeCls = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-left outline-none transition-colors focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60 ${sizeCls} ${
          open ? 'border-brand-500' : ''
        }`}
      >
        <span className={`truncate ${selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={size === 'sm' ? 13 : 15}
          className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={position ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}
          className="fixed z-[60] min-w-max overflow-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-1 shadow-xl"
        >
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500">暂无选项</div>
          )}
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                  size === 'sm' ? 'text-xs' : 'text-sm'
                } ${
                  isSel
                    ? 'bg-brand-600/15 text-brand-500'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
