import React from 'react';
import Modal, { btnGhost, btnPrimary } from './Modal';

interface BaseProps {
  title: string;
  open: boolean;
  message: React.ReactNode;
  onClose: () => void;
}

export function AlertDialog({ title = '提示', open, message, onClose }: Omit<BaseProps, 'title'> & { title?: string }) {
  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="space-y-5">
        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{message}</div>
        <div className="flex justify-end">
          <button data-autofocus className={btnPrimary} onClick={onClose}>知道了</button>
        </div>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  open,
  message,
  onClose,
  onConfirm,
  confirmText = '确认',
  busy = false,
  danger = false,
}: BaseProps & {
  onConfirm: () => void;
  confirmText?: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal title={title} open={open} onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-5">
        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{message}</div>
        <div className="flex justify-end gap-3">
          <button data-autofocus className={btnGhost} disabled={busy} onClick={onClose}>取消</button>
          <button
            className={danger ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60' : btnPrimary}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
