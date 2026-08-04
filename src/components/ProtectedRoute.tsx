import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../lib/types';

interface Props {
  children: React.ReactNode;
  requiredRoles?: Role[];
}

export default function ProtectedRoute({ children, requiredRoles }: Props) {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500 dark:text-slate-400">加载中…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (requiredRoles && !requiredRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
