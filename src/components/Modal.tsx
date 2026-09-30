import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

let modalSequence = 0;
const modalStack: number[] = [];

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}

export default function Modal({ title, open, onClose, children, width = 'max-w-lg' }: Props) {
  const modalId = useRef(++modalSequence).current;
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(modalId);
    const isTopModal = () => modalStack[modalStack.length - 1] === modalId;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? elements.length - 1 : currentIndex - 1)
        : (currentIndex === elements.length - 1 ? 0 : currentIndex + 1);
      if (currentIndex === -1 || nextIndex !== currentIndex + (event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        elements[nextIndex].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() => {
      if (!isTopModal()) return;
      const autoFocus = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      const firstField = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
      (autoFocus ?? firstField ?? dialogRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      const index = modalStack.lastIndexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [modalId, open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`flex max-h-[calc(100vh-2rem)] w-full ${width} flex-col overflow-hidden rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl`}>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-6">
          <h2 className="min-w-0 truncate text-lg font-semibold text-slate-900 dark:text-white" title={title}>{title}</h2>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500';
export const labelCls = 'mb-1 block text-sm text-slate-500 dark:text-slate-400';
export const btnPrimary =
  'rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60';
export const btnGhost =
  'rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800';
