import React from 'react';

export default function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
      {actions}
    </div>
  );
}

export function Placeholder({ note }: { note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 p-12 text-center text-slate-500">
      {note}
    </div>
  );
}
